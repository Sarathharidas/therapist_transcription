"""
Background job runner for async audio processing.

Called via FastAPI BackgroundTasks — runs in a thread pool so
blocking Gemini API calls don't stall the async event loop.

Each job has its own DB session, fully independent of the HTTP request
that submitted it. This means the job survives even after the HTTP
response has been sent to the client.
"""

import os
import uuid

from backend.db import Clinician, Job, Patient, Summary, SummaryParticipant, UsageRecord
from backend.db.session import SessionLocal
from backend.services.crypto import decrypt, encrypt
from backend.services.gemini import get_service
from backend.services.history import regenerate_patient_overview


def _parse_participant_ids(raw):
    """Parse a comma-separated participant_ids string into a list of UUIDs."""
    if not raw:
        return []
    ids = []
    for part in str(raw).split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(uuid.UUID(part))
        except ValueError:
            pass
    return ids


def run_job(job_id: str) -> None:
    """
    Process one audio job end-to-end:
      pending → uploading → transcribing → summarizing → complete
                                                        → failed

    Always cleans up the local temp audio file and the Gemini
    Files API upload, regardless of success or failure.
    """
    db = SessionLocal()
    audio_path = None

    try:
        # ── Load the job record ──────────────────────────────────────────
        job = db.query(Job).filter(Job.job_id == uuid.UUID(job_id)).first()
        if not job:
            print(f"[job_runner] Job {job_id} not found — skipping")
            return

        audio_path = job.audio_path
        mime_type = job.mime_type or "audio/webm"
        service = get_service()

        # ── Resolve segment metadata + participant names for label hints ──
        participant_ids = _parse_participant_ids(job.participant_ids)
        if not participant_ids:
            participant_ids = [job.patient_id]  # solo / legacy job
        names_hint = [
            decrypt(p.name)
            for p in db.query(Patient).filter(Patient.patient_id.in_(participant_ids)).all()
        ]

        # ── Steps 1+2: Upload + transcribe (parallel chunks for long audio) ──
        job.status = "transcribing"
        db.commit()
        print(f"[job_runner] {job_id} → transcribing")

        transcript = service.transcribe_fast(audio_path, mime_type, names_hint=names_hint)

        # ── Step 3: Summarize ────────────────────────────────────────────
        job.status = "summarizing"
        db.commit()
        print(f"[job_runner] {job_id} → summarizing")

        # Use the owning therapist's custom case-sheet format when set; else default.
        clinician = (
            db.query(Clinician)
            .join(Patient, Patient.clinician_id == Clinician.clinician_id)
            .filter(Patient.patient_id == job.patient_id)
            .first()
        )
        summary_fmt = clinician.summary_format if clinician else None
        summary_text = service.summarize(transcript, fmt=summary_fmt)

        # ── Save result to summaries table (PHI encrypted at rest) ────────
        summary_row = Summary(
            patient_id=job.patient_id,
            session_id=job.session_id,
            segment_type=job.segment_type or "solo",
            ai_summary=encrypt(summary_text),
            transcription=encrypt(transcript),
        )
        db.add(summary_row)
        db.flush()  # gets summary_id without a full commit yet

        # Record who was present in this segment (the confidentiality access list)
        for pid in participant_ids:
            db.add(SummaryParticipant(summary_id=summary_row.summary_id, patient_id=pid))

        # ── Meter usage: log the hours + deduct from an active subscriber's
        #    carry-forward wallet. Trial users are gated by time, not credits, so
        #    their balance is left untouched. Voice notes are never metered.
        #    Prefer the browser-reported duration (no ffprobe dependency); fall
        #    back to ffprobe only if it wasn't sent.
        duration = job.duration_seconds or service._get_duration(audio_path)
        print(f"[job_runner] {job_id} metering: clinician={bool(clinician)} "
              f"duration={duration} status={clinician.subscription_status if clinician else None}")
        if clinician and duration:
            secs = int(duration)
            db.add(UsageRecord(
                clinician_id=clinician.clinician_id,
                seconds=secs,
                kind=job.segment_type or "session",
            ))
            if clinician.subscription_status == "active":
                clinician.seconds_balance = max(0, (clinician.seconds_balance or 0) - secs)

        job.status = "complete"
        job.summary_id = summary_row.summary_id
        db.commit()

        print(f"[job_runner] {job_id} → complete  summary_id={summary_row.summary_id}")

        # Regenerate the patient's running history overview (best-effort) so the
        # next session's recording screen reads it instantly — no LLM on the read
        # path. Failure here must not affect the (already-saved) session.
        try:
            regenerate_patient_overview(db, job.patient_id)
        except Exception as exc:
            db.rollback()
            print(f"[job_runner] {job_id} history overview gen failed: {exc}")

    except Exception as exc:
        print(f"[job_runner] {job_id} → failed: {exc}")
        db.rollback()
        try:
            # Re-query after rollback to get a clean object
            failed_job = db.query(Job).filter(Job.job_id == uuid.UUID(job_id)).first()
            if failed_job:
                failed_job.status = "failed"
                failed_job.error = str(exc)[:500]  # truncate long stack traces
                db.commit()
        except Exception as inner:
            print(f"[job_runner] Could not mark job as failed: {inner}")

    finally:
        # Always delete the local temp audio file
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
                print(f"[job_runner] Cleaned up {audio_path}")
            except Exception:
                pass

        db.close()
