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

from backend.db import Job, Summary
from backend.db.session import SessionLocal
from backend.services.gemini import get_service


def run_job(job_id: str) -> None:
    """
    Process one audio job end-to-end:
      pending → uploading → transcribing → summarizing → complete
                                                        → failed

    Always cleans up the local temp audio file and the Gemini
    Files API upload, regardless of success or failure.
    """
    db = SessionLocal()
    gemini_file = None
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

        # ── Step 1: Upload to Gemini Files API ───────────────────────────
        job.status = "uploading"
        db.commit()
        print(f"[job_runner] {job_id} → uploading")

        gemini_file = service.upload_file(audio_path, mime_type)

        # ── Step 2: Transcribe ───────────────────────────────────────────
        job.status = "transcribing"
        db.commit()
        print(f"[job_runner] {job_id} → transcribing")

        transcript = service.transcribe(gemini_file, mime_type)

        # ── Step 3: Summarize ────────────────────────────────────────────
        job.status = "summarizing"
        db.commit()
        print(f"[job_runner] {job_id} → summarizing")

        summary_text = service.summarize(transcript)

        # ── Save result to summaries table ───────────────────────────────
        summary_row = Summary(
            patient_id=job.patient_id,
            ai_summary=summary_text,
            transcription=transcript,
        )
        db.add(summary_row)
        db.flush()  # gets summary_id without a full commit yet

        job.status = "complete"
        job.summary_id = summary_row.summary_id
        db.commit()

        print(f"[job_runner] {job_id} → complete  summary_id={summary_row.summary_id}")

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
        # Always delete the Gemini Files API upload
        if gemini_file is not None:
            try:
                get_service().delete_file(gemini_file)
            except Exception:
                pass

        # Always delete the local temp audio file
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
                print(f"[job_runner] Cleaned up {audio_path}")
            except Exception:
                pass

        db.close()
