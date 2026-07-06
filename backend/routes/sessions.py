"""
Session routes.

POST /api/sessions/appointment        — start an appointment (group or ad-hoc), returns session_id
POST /api/sessions/process            — submit audio for a segment, returns job_id immediately (202)
GET  /api/sessions/job/{job_id}       — poll job status
GET  /api/sessions/recent             — list recent sessions for sidebar
GET  /api/sessions/appointment/{id}   — fetch an appointment with all its segments
GET  /api/sessions/{summary_id}       — fetch full session detail
PATCH /api/sessions/{summary_id}/notes — save clinician notes
"""

import os
import re
import tempfile
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.db import (
    AppointmentSession,
    Clinician,
    Group,
    GroupMember,
    Job,
    Patient,
    Summary,
    SummaryParticipant,
)
from backend.db.session import get_db
from backend.services.auth import get_current_clinician
from backend.services.crypto import decrypt, encrypt
from backend.services.job_runner import run_job

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

# Valid segment configurations for an appointment
SEGMENT_TYPES = ("joint", "individual", "solo")

# Reject uploads larger than this. A 4-hour webm at 128 kbps is ~230 MB;
# anything beyond ~300 MB is suspect (or someone uploading non-audio).
MAX_UPLOAD_BYTES = 300 * 1024 * 1024  # 300 MB


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
    # Appointment grouping — null for legacy solo sessions
    session_id: Optional[str] = None
    session_label: Optional[str] = None
    segment_type: Optional[str] = None


class SessionDetailOut(BaseModel):
    summary_id: str
    patient_id: str
    patient_name: str
    transcript: str
    summary: str
    clinician_notes: Optional[str]
    date: str


class ParticipantOut(BaseModel):
    patient_id: str
    name: str
    initials: str


class AppointmentCreate(BaseModel):
    group_id: Optional[str] = None
    participant_ids: Optional[List[str]] = None
    label: Optional[str] = None


class AppointmentOut(BaseModel):
    session_id: str
    label: str
    participants: List[ParticipantOut]


class SegmentOut(BaseModel):
    summary_id: str
    segment_type: str
    participants: List[ParticipantOut]
    transcript: str
    summary: str
    clinician_notes: Optional[str]
    date: str


class AppointmentDetailOut(BaseModel):
    session_id: str
    label: str
    date: str
    participants: List[ParticipantOut]
    segments: List[SegmentOut]


# ── Helpers ────────────────────────────────────────────────────────────────

def _format_date(created_at_str) -> str:
    try:
        raw = str(created_at_str).split("+")[0].split(".")[0]
        dt = datetime.fromisoformat(raw)
        return f"{dt.day} {dt.strftime('%b %Y').upper()}"
    except Exception:
        return str(created_at_str)[:10]


def _initials(name: str) -> str:
    return "".join(w[0] for w in name.split() if w)[:2].upper()


def _summary_snippet(text: str, limit: int = 60) -> str:
    """
    Build a clean one-line preview from a Markdown OP Case Sheet summary.

    Prefers the clinical "Summary:" line under Diagnostic Formulation; otherwise
    falls back to the first meaningful line. Strips Markdown markup either way so
    the sidebar never shows raw '##' / '**' / '- ' characters.
    """
    if not text:
        return ""

    def strip_md(s: str) -> str:
        s = re.sub(r"^\s*#{1,6}\s*", "", s)        # heading markers
        s = re.sub(r"^\s*[-*]\s*", "", s)          # bullet markers
        s = s.replace("**", "").replace("*", "")   # bold/italic
        return s.strip()

    # Prefer the Diagnostic Formulation summary value when it carries real content.
    m = re.search(r"\*\*Summary:\*\*\s*(.+)", text)
    if m:
        candidate = strip_md(m.group(1))
        if candidate and candidate.lower() != "not discussed":
            return candidate[:limit] + ("…" if len(candidate) > limit else "")

    # Fallback: first non-empty, non-"Not discussed" line.
    for line in text.splitlines():
        cleaned = strip_md(line)
        if cleaned and cleaned.lower() != "not discussed":
            return cleaned[:limit] + ("…" if len(cleaned) > limit else "")

    return strip_md(text)[:limit]


def _participant_out(p: Patient) -> ParticipantOut:
    return ParticipantOut(patient_id=str(p.patient_id), name=p.name, initials=_initials(p.name))


def _segment_participants(db: Session, summary_id) -> List[Patient]:
    """Patients recorded as present in a given segment, ordered by name."""
    return (
        db.query(Patient)
        .join(SummaryParticipant, SummaryParticipant.patient_id == Patient.patient_id)
        .filter(SummaryParticipant.summary_id == summary_id)
        .order_by(Patient.name.asc())
        .all()
    )


