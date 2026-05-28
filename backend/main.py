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
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

from backend.db import Base                                    # noqa: E402
from backend.db.session import engine                          # noqa: E402
from backend.routes.auth import router as auth_router          # noqa: E402
from backend.routes.patients import router as patients_router  # noqa: E402
from backend.routes.sessions import router as sessions_router  # noqa: E402

app = FastAPI(title="Aura Clinical API", version="2.0.0")

# ── CORS ───────────────────────────────────────────────────────────────────
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        *([ FRONTEND_ORIGIN ] if FRONTEND_ORIGIN else []),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API routes ─────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(patients_router)
app.include_router(sessions_router)


# ── Startup: create tables ─────────────────────────────────────────────────
@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
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
