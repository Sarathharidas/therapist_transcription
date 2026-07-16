"""
Auth service — Google token verification + JWT issue/verify + FastAPI dependency.
"""

import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException, Request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy.orm import Session

from backend.db import Clinician
from backend.db.session import get_db
from backend.services.auth_logging import auth_event, request_attempt_id

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7
# Allow a little clock drift between Railway and Google (default is 0)
TOKEN_CLOCK_SKEW_SECONDS = 10


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET", "")
    if not secret:
        raise RuntimeError("JWT_SECRET env var is not set")
    return secret


def verify_google_token(credential: str, attempt_id: Optional[str] = None) -> dict:
    """
    Verify a Google ID token and return its claims.

    Retries once on transient failures (Google's JWK key fetch can fail
    on cold start or during brief network blips). Logs the specific
    exception type so failures are diagnosable in Railway logs.
    """
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID not configured")

    for attempt in range(2):
        try:
            claims = id_token.verify_oauth2_token(
                credential,
                google_requests.Request(),
                client_id,
                clock_skew_in_seconds=TOKEN_CLOCK_SKEW_SECONDS,
            )
            return claims
        except Exception as e:
            auth_event(
                "auth_google_verification_attempt_failed",
                attempt_id,
                verification_attempt=attempt + 1,
                exception_type=type(e).__name__,
            )
            if attempt == 0:
                time.sleep(1)  # brief backoff before second try

    raise HTTPException(
        status_code=401,
        detail="Google token verification failed. Please try again.",
    )


def create_jwt(clinician_id: str) -> str:
    """Issue a signed JWT for the given clinician UUID."""
    payload = {
        "sub": clinician_id,
        "exp": datetime.now(tz=timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def get_current_clinician(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Clinician:
    """FastAPI dependency — extract and verify JWT, return Clinician ORM object."""
    request.state.auth_stage = "aura_jwt_verification"
    request_attempt_id(request)
    if not authorization or not authorization.startswith("Bearer "):
        request.state.auth_outcome = "missing_authorization"
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
        clinician_id: str = payload["sub"]
    except jwt.ExpiredSignatureError:
        request.state.auth_outcome = "aura_jwt_expired"
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        request.state.auth_outcome = "aura_jwt_invalid"
        raise HTTPException(status_code=401, detail="Invalid token")

    try:
        clinician_uuid = uuid.UUID(clinician_id)
    except (TypeError, ValueError, AttributeError):
        request.state.auth_outcome = "aura_jwt_invalid_subject"
        raise HTTPException(status_code=401, detail="Invalid token")

    request.state.auth_stage = "clinician_lookup"
    clinician = db.query(Clinician).filter(
        Clinician.clinician_id == clinician_uuid
    ).first()

    if clinician is None:
        request.state.auth_outcome = "clinician_not_found"
        raise HTTPException(status_code=401, detail="Clinician not found")

    request.state.auth_outcome = "authenticated"
    return clinician


def require_admin(
    clinician: Clinician = Depends(get_current_clinician),
) -> Clinician:
    """
    FastAPI dependency — like get_current_clinician but also requires the
    clinician to be a clinic admin. Used to guard clinic-management routes.
    """
    if clinician.clinic_id is None or (clinician.role or "therapist") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return clinician
