"""
Session routes — POST /api/sessions/process, GET /api/sessions/recent
"""

import os
import tempfile
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from google.genai.errors import ClientError
from sqlalchemy.orm import Session

from backend.db import Clinician, Patient, Summary
from backend.db.session import get_db
from backend.models import SessionResult
from backend.services.auth import get_current_clinician
from backend.services.gemini import get_service

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class NotesUpdate(BaseModel):
    notes: str


class RecentSessionOut(BaseModel):
    summary_id: str
    patient_name: str
    date: str
    note_snippet: str


@router.get("/recent", response_model=List[RecentSessionOut])
def list_recent_sessions(
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Return the 20 most recent sessions for the authenticated clinician."""
    rows = (
        db.query(Summary, Patient)
        .join(Patient, Summary.patient_id == Patient.patient_id)
        .filter(Patient.clinician_id == clinician.clinician_id)
        .order_by(Summary.created_at.desc())
        .limit(20)
        .all()
    )
    result = []
    for summary, patient in rows:
        try:
            raw = str(summary.created_at).split("+")[0].split(".")[0]
            dt = datetime.fromisoformat(raw)
            date_str = f"{dt.day} {dt.strftime('%b %Y').upper()}"
        except Exception:
            date_str = str(summary.created_at)[:10]

        text = summary.ai_summary or ""
        snippet = text[:60] + ("…" if len(text) > 60 else "")

        result.append(RecentSessionOut(
            summary_id=str(summary.summary_id),
            patient_name=patient.name,
            date=date_str,
            note_snippet=snippet or "Session recorded",
        ))
    return result


@router.post("/process", response_model=SessionResult)
async def process_session(
    audio: UploadFile = File(...),
    patient_id: str = Form(...),
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Receive recorded audio → verify patient ownership → transcribe → summarise → save → return."""

    # Verify patient belongs to the authenticated clinician
    patient = (
        db.query(Patient)
        .filter(
            Patient.patient_id == uuid.UUID(patient_id),
            Patient.clinician_id == clinician.clinician_id,
        )
        .first()
    )
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Save upload to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp:
        tmp.write(await audio.read())
        tmp_path = tmp.name

    try:
        gemini = get_service()
        transcript, summary = gemini.process_audio(tmp_path)
    except ClientError as e:
        print(f"[sessions] Gemini error — code={e.code} msg={e.message}")
        if e.code == 429:
            raise HTTPException(
                status_code=429,
                detail="Gemini API quota exceeded. Enable billing or wait for daily reset.",
            )
        raise HTTPException(
            status_code=502,
            detail=f"Gemini error ({e.code}): {e.message}",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)

    # Persist to summaries table
    summary_row = Summary(
        patient_id=uuid.UUID(patient_id),
        ai_summary=summary,
        transcription=transcript,
    )
    db.add(summary_row)
    db.commit()
    db.refresh(summary_row)

    return SessionResult(
        transcript=transcript,
        summary=summary,
        patient_id=patient_id,
        summary_id=str(summary_row.summary_id),
    )


@router.patch("/{summary_id}/notes", status_code=200)
def save_notes(
    summary_id: str,
    body: NotesUpdate,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Save clinician notes for a session summary."""
    print(f"[notes] Saving notes for summary={summary_id} clinician={clinician.clinician_id}")

    summary_row = (
        db.query(Summary)
        .join(Patient, Summary.patient_id == Patient.patient_id)
        .filter(
            Summary.summary_id == uuid.UUID(summary_id),
            Patient.clinician_id == clinician.clinician_id,
        )
        .first()
    )

    if not summary_row:
        print(f"[notes] Summary {summary_id} not found for clinician {clinician.clinician_id}")
        raise HTTPException(status_code=404, detail="Summary not found")

    summary_row.clinician_notes = body.notes
    db.commit()
    db.refresh(summary_row)
    print(f"[notes] Saved {len(body.notes)} chars to summary {summary_id}")
    return {"ok": True}
