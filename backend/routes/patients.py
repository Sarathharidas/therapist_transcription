"""
Patient routes
  GET  /api/patients   — list all patients for the authenticated clinician
  POST /api/patients   — create a new patient
"""

import re
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.db import Clinician, Patient, Summary
from backend.db.session import get_db
from backend.services.auth import get_current_clinician
from backend.services.crypto import decrypt, encrypt
from backend.services.gemini import get_service

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


# ── Patient history (shown on the recording screen) ─────────────────────────

class HistorySessionOut(BaseModel):
    summary_id: str
    date: str
    snippet: str


class PatientHistoryOut(BaseModel):
    overview: Optional[str] = None       # LLM synthesis of recent sessions
    sessions: List[HistorySessionOut]    # links to every past summary


def _fmt_date(created_at_str) -> str:
    try:
        raw = str(created_at_str).split("+")[0].split(".")[0].replace("T", " ")
        dt = datetime.fromisoformat(raw)
        return f"{dt.day} {dt.strftime('%b %Y').upper()}"
    except Exception:
        return str(created_at_str)[:10]


def _snippet(text: str, limit: int = 90) -> str:
    for line in (text or "").splitlines():
        s = re.sub(r"^[#>\-\*\s]+", "", line).replace("**", "").strip()
        if s and s.lower() != "not discussed" and "OP CASE SHEET" not in s.upper():
            return s[:limit] + ("…" if len(s) > limit else "")
    return ""


@router.get("/{patient_id}/history", response_model=PatientHistoryOut)
def patient_history(
    patient_id: str,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """
    A patient's prior sessions for the recording screen: links to every past
    summary + an LLM overview of the recent ones. The overview is cached and
    regenerated only when a new session has been added since it was built.
    """
    try:
        puid = uuid.UUID(patient_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Invalid patient id")

    patient = (
        db.query(Patient)
        .filter(Patient.patient_id == puid, Patient.clinician_id == clinician.clinician_id)
        .first()
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    summaries = (
        db.query(Summary)
        .filter(Summary.patient_id == puid)
        .order_by(Summary.created_at.desc())
        .all()
    )
    if not summaries:
        return PatientHistoryOut(overview=None, sessions=[])

    sessions_out = [
        HistorySessionOut(
            summary_id=str(s.summary_id),
            date=_fmt_date(s.created_at),
            snippet=_snippet(decrypt(s.ai_summary) or ""),
        )
        for s in summaries
    ]

    # Cache key: regenerate only when the set of sessions changes.
    marker = f"{len(summaries)}:{summaries[0].summary_id}"
    if patient.history_overview and patient.history_overview_marker == marker:
        overview = decrypt(patient.history_overview)
    else:
        recent = [decrypt(s.ai_summary) or "" for s in summaries[:5]]
        try:
            overview = get_service().summarize_history(recent) or None
        except Exception as exc:
            print(f"[patients] history overview failed: {exc}")
            overview = None
        if overview:
            patient.history_overview = encrypt(overview)
            patient.history_overview_marker = marker
            db.commit()

    return PatientHistoryOut(overview=overview, sessions=sessions_out)