# ── Routes ─────────────────────────────────────────────────────────────────

@router.post("/appointment", response_model=AppointmentOut, status_code=201)
def create_appointment(
    body: AppointmentCreate,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """
    Start an appointment (one visit). Either from a saved group, or ad-hoc from
    a list of participant patient_ids. Returns the session_id used to tag the
    segment recordings that follow.
    """
    participants: List[Patient] = []
    label: Optional[str] = (body.label or "").strip() or None
    group_uuid: Optional[uuid.UUID] = None

    if body.group_id:
        try:
            group_uuid = uuid.UUID(body.group_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid group id")
        group = (
            db.query(Group)
            .filter(
                Group.group_id == group_uuid,
                Group.clinician_id == clinician.clinician_id,
            )
            .first()
        )
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        participants = (
            db.query(Patient)
            .join(GroupMember, GroupMember.patient_id == Patient.patient_id)
            .filter(GroupMember.group_id == group_uuid)
            .order_by(Patient.name.asc())
            .all()
        )
        label = label or group.label
    elif body.participant_ids:
        for pid in body.participant_ids:
            try:
                puid = uuid.UUID(pid)
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Invalid patient id: {pid}")
            owned = (
                db.query(Patient)
                .filter(
                    Patient.patient_id == puid,
                    Patient.clinician_id == clinician.clinician_id,
                )
                .first()
            )
            if not owned:
                raise HTTPException(status_code=404, detail=f"Patient not found: {pid}")
            participants.append(owned)
    else:
        raise HTTPException(status_code=422, detail="Provide a group_id or participant_ids")

    if len(participants) < 2:
        raise HTTPException(status_code=422, detail="An appointment needs at least two participants")

    if not label:
        label = " & ".join(p.name.split()[0] for p in participants)

    appt = AppointmentSession(
        clinician_id=clinician.clinician_id,
        group_id=group_uuid,
        label=label,
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    print(f"[sessions] Appointment {appt.session_id} created — '{label}' ({len(participants)} ppl)")

    return AppointmentOut(
        session_id=str(appt.session_id),
        label=label,
        participants=[_participant_out(p) for p in participants],
    )


@router.post("/process", status_code=202)
async def submit_session(
    request: Request,
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    patient_id: str = Form(...),
    session_id: Optional[str] = Form(None),
    segment_type: Optional[str] = Form(None),
    participant_ids: Optional[str] = Form(None),  # comma-separated patient UUIDs
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """
    Accept an audio upload, save it to a temp file, create a Job row,
    launch background processing, and return the job_id immediately.

    For a solo session, only patient_id is required (unchanged behaviour).
    For a group/couple segment, also pass session_id, segment_type, and
    participant_ids so the result is tagged to the appointment and the
    confidentiality access list is recorded.

    The client polls GET /job/{job_id} to track progress.
    """
    # Early reject on Content-Length — avoids buffering huge bodies before checking
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Audio file too large (max {MAX_UPLOAD_BYTES // 1024 // 1024} MB)",
        )

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

    # ── Validate appointment + segment metadata (group/couple path) ──────
    session_uuid: Optional[uuid.UUID] = None
    if session_id:
        try:
            session_uuid = uuid.UUID(session_id)
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid session id")
        appt = (
            db.query(AppointmentSession)
            .filter(
                AppointmentSession.session_id == session_uuid,
                AppointmentSession.clinician_id == clinician.clinician_id,
            )
            .first()
        )
        if not appt:
            raise HTTPException(status_code=404, detail="Appointment not found")

    if segment_type and segment_type not in SEGMENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid segment_type: {segment_type}")

    # Validate every participant id belongs to this clinician
    clean_participant_ids: List[str] = []
    if participant_ids:
        for pid in participant_ids.split(","):
            pid = pid.strip()
            if not pid:
                continue
            try:
                puid = uuid.UUID(pid)
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Invalid participant id: {pid}")
            owned = (
                db.query(Patient)
                .filter(
                    Patient.patient_id == puid,
                    Patient.clinician_id == clinician.clinician_id,
                )
                .first()
            )
            if not owned:
                raise HTTPException(status_code=404, detail=f"Participant not found: {pid}")
            clean_participant_ids.append(str(puid))

    # Detect MIME type — handles iOS Safari (audio/mp4) vs Chrome/Firefox (audio/webm)
    mime_type = audio.content_type or "audio/webm"
    suffix = ".mp4" if "mp4" in mime_type else ".webm"

    # Save audio to a persistent temp file (must outlive the HTTP request).
    # Defense in depth: also enforce size limit after reading (Content-Length
    # can be missing or lie about chunked uploads).
    job_id = str(uuid.uuid4())
    audio_path = os.path.join(tempfile.gettempdir(), f"aura_{job_id}{suffix}")

    # Stream the upload to disk in fixed-size chunks instead of buffering the
    # whole file in memory. Keeps memory flat regardless of session length and
    # starts writing immediately. Enforce the size cap as we go (Content-Length
    # can be missing or lie on chunked uploads).
    total = 0
    try:
        with open(audio_path, "wb") as f:
            while True:
                chunk = await audio.read(1024 * 1024)  # 1 MB
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Audio file too large (max {MAX_UPLOAD_BYTES // 1024 // 1024} MB)",
                    )
                f.write(chunk)
    except Exception:
        # Clean up the partial temp file on any failure (size cap, or a client
        # disconnect mid-upload) so we don't leak files into the temp dir.
        if os.path.exists(audio_path):
            os.remove(audio_path)
        raise

    size_kb = total // 1024
    print(f"[sessions] Saved {size_kb} KB to {audio_path} (mime={mime_type})")

    # Create job record in DB
    job = Job(
        job_id=uuid.UUID(job_id),
        patient_id=uuid.UUID(patient_id),
        clinician_id=clinician.clinician_id,
        session_id=session_uuid,
        segment_type=segment_type,
        participant_ids=",".join(clean_participant_ids) if clean_participant_ids else None,
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
    """
    Return the 20 most recent segments for the authenticated clinician.

    Each row carries optional appointment grouping (session_id / session_label /
    segment_type) so the sidebar can collapse the segments of one couple/family
    visit into a single entry. Legacy solo sessions have these fields null.
    """
    rows = (
        db.query(Summary, Patient, AppointmentSession)
        .join(Patient, Summary.patient_id == Patient.patient_id)
        .outerjoin(AppointmentSession, Summary.session_id == AppointmentSession.session_id)
        .filter(Patient.clinician_id == clinician.clinician_id)
        .order_by(Summary.created_at.desc())
        .limit(20)
        .all()
    )
    result = []
    for summary, patient, appt in rows:
        snippet = _summary_snippet(decrypt(summary.ai_summary) or "")
        result.append(RecentSessionOut(
            summary_id=str(summary.summary_id),
            patient_name=patient.name,
            date=_format_date(summary.created_at),
            note_snippet=snippet or "Session recorded",
            session_id=str(summary.session_id) if summary.session_id else None,
            session_label=appt.label if appt else None,
            segment_type=summary.segment_type,
        ))
    return result


@router.get("/appointment/{session_id}", response_model=AppointmentDetailOut)
def get_appointment(
    session_id: str,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """
    Fetch an appointment with all of its segments.

    Each segment lists who was present, so the frontend can mark individual
    (1:1) segments as private and offer a per-person view that excludes a
    partner's individual disclosures.
    """
    appt = (
        db.query(AppointmentSession)
        .filter(
            AppointmentSession.session_id == uuid.UUID(session_id),
            AppointmentSession.clinician_id == clinician.clinician_id,
        )
        .first()
    )
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    summaries = (
        db.query(Summary)
        .filter(Summary.session_id == appt.session_id)
        .order_by(Summary.created_at.asc())
        .all()
    )

    segments: List[SegmentOut] = []
    roster: dict = {}  # patient_id → Patient, the union of everyone present
    for s in summaries:
        people = _segment_participants(db, s.summary_id)
        for p in people:
            roster[str(p.patient_id)] = p
        segments.append(SegmentOut(
            summary_id=str(s.summary_id),
            segment_type=s.segment_type or "solo",
            participants=[_participant_out(p) for p in people],
            transcript=decrypt(s.transcription) or "",
            summary=decrypt(s.ai_summary) or "",
            clinician_notes=decrypt(s.clinician_notes),
            date=_format_date(s.created_at),
        ))

    return AppointmentDetailOut(
        session_id=str(appt.session_id),
        label=appt.label or "Appointment",
        date=_format_date(appt.created_at),
        participants=[_participant_out(p) for p in roster.values()],
        segments=segments,
    )


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
        transcript=decrypt(summary.transcription) or "",
        summary=decrypt(summary.ai_summary) or "",
        clinician_notes=decrypt(summary.clinician_notes),
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

    summary_row.clinician_notes = encrypt(body.notes)
    db.commit()
    print(f"[notes] Saved {len(body.notes)} chars to summary {summary_id}")
    return {"ok": True}
