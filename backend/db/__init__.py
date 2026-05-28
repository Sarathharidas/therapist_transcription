"""
SQLAlchemy ORM models — mirrors the PostgreSQL schema exactly.

clinicians (clinician_id, email, name)
patients   (patient_id, name, clinician_id FK, created_at)
summaries  (summary_id, patient_id FK, ai_summary, transcription, created_at)
"""

from sqlalchemy import Column, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import text


class Base(DeclarativeBase):
    pass


class Clinician(Base):
    __tablename__ = "clinicians"

    clinician_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    email = Column(Text, unique=True, nullable=False)
    name = Column(Text, nullable=False)
    google_id = Column(Text, unique=True, nullable=True)  # Google 'sub' claim


class Patient(Base):
    __tablename__ = "patients"

    patient_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = Column(Text, nullable=False)
    clinician_id = Column(
        UUID(as_uuid=True),
        ForeignKey("clinicians.clinician_id"),
        nullable=False,
    )
    created_at = Column(
        Text,  # stored as TIMESTAMPTZ, read back as string via psycopg2
        nullable=False,
        server_default=text("now()"),
    )


class Summary(Base):
    __tablename__ = "summaries"

    summary_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    patient_id = Column(
        UUID(as_uuid=True),
        ForeignKey("patients.patient_id"),
        nullable=False,
    )
    ai_summary = Column(Text, nullable=True)
    transcription = Column(Text, nullable=True)
    created_at = Column(
        Text,
        nullable=False,
        server_default=text("now()"),
    )
