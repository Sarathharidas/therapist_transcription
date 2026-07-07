"""
Patient routes
  GET  /api/patients   — list all patients for the authenticated clinician
  POST /api/patients   — create a new patient
"""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.db import Clinician, Patient
from backend.db.session import get_db
from backend.services.auth import get_current_clinician
from backend.services.crypto import decrypt, encrypt

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
    name = decrypt(p.name) or ""
    return PatientOut(
        patient_id=str(p.patient_id),
        name=name,
        initials=_initials(name),
        created_at=str(p.created_at),
    )


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[PatientOut])
def list_patients(
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Return all patients belonging to the authenticated clinician, newest first."""
    rows = (
        db.query(Patient)
        .filter(Patient.clinician_id == clinician.clinician_id)
        .order_by(Patient.created_at.desc())
        .all()
    )
    return [_to_out(p) for p in rows]


@router.post("", response_model=PatientOut, status_code=201)
def create_patient(
    body: PatientCreate,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Create a new patient under the authenticated clinician."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Patient name cannot be empty")

    patient = Patient(name=encrypt(name), clinician_id=clinician.clinician_id)
    db.add(patient)
    db.commit()
    db.refresh(patient)
    return _to_out(patient)
