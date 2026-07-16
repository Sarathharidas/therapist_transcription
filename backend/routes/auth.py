"""
Auth routes
  POST /api/auth/login   — exchange Google credential for app JWT
  GET  /api/auth/me      — return current clinician (token check on page load)
  GET  /api/auth/config  — public: whether the clinic sign-in path is available
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.db import Clinic, ClinicInvite, Clinician
from backend.db.session import get_db
from backend.services.billing import TRIAL_DAYS
from backend.services.auth import (
    create_jwt,
    get_current_clinician,
    verify_google_token,
)
from backend.services.auth_logging import (
    auth_event,
    browser_family,
    client_event_allowed,
    normalize_attempt_id,
    request_attempt_id,
    request_origin,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class GoogleLoginRequest(BaseModel):
    credential: str  # Google ID token from frontend
    # Which login path the user picked. Defaults to 'individual' so existing
    # callers/tests keep today's open-signup behaviour.
    mode: str = "individual"  # 'individual' | 'clinic'
    # Required for mode='clinic' — must match the registered clinic name
    clinic_name: Optional[str] = None


class ClinicRegisterRequest(BaseModel):
    credential: str            # Google ID token of the registering admin
    clinic_name: str
    therapist_emails: List[str] = []


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


class AuthClientEventRequest(BaseModel):
    attempt_id: str
    event: str
    mode: Optional[str] = None
    status: Optional[int] = None


_ALLOWED_CLIENT_EVENTS = {
    "google_on_error",
    "google_credential_missing",
    "railway_network_failure",
    "login_http_failure",
    "login_response_invalid",
    "jwt_storage_failure",
    "post_login_unauthorized",
}


def _start_auth_attempt(request: Request, mode: str, event: str) -> str:
    attempt_id = request_attempt_id(request)
    request.state.auth_mode = mode
    request.state.auth_stage = "google_verification"
    auth_event(
        event,
        attempt_id,
        mode=mode,
        origin=request_origin(request),
        browser=browser_family(request),
    )
    return attempt_id


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


def _clinic_by_name(db: Session, name: str) -> Optional[Clinic]:
    """Resolve a clinic by name, case-insensitive and trimmed."""
    n = (name or "").strip()
    if not n:
        return None
    return db.query(Clinic).filter(Clinic.name.ilike(n)).first()


def _start_trial(clinician: Clinician) -> None:
    """Start a 14-day free trial on a newly created clinician (idempotent)."""
    if clinician.subscription_status is None and clinician.trial_ends_at is None:
        clinician.subscription_status = "trial"
        clinician.trial_ends_at = (
            datetime.now(tz=timezone.utc) + timedelta(days=TRIAL_DAYS)
        ).isoformat()


@router.get("/config", response_model=AuthConfigOut)
def auth_config(db: Session = Depends(get_db)):
    """Public — tells the login screen whether to offer the clinic sign-in path."""
    has_clinic = db.query(Clinic.clinic_id).first() is not None
    return AuthConfigOut(clinic_enabled=has_clinic)


@router.post("/client-event", status_code=204)
def auth_client_event(body: AuthClientEventRequest, request: Request):
    """Receive a schema-restricted, PHI-free browser authentication failure."""
    attempt_id = normalize_attempt_id(body.attempt_id)
    request.state.auth_attempt_id = attempt_id
    request.state.auth_mode = body.mode if body.mode in {"individual", "clinic"} else None

    # Silently discard excessive events so this public diagnostic endpoint
    # cannot be used to flood Railway logs.
    if not client_event_allowed(request):
        request.state.auth_outcome = "client_event_rate_limited"
        return Response(status_code=204)

    if body.event not in _ALLOWED_CLIENT_EVENTS:
        request.state.auth_outcome = "client_event_invalid"
        raise HTTPException(status_code=422, detail="Invalid authentication event")

    status = body.status if body.status is not None and 100 <= body.status <= 599 else None
    auth_event(
        "auth_client_failure",
        attempt_id,
        client_event=body.event,
        mode=request.state.auth_mode,
        status=status,
        origin=request_origin(request),
        browser=browser_family(request),
    )
    request.state.auth_outcome = "client_event_recorded"
    return Response(status_code=204)


@router.post("/login", response_model=LoginResponse)
def google_login(
    body: GoogleLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Verify the Google credential and resolve the clinician for the chosen path.

    mode='individual' (default, UNCHANGED):
      - existing clinician → return as-is
      - new email          → auto-register a solo account
    mode='clinic' (requires a matching clinic_name):
      - resolve the clinic by name; existing member → allow; invited email → admit;
        otherwise 403.
    """
    mode = "clinic" if body.mode == "clinic" else "individual"
    attempt_id = _start_auth_attempt(request, mode, "auth_login_started")
    try:
        claims = verify_google_token(body.credential, attempt_id=attempt_id)
    except HTTPException:
        request.state.auth_outcome = "google_verification_failed"
        raise

    google_id: str = claims["sub"]
    email: str = claims.get("email", "")
    name: str = claims.get("name", email)
    email_lc = email.lower()

    # Find by google_id first, then fall back to email (handles existing rows)
    request.state.auth_stage = "clinician_lookup"
    clinician = db.query(Clinician).filter(Clinician.google_id == google_id).first()
    if clinician is None:
        clinician = db.query(Clinician).filter(Clinician.email == email).first()

    # ── Clinic path — must match a registered clinic by name ─────────────────
    if body.mode == "clinic":
        entered = (body.clinic_name or "").strip()

        # 1) Existing member → match against THEIR OWN clinic's name (robust even
        #    if two clinics ever shared a name).
        if clinician is not None and clinician.clinic_id is not None:
            own = db.query(Clinic).filter(Clinic.clinic_id == clinician.clinic_id).first()
            if own is not None and own.name.strip().casefold() == entered.casefold():
                if clinician.google_id is None:
                    clinician.google_id = google_id
                clinician.name = name
                request.state.auth_stage = "database_commit"
                db.commit()
                db.refresh(clinician)
                request.state.auth_stage = "jwt_creation"
                access_token = create_jwt(str(clinician.clinician_id))
                request.state.auth_outcome = "clinic_member_success"
                return LoginResponse(access_token=access_token, clinician=_clinician_out(db, clinician))
            request.state.auth_outcome = "clinic_name_mismatch"
            raise HTTPException(
                status_code=403,
                detail=f"Your account is part of {own.name if own else 'another clinic'}, "
                       f"not {entered or 'that clinic'}.",
            )

        # 2) New email OR an existing solo account → resolve the clinic by name and
        #    require a pending invite for it (lets a prior individual user accept a
        #    later clinic invitation).
        clinic = _clinic_by_name(db, entered)
        if clinic is None:
            request.state.auth_outcome = "clinic_not_found"
            raise HTTPException(
                status_code=403,
                detail="No clinic found with that name — check the name with your admin.",
            )
        invite = (
            db.query(ClinicInvite)
            .filter(
                ClinicInvite.email == email_lc,
                ClinicInvite.clinic_id == clinic.clinic_id,
                ClinicInvite.status == "pending",
            )
            .first()
        )
        if invite is None:
            request.state.auth_outcome = "clinic_invite_missing"
            raise HTTPException(
                status_code=403,
                detail=f"No invitation found for {email} in {clinic.name} — ask your admin.",
            )

        if clinician is not None:
            # Promote the existing solo account into the clinic (keeps their data)
            clinician.clinic_id = clinic.clinic_id
            clinician.role = invite.role
            if clinician.google_id is None:
                clinician.google_id = google_id
            clinician.name = name
        else:
            clinician = Clinician(
                email=email, name=name, google_id=google_id,
                clinic_id=clinic.clinic_id, role=invite.role,
            )
            _start_trial(clinician)
            db.add(clinician)
            db.flush()
        invite.status = "accepted"
        invite.accepted_at = datetime.now(tz=timezone.utc).isoformat()
        request.state.auth_stage = "database_commit"
        db.commit()
        db.refresh(clinician)

        request.state.auth_stage = "jwt_creation"
        access_token = create_jwt(str(clinician.clinician_id))
        request.state.auth_outcome = "clinic_join_success"
        return LoginResponse(access_token=access_token, clinician=_clinician_out(db, clinician))

    # ── Individual path (UNCHANGED) ──────────────────────────────────────────
    if clinician is not None:
        if clinician.google_id is None:
            clinician.google_id = google_id
        clinician.name = name
        request.state.auth_stage = "database_commit"
        db.commit()
        db.refresh(clinician)
        request.state.auth_stage = "jwt_creation"
        access_token = create_jwt(str(clinician.clinician_id))
        request.state.auth_outcome = "individual_existing_success"
        return LoginResponse(access_token=access_token, clinician=_clinician_out(db, clinician))

    new_clinician = Clinician(email=email, name=name, google_id=google_id)
    _start_trial(new_clinician)
    db.add(new_clinician)
    try:
        request.state.auth_stage = "database_commit"
        db.commit()
        db.refresh(new_clinician)
        clinician = new_clinician
    except IntegrityError:
        db.rollback()
        request.state.auth_stage = "clinician_race_requery"
        auth_event("auth_login_race_requery", attempt_id, mode=mode)
        clinician = (
            db.query(Clinician)
            .filter((Clinician.google_id == google_id) | (Clinician.email == email))
            .first()
        )
        if clinician is None:
            request.state.auth_outcome = "database_race_recovery_failed"
            raise HTTPException(
                status_code=500,
                detail="Failed to create account — please try again",
            )

    request.state.auth_stage = "jwt_creation"
    access_token = create_jwt(str(clinician.clinician_id))
    request.state.auth_outcome = "individual_new_success"
    return LoginResponse(access_token=access_token, clinician=_clinician_out(db, clinician))


