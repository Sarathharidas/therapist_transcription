"""
One-time cleanup: remove the "MINDWORLD — Mental Health Clinic and Training
Centre" line from data generated before it was dropped from the default format.

Strips any line containing "MINDWORLD" from:
  - summaries.ai_summary        (existing generated case sheets)
  - clinicians.summary_format   (custom formats copied from the old default)
  - patients.history_overview   (derived summaries, just in case)

Decrypts → strips → re-encrypts transparently. Idempotent (safe to re-run). Run
via Railway so DATABASE_URL / ENCRYPTION_KEY are injected:

    railway run python backend/scripts/remove_mindworld.py
"""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(dotenv_path=_ROOT / ".env")

from backend.db import Clinician, Patient, Summary  # noqa: E402
from backend.db.session import SessionLocal  # noqa: E402
from backend.services.crypto import decrypt, encrypt  # noqa: E402

NEEDLE = "MINDWORLD"


def _clean(text):
    """Drop any line containing MINDWORLD; collapse a resulting leading blank."""
    if not text or NEEDLE not in text:
        return None  # nothing to change
    lines = [ln for ln in text.split("\n") if NEEDLE not in ln]
    cleaned = "\n".join(lines)
    # If removing the line left a title followed by a blank gap, tidy it lightly.
    while "\n\n\n" in cleaned:
        cleaned = cleaned.replace("\n\n\n", "\n\n")
    return cleaned


TARGETS = (
    (Summary, "ai_summary"),
    (Clinician, "summary_format"),
    (Patient, "history_overview"),
)


def main() -> None:
    db = SessionLocal()
    total = 0
    try:
        for model, field in TARGETS:
            changed = 0
            for row in db.query(model).all():
                current = decrypt(getattr(row, field))
                cleaned = _clean(current)
                if cleaned is not None:
                    setattr(row, field, encrypt(cleaned))
                    changed += 1
            db.commit()
            total += changed
            print(f"[cleanup] {model.__tablename__}.{field}: {changed} rows cleaned")
        print(f"[cleanup] done — {total} values updated.")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
