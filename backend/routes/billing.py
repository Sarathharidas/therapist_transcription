"""
Billing / subscription routes (Phase 1: per-therapist, hours-metered wallet).

  GET  /api/billing/subscription  — dashboard data (status, trial, credits, plans)
  POST /api/billing/subscribe     — create a Razorpay subscription → Checkout
  POST /api/billing/cancel        — cancel at period end
  POST /api/billing/webhook       — Razorpay events (signature-verified)

Existing (legacy) clinicians with no subscription record get their 14-day trial
started lazily on first fetch — so it begins "now" and shows as Free trial.
"""

import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.db import Clinician, UsageRecord
from backend.db.session import get_db
from backend.services import billing
from backend.services.auth import get_current_clinician

router = APIRouter(prefix="/api/billing", tags=["billing"])


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _ensure_trial(clinician: Clinician, db: Session) -> None:
    """Lazy-start a 14-day trial for accounts with no subscription record yet."""
    if clinician.subscription_status is None and clinician.trial_ends_at is None:
        clinician.subscription_status = "trial"
        clinician.trial_ends_at = (_now() + timedelta(days=billing.TRIAL_DAYS)).isoformat()
        db.commit()


def _days_left(iso: Optional[str]) -> Optional[int]:
    if not iso:
        return None
    try:
        end = datetime.fromisoformat(iso)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        secs = (end - _now()).total_seconds()
        return max(0, int(secs // 86400) + (1 if secs % 86400 else 0))
    except Exception:
        return None


# ── Shapes ──────────────────────────────────────────────────────────────────

class PlanOut(BaseModel):
    tier: str
    name: str
    hours: int
    price: int          # rupees (GST-inclusive)
    description: str
    configured: bool     # False until the Razorpay plan_id env var is set


class SubscriptionOut(BaseModel):
    status: str          # trial | active | past_due | cancelled | none
    plan: Optional[str] = None
    plan_name: Optional[str] = None
    trial_ends_at: Optional[str] = None
    trial_days_left: Optional[int] = None
    hours_balance: float = 0.0
    hours_used: float = 0.0
    current_period_end: Optional[str] = None
    plans: List[PlanOut]


class SubscribeIn(BaseModel):
    tier: str


def _plans_public() -> List[PlanOut]:
    return [
        PlanOut(
            tier=t, name=p["name"], hours=p["hours"], price=p["amount"] // 100,
            description=p["description"], configured=billing.plan_id(t) is not None,
        )
        for t, p in billing.PLANS.items()
    ]


# ── Routes ──────────────────────────────────────────────────────────────────

@router.get("/subscription", response_model=SubscriptionOut)
def get_subscription(
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    _ensure_trial(clinician, db)
    used = db.query(func.coalesce(func.sum(UsageRecord.seconds), 0)).filter(
        UsageRecord.clinician_id == clinician.clinician_id
    ).scalar() or 0
    status = clinician.subscription_status or "none"
    return SubscriptionOut(
        status=status,
        plan=clinician.plan,
        plan_name=billing.PLANS.get(clinician.plan, {}).get("name") if clinician.plan else None,
        trial_ends_at=clinician.trial_ends_at,
        trial_days_left=_days_left(clinician.trial_ends_at) if status == "trial" else None,
        hours_balance=round((clinician.seconds_balance or 0) / 3600, 2),
        hours_used=round(used / 3600, 2),
        current_period_end=clinician.current_period_end,
        plans=_plans_public(),
    )


def _razorpay_client():
    key_id = os.getenv("RAZORPAY_KEY_ID")
    key_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if not key_id or not key_secret:
        raise HTTPException(status_code=503, detail="Billing is not configured yet.")
    import razorpay  # deferred import
    return razorpay.Client(auth=(key_id, key_secret)), key_id


@router.post("/subscribe")
def subscribe(
    body: SubscribeIn,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Create a Razorpay subscription and return the id + key for Checkout."""
    tier = body.tier
    if tier not in billing.PLANS:
        raise HTTPException(status_code=422, detail="Unknown plan")
    pid = billing.plan_id(tier)
    if not pid:
        raise HTTPException(status_code=503, detail="This plan is not available yet.")

    client, key_id = _razorpay_client()
    sub = client.subscription.create({
        "plan_id": pid,
        "total_count": 120,           # up to 10 years of monthly cycles
        "customer_notify": 1,
        "notes": {"clinician_id": str(clinician.clinician_id), "tier": tier},
    })
    clinician.razorpay_subscription_id = sub["id"]
    clinician.plan = tier            # provisional; confirmed 'active' by webhook
    db.commit()
    return {"subscription_id": sub["id"], "key_id": key_id}


@router.post("/cancel")
def cancel(
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Cancel the subscription at the end of the current billing cycle."""
    if not clinician.razorpay_subscription_id:
        raise HTTPException(status_code=404, detail="No active subscription")
    client, _ = _razorpay_client()
    client.subscription.cancel(clinician.razorpay_subscription_id, {"cancel_at_cycle_end": 1})
    clinician.subscription_status = "cancelled"
    db.commit()
    return {"ok": True}


@router.post("/webhook")
async def razorpay_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Handle Razorpay subscription events. Signature-verified with
    RAZORPAY_WEBHOOK_SECRET. Credits the wallet on each successful charge
    (apply_renewal → carry-forward), and tracks status.
    """
    secret = os.getenv("RAZORPAY_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(status_code=503, detail="Webhook not configured")

    raw = await request.body()
    signature = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    event = json.loads(raw)
    etype = event.get("event", "")
    entity = (event.get("payload", {}).get("subscription", {}) or {}).get("entity", {})
    sub_id = entity.get("id")
    if not sub_id:
        return {"ok": True}

    clinician = (
        db.query(Clinician).filter(Clinician.razorpay_subscription_id == sub_id).first()
    )
    if clinician is None:
        return {"ok": True}  # unknown subscription — ignore

    if etype == "subscription.charged":
        # Successful payment (incl. the first) → top up the wallet + go active.
        clinician.subscription_status = "active"
        if clinician.plan:
            clinician.seconds_balance = billing.apply_renewal(
                clinician.seconds_balance or 0, clinician.plan
            )
        current_end = entity.get("current_end")
        if current_end:
            clinician.current_period_end = datetime.fromtimestamp(
                current_end, tz=timezone.utc
            ).isoformat()
    elif etype == "subscription.activated":
        clinician.subscription_status = "active"
    elif etype in ("subscription.halted", "subscription.pending"):
        clinician.subscription_status = "past_due"
    elif etype in ("subscription.cancelled", "subscription.completed"):
        clinician.subscription_status = "cancelled"

    db.commit()
    print(f"[billing] webhook {etype} → clinician {clinician.clinician_id} = {clinician.subscription_status}")
    return {"ok": True}
