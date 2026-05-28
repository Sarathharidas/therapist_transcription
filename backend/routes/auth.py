"""
Auth routes
  POST /api/auth/login  — exchange Google credential for app JWT
  GET  /api/auth/me     — return current clinician (token check on page load)
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.db import Clinician
from backend.db.session import get_db
from backend.services.auth import (
    create_jwt,
    get_current_clinician,
    verify_google_token,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


# ── Pydantic shapes ────────────────────────────────────────────────────────

class GoogleLoginRequest(BaseModel):
    credential: str  # Google ID token from frontend


class ClinicianOut(BaseModel):
    id: str
    name: str
    email: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    clinician: ClinicianOut


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
def google_login(body: GoogleLoginRequest, db: Session = Depends(get_db)):
    """Verify Google credential, create or find clinician, return JWT."""
    claims = verify_google_token(body.credential)

    google_id: str = claims["sub"]
    email: str = claims.get("email", "")
    name: str = claims.get("name", email)

    # Find by google_id first, then fall back to email (handles existing rows)
    clinician = db.query(Clinician).filter(Clinician.google_id == google_id).first()
    if clinician is None:
        clinician = db.query(Clinician).filter(Clinician.email == email).first()

    if clinician is None:
        # First time sign-in — register the clinician
        clinician = Clinician(email=email, name=name, google_id=google_id)
        db.add(clinician)
        print(f"[auth] New clinician registered: {name} <{email}>")
    else:
        # Update google_id if not set, and refresh name
        if clinician.google_id is None:
            clinician.google_id = google_id
        clinician.name = name
        print(f"[auth] Clinician signed in: {clinician.name} <{clinician.email}>")

    db.commit()
    db.refresh(clinician)

    access_token = create_jwt(str(clinician.clinician_id))

    return LoginResponse(
        access_token=access_token,
        clinician=ClinicianOut(
            id=str(clinician.clinician_id),
            name=clinician.name,
            email=clinician.email,
        ),
    )


@router.get("/me", response_model=ClinicianOut)
def get_me(clinician: Clinician = Depends(get_current_clinician)):
    """Return the currently authenticated clinician (used on page load)."""
    return ClinicianOut(
        id=str(clinician.clinician_id),
        name=clinician.name,
        email=clinician.email,
    )