@router.post("/register-clinic", response_model=LoginResponse, status_code=201)
def register_clinic(
    body: ClinicRegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Self-serve clinic creation. The Google user becomes the clinic admin and the
    provided teammate emails become pending invites. Returns a JWT (logged in).
    """
    attempt_id = _start_auth_attempt(request, "clinic", "auth_clinic_registration_started")
    try:
        claims = verify_google_token(body.credential, attempt_id=attempt_id)
    except HTTPException:
        request.state.auth_outcome = "google_verification_failed"
        raise
    google_id: str = claims["sub"]
    email: str = claims.get("email", "")
    name: str = claims.get("name", email)
    email_lc = email.lower()

    clinic_name = (body.clinic_name or "").strip()
    if not clinic_name:
        request.state.auth_outcome = "clinic_name_missing"
        raise HTTPException(status_code=422, detail="Clinic name is required")
    request.state.auth_stage = "clinic_lookup"
    if _clinic_by_name(db, clinic_name) is not None:
        request.state.auth_outcome = "clinic_already_exists"
        raise HTTPException(status_code=409, detail="A clinic with that name already exists")

    # Resolve the registrant — promote a solo account or create a fresh admin
    request.state.auth_stage = "clinician_lookup"
    clinician = db.query(Clinician).filter(Clinician.google_id == google_id).first()
    if clinician is None:
        clinician = db.query(Clinician).filter(Clinician.email == email).first()
    if clinician is not None and clinician.clinic_id is not None:
        request.state.auth_outcome = "already_in_clinic"
        raise HTTPException(status_code=409, detail="You already belong to a clinic")

    request.state.auth_stage = "database_write"
    clinic = Clinic(name=clinic_name)
    db.add(clinic)
    db.flush()  # assign clinic_id

    if clinician is not None:
        clinician.clinic_id = clinic.clinic_id
        clinician.role = "admin"
        if clinician.google_id is None:
            clinician.google_id = google_id
        clinician.name = name
    else:
        clinician = Clinician(
            email=email, name=name, google_id=google_id,
            clinic_id=clinic.clinic_id, role="admin",
        )
        _start_trial(clinician)
        db.add(clinician)
    db.flush()

    # Pending invites for each distinct teammate email (skip the admin's own)
    seen = set()
    for raw in body.therapist_emails:
        e = (raw or "").strip().lower()
        if not e or "@" not in e or e == email_lc or e in seen:
            continue
        seen.add(e)
        db.add(ClinicInvite(
            clinic_id=clinic.clinic_id, email=e, role="therapist",
            status="pending", invited_by=clinician.clinician_id,
        ))

    request.state.auth_stage = "database_commit"
    db.commit()
    db.refresh(clinician)

    request.state.auth_stage = "jwt_creation"
    access_token = create_jwt(str(clinician.clinician_id))
    request.state.auth_outcome = "clinic_registration_success"
    auth_event(
        "auth_clinic_registration_succeeded",
        attempt_id,
        invite_count=len(seen),
        mode="clinic",
    )
    return LoginResponse(access_token=access_token, clinician=_clinician_out(db, clinician))


@router.get("/me", response_model=ClinicianOut)
def get_me(
    clinician: Clinician = Depends(get_current_clinician),
    db: Session = Depends(get_db),
):
    """Return the currently authenticated clinician (used on page load)."""
    return _clinician_out(db, clinician)
