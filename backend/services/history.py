"""
Patient history overview — the running LLM synthesis shown on the recording
screen. Generated on the WRITE path (after each session, in the background job)
and stored encrypted on the patient, so the read path is instant (no LLM call).

Shared by the job runner (after each session) and the one-time backfill script.
"""

from sqlalchemy.orm import Session

from backend.db import Patient, Summary
from backend.services.crypto import decrypt, encrypt
from backend.services.gemini import get_service

RECENT_N = 5  # how many recent sessions the overview synthesises


def regenerate_patient_overview(db: Session, patient_id) -> bool:
    """
    (Re)generate + store a patient's history overview from their most recent
    summaries. Returns True if an overview was written. No-op (False) when the
    patient has no summaries or the LLM returns nothing. Best-effort — the caller
    should guard against exceptions so a failure never breaks the session.
    """
    summaries = (
        db.query(Summary)
        .filter(Summary.patient_id == patient_id)
        .order_by(Summary.created_at.desc())
        .limit(RECENT_N)
        .all()
    )
    if not summaries:
        return False

    texts = [decrypt(s.ai_summary) or "" for s in summaries]
    overview = get_service().summarize_history(texts)
    if not overview or not overview.strip():
        return False

    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    if patient is None:
        return False

    total = db.query(Summary).filter(Summary.patient_id == patient_id).count()
    patient.history_overview = encrypt(overview)
    patient.history_overview_marker = f"{total}:{summaries[0].summary_id}"
    db.commit()
    return True
