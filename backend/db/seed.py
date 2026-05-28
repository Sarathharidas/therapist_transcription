"""
Startup seed — ensures a single clinician row exists from .env vars.
"""

import os
from typing import Optional

from sqlalchemy.orm import Session

from backend.db import Clinician

# Module-level cache so routes don't hit the DB on every request
_clinician_id: Optional[str] = None


def seed_clinician(db: Session) -> None:
    """Insert the clinician from env vars if they don't already exist."""
    email = os.getenv("CLINICIAN_EMAIL", "").strip()
    name = os.getenv("CLINICIAN_NAME", "").strip()

    if not email or not name:
        raise RuntimeError(
            "CLINICIAN_EMAIL and CLINICIAN_NAME must be set in .env"
        )

    existing = db.query(Clinician).filter(Clinician.email == email).first()
    if existing is None:
        clinician = Clinician(email=email, name=name)
        db.add(clinician)
        db.commit()
        db.refresh(clinician)
        print(f"[seed] Clinician created: {name} <{email}>")
    else:
        print(f"[seed] Clinician already exists: {existing.name} <{existing.email}>")


def get_clinician_id(db: Session) -> str:
    """Return the seeded clinician's UUID (cached after first call)."""
    global _clinician_id
    if _clinician_id is None:
        email = os.getenv("CLINICIAN_EMAIL", "").strip()
        clinician = db.query(Clinician).filter(Clinician.email == email).first()
        if clinician is None:
            raise RuntimeError("Clinician not found — did startup seed run?")
        _clinician_id = str(clinician.clinician_id)
    return _clinician_id
