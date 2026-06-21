"""
Shared test fixtures.

Strategy
--------
- SQLite in-memory DB so tests are fast and need no external services.
- PG-specific column types (UUID) are rewritten as the cross-dialect
  SQLAlchemy 2.0 Uuid type at import time.
- server_defaults (gen_random_uuid, now()) are replaced with Python-side
  defaults since SQLite doesn't know either function.
- External APIs (Google OAuth, Gemini) are mocked.
- Auth uses the real JWT signing/verification; only the Google token
  verification step is bypassed.
"""

import datetime
import os
import uuid
from typing import Iterator

# ── Env vars MUST be set before any backend import ────────────────────────
os.environ.setdefault("DATABASE_URL",      "sqlite:///:memory:")
os.environ.setdefault("GEMINI_API_KEY",    "test-gemini-key")
os.environ.setdefault("JWT_SECRET",        "test-jwt-secret-" + "x" * 32)
os.environ.setdefault("GOOGLE_CLIENT_ID",  "test-google-client-id")

import pytest                                            # noqa: E402
import sqlalchemy as sa                                  # noqa: E402
from fastapi.testclient import TestClient                # noqa: E402
from sqlalchemy import create_engine                     # noqa: E402
from sqlalchemy.dialects.postgresql import UUID as PG_UUID  # noqa: E402
from sqlalchemy.orm import sessionmaker                  # noqa: E402
from sqlalchemy.pool import StaticPool                   # noqa: E402

# Build SQLite engine BEFORE importing app/models so the modules pick it up
test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,  # one shared connection across the test session
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

# Patch the engine + SessionLocal into db.session so anything that imports
# `engine` or `SessionLocal` from there gets the SQLite versions
import backend.db.session as _db_session  # noqa: E402
_db_session.engine = test_engine
_db_session.SessionLocal = TestingSessionLocal

# Now safe to import models
from backend.db import (  # noqa: E402
    AppointmentSession,
    Base,
    Clinician,
    Group,
    GroupMember,
    Job,
    Patient,
    Summary,
    SummaryParticipant,
)


# ── Adapt schema for SQLite ──────────────────────────────────────────────
def _patch_schema_for_sqlite() -> None:
    """Replace PG-specific types and defaults so create_all() works in SQLite."""
    for table in Base.metadata.tables.values():
        for col in table.columns:
            # PG UUID → cross-dialect Uuid
            if isinstance(col.type, PG_UUID):
                col.type = sa.Uuid(as_uuid=True)
            # Replace server-side defaults with Python ones
            if col.server_default is not None:
                sd = str(col.server_default.arg) if hasattr(col.server_default, "arg") else ""
                if "gen_random_uuid" in sd:
                    col.server_default = None
                    col.default = sa.ColumnDefault(lambda: uuid.uuid4())
                elif "now()" in sd:
                    col.server_default = None
                    col.default = sa.ColumnDefault(
                        lambda: datetime.datetime.utcnow().isoformat()
                    )


_patch_schema_for_sqlite()
Base.metadata.create_all(bind=test_engine)


# ── Import the app (env is valid, engine is wired, tables exist) ─────────
from backend.db.session import get_db                    # noqa: E402
from backend.main import app                             # noqa: E402
from backend.services.auth import create_jwt             # noqa: E402


def _override_get_db():
    """Yield a session bound to the SQLite test engine."""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db


# ── Per-test cleanup ─────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _clean_db_between_tests() -> Iterator[None]:
    """Wipe all rows between tests so each starts with a fresh DB."""
    yield
    db = TestingSessionLocal()
    try:
        # FK-respecting delete order
        db.query(Job).delete()
        db.query(SummaryParticipant).delete()
        db.query(Summary).delete()
        db.query(GroupMember).delete()
        db.query(AppointmentSession).delete()
        db.query(Group).delete()
        db.query(Patient).delete()
        db.query(Clinician).delete()
        db.commit()
    finally:
        db.close()


# ── Reusable fixtures ────────────────────────────────────────────────────
@pytest.fixture
def db() -> Iterator:
    """Direct DB session for arranging test data."""
    s = TestingSessionLocal()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def client() -> TestClient:
    """Bare HTTP client (no auth)."""
    return TestClient(app)


@pytest.fixture
def clinician(db) -> Clinician:
    """Persisted clinician — the 'self' user in tests."""
    c = Clinician(
        clinician_id=uuid.uuid4(),
        email="alice@clinic.com",
        name="Dr. Alice",
        google_id="google-sub-alice",
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture
def other_clinician(db) -> Clinician:
    """A second clinician used to verify data isolation between users."""
    c = Clinician(
        clinician_id=uuid.uuid4(),
        email="bob@clinic.com",
        name="Dr. Bob",
        google_id="google-sub-bob",
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@pytest.fixture
def auth_client(client, clinician) -> TestClient:
    """Client with a valid JWT for the test clinician."""
    token = create_jwt(str(clinician.clinician_id))
    client.headers.update({"Authorization": f"Bearer {token}"})
    return client


@pytest.fixture
def other_auth_client(client, other_clinician) -> TestClient:
    """Client authenticated as the OTHER clinician — used to assert isolation."""
    c = TestClient(app)
    token = create_jwt(str(other_clinician.clinician_id))
    c.headers.update({"Authorization": f"Bearer {token}"})
    return c


@pytest.fixture
def patient(db, clinician) -> Patient:
    """Persisted patient owned by the test clinician."""
    p = Patient(
        patient_id=uuid.uuid4(),
        name="Test Patient",
        clinician_id=clinician.clinician_id,
        created_at="2026-01-01T00:00:00",
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p
