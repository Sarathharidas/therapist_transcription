"""
Auth routes
  POST /api/auth/login   — exchange Google credential for app JWT
  GET  /api/auth/me      — return current clinician (token check on page load)
  GET  /api/auth/config  — public: whether the clinic sign-in path is available
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.db import Clinic, ClinicInvite, Clinician
from backend.db.session import get_db
from backend.services.auth import (
    create_jwt,
    get_current_clinician,
    verify_google_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class GoogleLoginRequest(BaseModel):
    credential: str  # Google ID token from frontend
    # Which login path the user picked. Defaults to 'individual' so existing
    # callers/tests keep today's open-signup behaviour.
    mode: str = "individual"  # 'individual' | 'clinic'


class ClinicianOut(BaseModel):
    id: str
    name: str
    email: str
    role: str = "therapist"
    clinic_id: Optional[str] = None
    clinic_name: Optional[str] = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    clinician: ClinicianOut


class AuthConfigOut(BaseModel):
    clinic_enabled: bool


def _clinician_out(db: Session, clinician: Clinician) -> ClinicianOut:
    """Build the API shape, resolving the clinic name when the clinician is in one."""
    clinic_name = None
    if clinician.clinic_id is not None:
        clinic = db.query(Clinic).filter(Clinic.clinic_id == clinician.clinic_id).first()
        clinic_name = clinic.name if clinic else None
    return ClinicianOut(
        id=str(clinician.clinician_id),
        name=clinician.name,
        email=clinician.email,
        role=clinician.role or "therapist",
        clinic_id=str(clinician.clinic_id) if clinician.clinic_id else None,
        clinic_name=clinic_name,
    )


@router.get("/config", response_model=AuthConfigOut)
def auth_config(db: Session = Depends(get_db)):
    """Public — tells the login screen whether to offer the clinic sign-in path."""
    has_clinic = db.query(Clinic.clinic_id).first() is not None
    return AuthConfigOut(clinic_enabled=has_clinic)


@router.post("/login", response_model=LoginResponse)
def google_login(body: GoogleLoginRequest, db: Session = Depends(get_db)):
    """
    Verify the Google credential and resolve the clinician for the chosen path.

    Decision tree (mode defaults to 'individual'):
      - existing clinician      → return as-is, regardless of mode (grandfathered)
      - new email + pending invite → admit to that clinic (any mode)
      - new email, no invite, individual → auto-register a solo account (today's flow)
      - new email, no invite, clinic     → 403, must be invited
    """
    claims = verify_google_token(body.credential)

    google_id: str = claims["sub"]
    email: str = claims.get("email", "")
    name: str = claims.get("name", email)
    email_lc = email.lower()

    # Find by google_id first, then fall back to email (handles existing rows)
    clinician = db.query(Clinician).filter(Clinician.google_id == google_id).first()
    if clinician is None:
        clinician = db.query(Clinician).filter(Clinician.email == email).first()

    if clinician is not None:
        # Returning sign-in — backfill google_id if missing, refresh name
        if clinician.google_id is None:
            clinician.google_id = google_id
        clinician.name = name
        db.commit()
        db.refresh(clinician)
        print(f"[auth] Clinician signed in: {clinician.name} <{clinician.email}>")
        access_token = create_jwt(str(clinician.clinician_id))
        return LoginResponse(access_token=access_token, clinician=_clinician_out(db, clinician))

    # ── New email — look for a pending clinic invite ──────────────────────────
    invite = (
        db.query(ClinicInvite)
        .filter(ClinicInvite.email == email_lc, ClinicInvite.status == "pending")
        .first()
    )

    if invite is None and body.mode == "clinic":
        raise HTTPException(
            status_code=403,
            detail=f"No clinic invitation found for {email} — ask your clinic admin to invite you.",
        )

    # Build the new clinician: solo (no invite) or attached to the invite's clinic
    new_clinician = Clinician(
        email=email,
        name=name,
        google_id=google_id,
        clinic_id=invite.clinic_id if invite else None,
        role=invite.role if invite else "therapist",
    )
    db.add(new_clinician)
    try:
        db.flush()  # assign clinician_id so we can stamp the invite
        if invite is not None:
            invite.status = "accepted"
            invite.accepted_at = datetime.now(tz=timezone.utc).isoformat()
        db.commit()
        db.refresh(new_clinician)
        clinician = new_clinician
        where = f"clinic {invite.clinic_id}" if invite else "solo"
        print(f"[auth] New clinician registered ({where}): {name} <{email}>")
    except IntegrityError:
        # Race: a parallel first sign-in won. Recover by re-querying.
        db.rollback()
        print(f"[auth] Race on first sign-in for {email} — re-querying")
        clinician = (
            db.query(Clinician)
            .filter((Clinician.google_id == google_id) | (Clinician.email == email))
            .first()
        )
        if clinician is None:
            raise HTTPException(
                status_code=500,
                detail="Failed to create account — please try again",
            )

    access_token = create_jwt(str(clinician.clinician_id))
    return LoginResponse(access_token=access_token, clinician=_clinician_out(db, clinician))


@router.get("/me", response_model=ClinicianOut)
def get_me(
    clinician: Clinician = Depends(get_current_clinician),
    db: Session = Depends(get_db),
):
    """Return the currently authenticated clinician (used on page load)."""
    return _clinician_out(db, clinician)
