"""
One-time: create the Razorpay subscription Plans for Phase 1 and print their IDs.

Prereq: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET set (test keys first). Run via
Railway so the keys are injected:

    railway run python backend/scripts/create_razorpay_plans.py

Then copy the printed RAZORPAY_PLAN_* lines into your Railway env vars. Safe to
re-run — but note each run creates NEW plans in Razorpay, so only run once per
environment (test / live) and keep the IDs.
"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))

import os  # noqa: E402

from dotenv import load_dotenv  # noqa: E402

load_dotenv(dotenv_path=_ROOT / ".env")

from backend.services.billing import PLANS  # noqa: E402


def main() -> None:
    key_id = os.getenv("RAZORPAY_KEY_ID")
    key_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if not key_id or not key_secret:
        print("[plans] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — aborting.")
        return

    mode = "TEST" if key_id.startswith("rzp_test") else "LIVE"
    print(f"[plans] Using {mode} keys. Creating {len(PLANS)} plans…\n")

    import razorpay  # deferred so the module imports without the dep present

    client = razorpay.Client(auth=(key_id, key_secret))

    print("# ── Copy these into Railway env vars ──")
    for tier, p in PLANS.items():
        plan = client.plan.create({
            "period": p["period"],
            "interval": p["interval"],
            "item": {
                "name": f"Aura {p['name']}",
                "amount": p["amount"],
                "currency": "INR",
                "description": p["description"],
            },
            "notes": {"tier": tier, "hours": str(p["hours"])},
        })
        print(f"{p['plan_id_env']}={plan['id']}   # {p['name']} ₹{p['amount']//100}/mo · {p['hours']}h")


if __name__ == "__main__":
    main()
