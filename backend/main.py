"""
Aura Clinical — Backend
FastAPI app: API only. Frontend is deployed separately on Vercel.
"""

import os
import re
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

from backend.db import Base, Clinic, ClinicInvite, Clinician   # noqa: E402
from backend.db.session import engine, get_db, SessionLocal    # noqa: E402
from backend.routes.auth import router as auth_router          # noqa: E402
from backend.routes.clinic import router as clinic_router      # noqa: E402
from backend.routes.groups import router as groups_router      # noqa: E402
from backend.routes.patients import router as patients_router  # noqa: E402
from backend.routes.sessions import router as sessions_router  # noqa: E402
from backend.routes.settings import router as settings_router  # noqa: E402
from backend.routes.billing import router as billing_router    # noqa: E402
from backend.services.auth_logging import (                    # noqa: E402
    AUTH_ATTEMPT_HEADER,
    auth_event,
    browser_family,
    request_attempt_id,
    request_origin,
)

app = FastAPI(title="Aura Clinical API", version="2.0.0")

# ── Config validation — fail fast if anything required is missing ─────────
REQUIRED_ENV = ("DATABASE_URL", "GEMINI_API_KEY", "JWT_SECRET", "GOOGLE_CLIENT_ID")
_missing = [k for k in REQUIRED_ENV if not os.getenv(k)]
if _missing:
    raise RuntimeError(
        f"Missing required environment variables: {', '.join(_missing)}"
    )

# ── CORS ───────────────────────────────────────────────────────────────────
# FRONTEND_ORIGIN may be a comma-separated list (e.g. a custom domain + the
# vercel.app URL). We normalise each entry — trim whitespace and strip a trailing
# slash — because a trailing slash is a common cause of "Disallowed CORS origin":
# browsers send the Origin header with NO trailing slash, so it must match exactly.
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "")
_configured_origins = [o.strip().rstrip("/") for o in FRONTEND_ORIGIN.split(",") if o.strip()]

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    *_configured_origins,
]

# Optionally allow additional origins by regex — e.g. Vercel preview deploys.
# Set FRONTEND_ORIGIN_REGEX, scoped to your project, e.g.:
#   https://therapist-transcription[a-z0-9-]*\.vercel\.app
_origin_regex = (os.getenv("FRONTEND_ORIGIN_REGEX") or "").strip() or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
print(
    f"[startup] CORS allowed origins: {ALLOWED_ORIGINS}"
    + (f" + regex {_origin_regex}" if _origin_regex else "")
)


# ── Authentication observability ─────────────────────────────────────────
_AUTH_TRACE_PATHS = {
    "/api/auth/login",
    "/api/auth/register-clinic",
    "/api/auth/me",
}


def _default_auth_outcome(request: Request, status: int) -> str:
    if request.method == "OPTIONS":
        return "cors_preflight_allowed" if status < 400 else "cors_preflight_rejected"
    if status == 401:
        return "unauthorized"
    if status == 403:
        return "forbidden"
    if status == 422:
        return "request_validation_failed"
    if status >= 500:
        stage = getattr(request.state, "auth_stage", "request")
        return f"{stage}_failed"
    if status < 400:
        return "success"
    return f"http_{status}"


@app.middleware("http")
async def auth_observability(request: Request, call_next):
    """Write PHI-free auth lifecycle records to Railway stdout."""
    path = request.url.path
    trace_auth_path = path in _AUTH_TRACE_PATHS
    if trace_auth_path:
        request_attempt_id(request)
        request.state.auth_stage = "request"

    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as exc:
        if trace_auth_path:
            auth_event(
                "auth_request_completed",
                request_attempt_id(request),
                method=request.method,
                path=path,
                status=500,
                outcome=f"{getattr(request.state, 'auth_stage', 'request')}_failed",
                duration_ms=round((time.perf_counter() - started) * 1000),
                mode=getattr(request.state, "auth_mode", None),
                origin=request_origin(request),
                browser=browser_family(request),
                exception_type=type(exc).__name__,
            )
        raise

    # Trace the three authentication lifecycle routes and every API 401. The
    # latter catches a successful login followed by immediate session rejection.
    should_log = trace_auth_path or (
        path.startswith("/api/") and response.status_code == 401
    )
    if should_log:
        attempt_id = request_attempt_id(request)
        outcome = getattr(request.state, "auth_outcome", None) or _default_auth_outcome(
            request, response.status_code
        )
        response.headers[AUTH_ATTEMPT_HEADER] = attempt_id
        auth_event(
            "auth_request_completed",
            attempt_id,
            method=request.method,
            path=path,
            status=response.status_code,
            outcome=outcome,
            duration_ms=round((time.perf_counter() - started) * 1000),
            mode=getattr(request.state, "auth_mode", None),
            origin=request_origin(request),
            browser=browser_family(request),
        )
    return response


