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
from typing import Optional

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
