"""
One-time backfill: generate + store the history overview for every patient who
already has past sessions, so the recording screen shows it immediately for
existing patients (new sessions keep it fresh automatically).

Prereq: GEMINI_API_KEY + DATABASE_URL (and ENCRYPTION_KEY if used) set. Run via
Railway so the env is injected:

    railway run python backend/scripts/backfill_history_overviews.py

Makes one LLM call per patient with sessions. Safe to re-run (it just overwrites).
"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(dotenv_path=_ROOT / ".env")

from backend.db import Summary  # noqa: E402
from backend.db.session import SessionLocal  # noqa: E402
from backend.services.history import regenerate_patient_overview  # noqa: E402


def main() -> None:
    db = SessionLocal()
    try:
        patient_ids = [row[0] for row in db.query(Summary.patient_id).distinct().all()]
        print(f"[backfill] {len(patient_ids)} patients with sessions…")
        done = 0
        for pid in patient_ids:
            try:
                if regenerate_patient_overview(db, pid):
                    done += 1
                    print(f"  ✓ {pid}")
                else:
                    print(f"  – {pid} (skipped)")
            except Exception as exc:  # noqa: BLE001
                db.rollback()
                print(f"  ✗ {pid}: {exc}")
        print(f"[backfill] done — {done}/{len(patient_ids)} overviews generated.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
