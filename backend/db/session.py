"""
Database engine + session factory.

Connection pool tuned for serverless Postgres (Neon) where idle
connections are closed after ~5 minutes:
  - pool_pre_ping=True   → ping before checkout, recover from dropped connections
  - pool_recycle=300     → proactively recycle connections every 5 min
  - pool_size=5          → small base pool; therapist app is low-traffic
  - max_overflow=10      → bursts during concurrent uploads

The pool_size/max_overflow args are PostgreSQL-only; SQLite (used in tests)
uses a different pool class that doesn't accept those keywords.
"""

import os
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


def _build_engine():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set in .env")

    kwargs = {"pool_pre_ping": True}
    # Pool sizing only applies to QueuePool (PostgreSQL etc.), not SQLite.
    if not url.startswith("sqlite"):
        kwargs.update(pool_recycle=300, pool_size=5, max_overflow=10)

    return create_engine(url, **kwargs)


engine = _build_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency — yields a DB session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
