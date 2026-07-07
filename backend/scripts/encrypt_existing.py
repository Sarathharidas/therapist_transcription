"""
One-time backfill: encrypt existing plaintext PHI in the `summaries` table.

Encrypts any `transcription`, `ai_summary`, or `clinician_notes` value that is
not already tagged with the encryption marker. Safe to re-run (idempotent —
already-encrypted values are skipped), and safe to run while the app is live
because decrypt() transparently handles a mix of plaintext and ciphertext.

Prerequisite: ENCRYPTION_KEY must be set (same key the app uses), or nothing
happens. Run once after deploying the key:

    PYTHONPATH=. python backend/scripts/encrypt_existing.py
"""

import sys
from pathlib import Path

# Make the `backend` package importable no matter how this script is invoked
# (e.g. `python backend/scripts/encrypt_existing.py` without PYTHONPATH set).
_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv  # noqa: E402

# Load the same .env the app uses (ENCRYPTION_KEY, DATABASE_URL) before importing
# anything that reads them. (Harmless if there's no .env — e.g. under `railway run`,
# where the vars are already injected into the environment.)
load_dotenv(dotenv_path=_ROOT / ".env")

from backend.db import AppointmentSession, Group, Patient, Summary  # noqa: E402
from backend.db.session import SessionLocal  # noqa: E402
from backend.services.crypto import encrypt, is_enabled, is_encrypted  # noqa: E402

# Every table + column that holds encrypted PHI at rest.
TARGETS = (
    (Summary, ("transcription", "ai_summary", "clinician_notes")),
    (Patient, ("name",)),                 # patient names
    (Group, ("label",)),                  # e.g. "Asha & Ravi"
    (AppointmentSession, ("label",)),     # appointment label (often name-derived)
)
BATCH = 200


def _backfill_model(db, model, fields):
    """Encrypt any un-encrypted values in `fields` for all rows of `model`."""
    scanned = 0
    changed_rows = 0
    changed_fields = 0
    for row in db.query(model).all():
        scanned += 1
        row_touched = False
        for field in fields:
            value = getattr(row, field)
            if value is None or is_encrypted(value):  # skip NULLs + already-encrypted
                continue
            setattr(row, field, encrypt(value))
            changed_fields += 1
            row_touched = True
        if row_touched:
            changed_rows += 1
        if changed_rows and changed_rows % BATCH == 0:
            db.commit()
    db.commit()
    print(
        f"[backfill] {model.__tablename__}: scanned {scanned}, "
        f"encrypted {changed_fields} fields across {changed_rows} rows."
    )


def main() -> None:
    if not is_enabled():
        print("[backfill] ENCRYPTION_KEY is not set — nothing to do. Aborting.")
        return

    db = SessionLocal()
    try:
        for model, fields in TARGETS:
            _backfill_model(db, model, fields)
        print("[backfill] done.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
