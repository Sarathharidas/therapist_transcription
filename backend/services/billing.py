"""
Subscription / billing config.

Phase 1: two individual-therapist tiers, metered by HOURS of transcribed audio
per monthly period, GST-inclusive prices. Razorpay handles the recurring INR
charge; the hours allowance is enforced app-side. Plan IDs come from env vars
(created once by scripts/create_razorpay_plans.py).

Clinic / Clinic-Professional (pooled hours, admin billing, seat limits) are
Phase 2 — deliberately not defined here yet.
"""

import os
from datetime import datetime, timezone
from typing import Optional, Tuple

TRIAL_DAYS = 14

# amount is in paise (GST-inclusive). hours = monthly transcription allowance.
PLANS = {
    "solo": {
        "name": "Solo",
        "hours": 25,
        "amount": 99900,          # ₹999 / month (incl. GST)
        "period": "monthly",
        "interval": 1,
        "description": "25 hours/month · 1 therapist",
        "plan_id_env": "RAZORPAY_PLAN_SOLO",
    },
    "practice": {
        "name": "Practice",
        "hours": 50,
        "amount": 199900,         # ₹1,999 / month (incl. GST)
        "period": "monthly",
        "interval": 1,
        "description": "50 hours/month · 1 therapist",
        "plan_id_env": "RAZORPAY_PLAN_PRACTICE",
    },
}


# Carry-forward: unused hours roll over into the credit balance. None = no cap
# (unlimited carry-forward). Set to e.g. 2 to cap the balance at 2× the plan's
# monthly hours if liability ever becomes a concern.
ROLLOVER_CAP_MULTIPLE: Optional[float] = None


def plan_id(tier: str) -> Optional[str]:
    """Razorpay plan_id for a tier, from its env var (set after plan creation)."""
    p = PLANS.get(tier)
    return os.getenv(p["plan_id_env"]) if p else None


def tier_for_plan_id(pid: str) -> Optional[str]:
    """Reverse lookup: which tier a Razorpay plan_id belongs to (webhook use)."""
    for tier in PLANS:
        if plan_id(tier) == pid:
            return tier
    return None


def entitlement(
    status: Optional[str],
    trial_ends_at: Optional[str],
    seconds_balance: Optional[int],
    now: datetime,
) -> Tuple[bool, Optional[str]]:
    """
    Can this clinician start a new (metered) session? Returns (allowed, reason).

    - status None  → legacy account, grandfathered (allowed).
    - trial        → allowed until trial_ends_at, else 'trial_expired'.
    - active       → allowed while credit balance > 0, else 'no_hours'.
    - anything else (past_due / cancelled / expired) → blocked with that reason.
    """
    if status is None:
        return True, None
    if status == "trial":
        if trial_ends_at:
            try:
                end = datetime.fromisoformat(trial_ends_at)
                if end.tzinfo is None:
                    end = end.replace(tzinfo=timezone.utc)
                if now < end:
                    return True, None
            except Exception:
                return True, None  # lenient on a parse error — don't lock out
        return False, "trial_expired"
    if status == "active":
        return (True, None) if (seconds_balance or 0) > 0 else (False, "no_hours")
    return False, status or "inactive"


def plan_seconds(tier: str) -> int:
    """A tier's monthly hours allowance, in seconds."""
    return PLANS[tier]["hours"] * 3600 if tier in PLANS else 0


def apply_renewal(balance_seconds: int, tier: str) -> int:
    """
    New credit balance after a successful monthly charge: add the plan's hours to
    the carried-forward balance (unused hours roll over). Optionally capped by
    ROLLOVER_CAP_MULTIPLE.
    """
    new_balance = balance_seconds + plan_seconds(tier)
    if ROLLOVER_CAP_MULTIPLE is not None:
        cap = int(ROLLOVER_CAP_MULTIPLE * plan_seconds(tier))
        new_balance = min(new_balance, cap)
    return new_balance
