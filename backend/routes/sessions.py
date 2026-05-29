"""
Session routes.

POST /api/sessions/process      — submit audio, returns job_id immediately (202)
GET  /api/sessions/job/{job_id} — poll job status
GET  /api/sessions/recent       — list recent sessions for sidebar
GET  /api/sessions/{summary_id} — fetch full session detail
PATCH /api/sessions/{summary_id}/notes — save clinician notes
"""

import os
import tempfile
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.db import Clinician, Job, Patient, Summary
from backend.db.session import get_db
from backend.services.auth import get_current_clinician
from backend.services.job_runner import run_job

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


# ── Pydantic models ────────────────────────────────────────────────────────

class NotesUpdate(BaseModel):
    notes: str


class JobStatusOut(BaseModel):
    job_id: str
    status: str   # pending | uploading | transcribing | summarizing | complete | failed
    summary_id: Optional[str]
    error: Optional[str]


class RecentSessionOut(BaseModel):
    summary_id: str
    patient_name: str
    date: str
    note_snippet: str


class SessionDetailOut(BaseModel):
    summary_id: str
    patient_id: str
    patient_name: str
    transcript: str
    summary: str
    clinician_notes: Optional[str]
    date: str


# ── Helper ─────────────────────────────────────────────────────────────────

def _format_date(created_at_str) -> str:
    try:
        raw = str(created_at_str).split("+")[0].split(".")[0]
        dt = datetime.fromisoformat(raw)
        return f"{dt.day} {dt.strftime('%b %Y').upper()}"
    except Exception:
        return str(created_at_str)[:10]


# ── Routes ─────────────────────────────────────────────────────────────────

@router.post("/process", status_code=202)
async def submit_session(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    patient_id: str = Form(...),
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """
    Accept an audio upload, save it to a temp file, create a Job row,
    launch background processing, and return the job_id immediately.

    The client polls GET /job/{job_id} to track progress.
    """
    # Verify patient belongs to this clinician
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

    # Detect MIME type — handles iOS Safari (audio/mp4) vs Chrome/Firefox (audio/webm)
    mime_type = audio.content_type or "audio/webm"
    suffix = ".mp4" if "mp4" in mime_type else ".webm"

    # Save audio to a persistent temp file (must outlive the HTTP request)
    job_id = str(uuid.uuid4())
    audio_path = os.path.join(tempfile.gettempdir(), f"aura_{job_id}{suffix}")
    content = await audio.read()
    with open(audio_path, "wb") as f:
        f.write(content)

    size_kb = len(content) // 1024
    print(f"[sessions] Saved {size_kb} KB to {audio_path} (mime={mime_type})")

    # Create job record in DB
    job = Job(
        job_id=uuid.UUID(job_id),
        patient_id=uuid.UUID(patient_id),
        clinician_id=clinician.clinician_id,
        status="pending",
        audio_path=audio_path,
        mime_type=mime_type,
    )
    db.add(job)
    db.commit()

    # Launch background processing — does NOT block the response.
    # FastAPI runs sync background tasks in a thread pool via starlette.
    background_tasks.add_task(run_job, job_id)

    print(f"[sessions] Job {job_id} queued for patient {patient_id}")
    return {"job_id": job_id}


@router.get("/job/{job_id}", response_model=JobStatusOut)
def get_job_status(
    job_id: str,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """
    Poll the status of a processing job.

    Also implements a stuck-job detector: if a job hasn't reached a
    terminal state within 15 minutes of creation, it is marked as failed.
    This handles Railway restarts that kill in-flight background threads.
    """
    job = (
        db.query(Job)
        .filter(
            Job.job_id == uuid.UUID(job_id),
            Job.clinician_id == clinician.clinician_id,
        )
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Stuck-job detection
    if job.status not in ("complete", "failed"):
        try:
            raw = str(job.created_at).split("+")[0].split(".")[0]
            created = datetime.fromisoformat(raw)
            age_minutes = (datetime.utcnow() - created).total_seconds() / 60
            if age_minutes > 15:
                job.status = "failed"
                job.error = (
                    "Processing timed out — the server may have restarted mid-job. "
                    "Please try recording again."
                )
                db.commit()
                print(f"[sessions] Job {job_id} marked failed (stuck > 15 min)")
        except Exception:
            pass

    return JobStatusOut(
        job_id=str(job.job_id),
        status=job.status,
        summary_id=str(job.summary_id) if job.summary_id else None,
        error=job.error,
    )


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
        text = summary.ai_summary or ""
        snippet = text[:60] + ("…" if len(text) > 60 else "")
        result.append(RecentSessionOut(
            summary_id=str(summary.summary_id),
            patient_name=patient.name,
            date=_format_date(summary.created_at),
            note_snippet=snippet or "Session recorded",
        ))
    return result


@router.get("/{summary_id}", response_model=SessionDetailOut)
def get_session(
    summary_id: str,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Fetch full session detail for the summary view."""
    row = (
        db.query(Summary, Patient)
        .join(Patient, Summary.patient_id == Patient.patient_id)
        .filter(
            Summary.summary_id == uuid.UUID(summary_id),
            Patient.clinician_id == clinician.clinician_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Session not found")

    summary, patient = row
    return SessionDetailOut(
        summary_id=str(summary.summary_id),
        patient_id=str(summary.patient_id),
        patient_name=patient.name,
        transcript=summary.transcription or "",
        summary=summary.ai_summary or "",
        clinician_notes=summary.clinician_notes,
        date=_format_date(summary.created_at),
    )


@router.patch("/{summary_id}/notes", status_code=200)
def save_notes(
    summary_id: str,
    body: NotesUpdate,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Save clinician notes for a session summary."""
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
        raise HTTPException(status_code=404, detail="Summary not found")

    summary_row.clinician_notes = body.notes
    db.commit()
    print(f"[notes] Saved {len(body.notes)} chars to summary {summary_id}")
    return {"ok": True}
