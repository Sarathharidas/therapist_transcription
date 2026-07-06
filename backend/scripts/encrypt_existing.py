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

from pathlib import Path

from dotenv import load_dotenv

# Load the same .env the app uses (ENCRYPTION_KEY, DATABASE_URL) before importing
# anything that reads them.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent.parent / ".env")

from backend.db import Summary  # noqa: E402
from backend.db.session import SessionLocal  # noqa: E402
from backend.services.crypto import PREFIX, encrypt, is_enabled  # noqa: E402

FIELDS = ("transcription", "ai_summary", "clinician_notes")
BATCH = 200


def main() -> None:
    if not is_enabled():
        print("[backfill] ENCRYPTION_KEY is not set — nothing to do. Aborting.")
        return

    db = SessionLocal()
    scanned = 0
    changed_rows = 0
    changed_fields = 0
    try:
        rows = db.query(Summary).all()
        for row in rows:
            scanned += 1
            row_touched = False
            for field in FIELDS:
                value = getattr(row, field)
                # Skip NULLs and anything already encrypted.
                if value is None or value.startswith(PREFIX):
                    continue
                setattr(row, field, encrypt(value))
                changed_fields += 1
                row_touched = True
            if row_touched:
                changed_rows += 1
            if changed_rows and changed_rows % BATCH == 0:
                db.commit()
                print(f"[backfill] committed {changed_rows} rows so far…")
        db.commit()
        print(
            f"[backfill] done — scanned {scanned} rows, "
            f"encrypted {changed_fields} fields across {changed_rows} rows."
        )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
