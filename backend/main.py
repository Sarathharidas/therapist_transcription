"""
Aura Clinical — Backend
FastAPI app: API only. Frontend is deployed separately on Vercel.
"""

import os
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

from backend.db import Base                                    # noqa: E402
from backend.db.session import engine, get_db                  # noqa: E402
from backend.routes.auth import router as auth_router          # noqa: E402
from backend.routes.groups import router as groups_router      # noqa: E402
from backend.routes.patients import router as patients_router  # noqa: E402
from backend.routes.sessions import router as sessions_router  # noqa: E402

app = FastAPI(title="Aura Clinical API", version="2.0.0")

# ── Config validation — fail fast if anything required is missing ─────────
REQUIRED_ENV = ("DATABASE_URL", "GEMINI_API_KEY", "JWT_SECRET", "GOOGLE_CLIENT_ID")
_missing = [k for k in REQUIRED_ENV if not os.getenv(k)]
if _missing:
    raise RuntimeError(
        f"Missing required environment variables: {', '.join(_missing)}"
    )

# ── CORS ───────────────────────────────────────────────────────────────────
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        *([FRONTEND_ORIGIN] if FRONTEND_ORIGIN else []),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global error handler — ensures CORS headers appear on 500s ────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # Log the exception with type so we can diagnose in Railway logs
    print(f"[error] {request.method} {request.url.path} → "
          f"{type(exc).__name__}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
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


# ── Lightweight, idempotent column migrations ─────────────────────────────
# create_all() adds new TABLES but never ALTERs existing ones. These ADD COLUMN
# IF NOT EXISTS statements bring older `summaries`/`jobs` tables up to date for
# the group/couple-therapy feature. Postgres-only — on SQLite (tests) the tables
# are created fresh from the models so the columns already exist.
_COLUMN_MIGRATIONS = (
    "ALTER TABLE summaries ADD COLUMN IF NOT EXISTS session_id UUID",
    "ALTER TABLE summaries ADD COLUMN IF NOT EXISTS segment_type TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS session_id UUID",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS segment_type TEXT",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS participant_ids TEXT",
)


def _run_column_migrations() -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        for stmt in _COLUMN_MIGRATIONS:
            conn.execute(text(stmt))
    print("[startup] Column migrations applied")


# ── Startup: create tables ─────────────────────────────────────────────────
@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    _run_column_migrations()
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
