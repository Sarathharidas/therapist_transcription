"""
Settings routes — per-therapist preferences.

  GET /api/settings/summary-format  — current summary/case-sheet format
  PUT /api/settings/summary-format  — save a custom format (empty = reset to default)

The summary format is the editable Markdown skeleton the AI fills from each
transcript. It is stored on the clinician's own row (clinicians.summary_format);
NULL means "use the built-in DEFAULT_SUMMARY_FORMAT".
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.db import Clinician
from backend.db.session import get_db
from backend.services.auth import get_current_clinician
from backend.services.gemini import DEFAULT_SUMMARY_FORMAT

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SummaryFormatOut(BaseModel):
    format: str          # effective format (custom if set, else the default)
    is_default: bool     # True when the therapist has not customised it
    default: str         # the built-in default, so the UI can offer "Reset"


class SummaryFormatIn(BaseModel):
    format: str


@router.get("/summary-format", response_model=SummaryFormatOut)
def get_summary_format(
    clinician: Clinician = Depends(get_current_clinician),
):
    """Return the therapist's effective summary format and the built-in default."""
    custom = (clinician.summary_format or "").strip()
    return SummaryFormatOut(
        format=custom or DEFAULT_SUMMARY_FORMAT,
        is_default=not custom,
        default=DEFAULT_SUMMARY_FORMAT,
    )


@router.put("/summary-format", response_model=SummaryFormatOut)
def update_summary_format(
    body: SummaryFormatIn,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """
    Save a custom format for this therapist. An empty/whitespace string clears
    the override, reverting future summaries to the built-in default.
    """
    cleaned = (body.format or "").strip()
    # Persist NULL when blank or identical to the default, so "is_default" stays true.
    clinician.summary_format = (
        None if not cleaned or cleaned == DEFAULT_SUMMARY_FORMAT.strip() else body.format
    )
    db.add(clinician)
    db.commit()

    custom = (clinician.summary_format or "").strip()
    return SummaryFormatOut(
        format=custom or DEFAULT_SUMMARY_FORMAT,
        is_default=not custom,
        default=DEFAULT_SUMMARY_FORMAT,
    )
