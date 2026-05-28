"""
Session routes — POST /api/sessions/process
"""

import os
import tempfile
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from google.genai.errors import ClientError
from sqlalchemy.orm import Session

from backend.db import Summary
from backend.db.session import get_db
from backend.models import SessionResult
from backend.services.gemini import get_service

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.post("/process", response_model=SessionResult)
async def process_session(
    audio: UploadFile = File(...),
    patient_id: str = Form(...),
    db: Session = Depends(get_db),
):
    """Receive recorded audio → transcribe → summarise → save → return."""

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
