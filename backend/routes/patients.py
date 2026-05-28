"""
Patient routes
  GET  /api/patients   — list all patients for the seeded clinician
  POST /api/patients   — create a new patient
"""

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.db import Patient
from backend.db.seed import get_clinician_id
from backend.db.session import get_db

router = APIRouter(prefix="/api/patients", tags=["patients"])


# ── Pydantic shapes ────────────────────────────────────────────────────────

class PatientCreate(BaseModel):
    name: str


class PatientOut(BaseModel):
    patient_id: str
    name: str
    initials: str
    created_at: str


# ── Helpers ────────────────────────────────────────────────────────────────

def _initials(name: str) -> str:
    return "".join(w[0] for w in name.split() if w)[:2].upper()


def _to_out(p: Patient) -> PatientOut:
    return PatientOut(
        patient_id=str(p.patient_id),
        name=p.name,
        initials=_initials(p.name),
        created_at=str(p.created_at),
    )


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[PatientOut])
def list_patients(db: Session = Depends(get_db)):
    """Return all patients belonging to the seeded clinician, newest first."""
    cid = get_clinician_id(db)
    rows = (
        db.query(Patient)
        .filter(Patient.clinician_id == uuid.UUID(cid))
        .order_by(Patient.created_at.desc())
        .all()
    )
    return [_to_out(p) for p in rows]


@router.post("", response_model=PatientOut, status_code=201)
def create_patient(body: PatientCreate, db: Session = Depends(get_db)):
    """Create a new patient under the seeded clinician."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Patient name cannot be empty")

    cid = get_clinician_id(db)
    patient = Patient(name=name, clinician_id=uuid.UUID(cid))
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return _to_out(patient)
