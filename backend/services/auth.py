"""
Auth service — Google token verification + JWT issue/verify + FastAPI dependency.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from sqlalchemy.orm import Session

from backend.db import Clinician
from backend.db.session import get_db

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET", "")
    if not secret:
        raise RuntimeError("JWT_SECRET env var is not set")
    return secret


def verify_google_token(credential: str) -> dict:
    """Verify a Google ID token and return its claims."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID not configured")
    try:
        claims = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id,
        )
        return claims
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {e}")


def create_jwt(clinician_id: str) -> str:
    """Issue a signed JWT for the given clinician UUID."""
    payload = {
        "sub": clinician_id,
        "exp": datetime.now(tz=timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def get_current_clinician(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> Clinician:
    """FastAPI dependency — extract and verify JWT, return Clinician ORM object."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
        clinician_id: str = payload["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    from backend.db import Clinician as ClinicianModel
    import uuid
    clinician = db.query(ClinicianModel).filter(
        ClinicianModel.clinician_id == uuid.UUID(clinician_id)
    ).first()

    if clinician is None:
        raise HTTPException(status_code=401, detail="Clinician not found")

    return clinician