# ── Global error handler ──────────────────────────────────────────────────
# This handler runs OUTSIDE the CORSMiddleware, so its response would otherwise
# lack CORS headers — making a backend 500 appear in the browser as a generic
# "Failed to fetch" that hides the real error. We echo the CORS headers here so
# the actual message reaches the client.
def _cors_headers(request: Request) -> dict:
    origin = request.headers.get("origin")
    if not origin:
        return {}
    allowed = origin in ALLOWED_ORIGINS or (
        _origin_regex is not None and re.fullmatch(_origin_regex, origin) is not None
    )
    if not allowed:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Auth errors may contain identity data inside DB-driver exception strings.
    # The structured auth log already records the safe stage + exception type.
    is_auth_path = request.url.path.startswith("/api/auth/")
    if is_auth_path:
        print(
            f"[error] {request.method} {request.url.path} → "
            f"{type(exc).__name__}: details suppressed",
            flush=True,
        )
    else:
        print(f"[error] {request.method} {request.url.path} → "
              f"{type(exc).__name__}: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Authentication service error" if is_auth_path else str(exc)
        },
        headers=_cors_headers(request),
    )


# ── Health check — used by Railway uptime + monitoring ────────────────────
@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    """
    Liveness + DB connectivity check.

    Returns 200 with {status, db} if everything is reachable,
    503 if the DB ping fails.
    Configure Railway's health check to hit /api/health.
    """
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "ok"}
    except Exception as e:
        print(f"[health] DB ping failed: {type(e).__name__}: {e}")
        return JSONResponse(
            status_code=503,
            content={"status": "degraded", "db": "failed", "error": str(e)},
        )


# ── API routes ─────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(patients_router)
app.include_router(groups_router)
app.include_router(sessions_router)
app.include_router(clinic_router)
app.include_router(settings_router)
app.include_router(billing_router)


# ── Lightweight, idempotent column migrations ─────────────────────────────
# create_all() adds new TABLES but never ALTERs existing ones. These ADD COLUMN
# IF NOT EXISTS statements bring older `summaries`/`jobs`/`clinicians` tables up to
# date for the group/couple-therapy and clinic features. Postgres-only — on SQLite
# (tests) the tables are created fresh from the models so the columns already exist.
_COLUMN_MIGRATIONS = (
    "ALTER TABLE summaries ADD COLUMN IF NOT EXISTS session_id UUID",
    "ALTER TABLE summaries ADD COLUMN IF NOT EXISTS segment_type TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS session_id UUID",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS segment_type TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS participant_ids TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS duration_seconds INTEGER",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS history_overview TEXT",
    "ALTER TABLE patients ADD COLUMN IF NOT EXISTS history_overview_marker TEXT",
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS clinic_id UUID",
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'therapist'",
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS summary_format TEXT",
    # Billing / subscription (Phase 1)
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS seconds_balance INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS plan TEXT",
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS subscription_status TEXT",
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS trial_ends_at TEXT",
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS current_period_end TEXT",
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT",
    "ALTER TABLE clinicians ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT",
)


def _run_column_migrations() -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        for stmt in _COLUMN_MIGRATIONS:
            conn.execute(text(stmt))
    print("[startup] Column migrations applied")


# ── Clinic bootstrap ───────────────────────────────────────────────────────
# Enterprise deployments set CLINIC_NAME + CLINIC_ADMIN_EMAIL. On startup we
# ensure the clinic exists and the admin email can get in as an admin — either
# by promoting an existing clinician row or by leaving a pending admin invite.
# Without these env vars the app stays a plain single-therapist deployment.
def _bootstrap_clinic() -> None:
    name = (os.getenv("CLINIC_NAME") or "").strip()
    admin_email = (os.getenv("CLINIC_ADMIN_EMAIL") or "").strip().lower()
    if not name or not admin_email:
        return

    db = SessionLocal()
    try:
        clinic = db.query(Clinic).filter(Clinic.name == name).first()
        if clinic is None:
            clinic = Clinic(name=name)
            db.add(clinic)
            db.commit()
            db.refresh(clinic)
            print(f"[startup] Clinic created: {name}")

        existing = db.query(Clinician).filter(Clinician.email == admin_email).first()
        if existing is not None:
            changed = False
            if existing.clinic_id is None:
                existing.clinic_id = clinic.clinic_id
                changed = True
            if (existing.role or "therapist") != "admin":
                existing.role = "admin"
                changed = True
            if changed:
                db.commit()
                print(f"[startup] Promoted {admin_email} to clinic admin")
        else:
            pending = (
                db.query(ClinicInvite)
                .filter(
                    ClinicInvite.email == admin_email,
                    ClinicInvite.clinic_id == clinic.clinic_id,
                    ClinicInvite.status == "pending",
                )
                .first()
            )
            if pending is None:
                db.add(ClinicInvite(
                    clinic_id=clinic.clinic_id,
                    email=admin_email,
                    role="admin",
                    status="pending",
                ))
                db.commit()
                print(f"[startup] Pending admin invite created for {admin_email}")
    finally:
        db.close()


# ── Startup: create tables ─────────────────────────────────────────────────
@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    _run_column_migrations()
    _bootstrap_clinic()
    print("[startup] Database tables ready")


# ── Launch ─────────────────────────────────────────────────────────────────
def _open_browser() -> None:
    time.sleep(1.5)
    webbrowser.open("http://localhost:8000")


if __name__ == "__main__":
    threading.Thread(target=_open_browser, daemon=True).start()
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
