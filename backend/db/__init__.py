"""
SQLAlchemy ORM models — mirrors the PostgreSQL schema exactly.

clinicians          (clinician_id, email, name, google_id)
patients            (patient_id, name, clinician_id FK, created_at)
groups              (group_id, clinician_id FK, label, created_at)        ← couple/family
group_members       (group_id FK, patient_id FK)                          ← M2M
sessions            (session_id, clinician_id FK, group_id FK, label, created_at)  ← appointment
summaries           (summary_id, patient_id FK, session_id FK, segment_type,
                     ai_summary, transcription, clinician_notes, created_at)       ← one segment
summary_participants(summary_id FK, patient_id FK)                        ← who was present
jobs                (job_id, patient_id FK, clinician_id FK, session_id FK,
                     segment_type, participant_ids, status, summary_id FK,
                     error, audio_path, mime_type, created_at)
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
        Text,
        nullable=False,
        server_default=text("now()"),
    )


class Group(Base):
    """A persistent couple / family — a reusable set of patients seen together."""
    __tablename__ = "groups"

    group_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    clinician_id = Column(
        UUID(as_uuid=True),
        ForeignKey("clinicians.clinician_id"),
        nullable=False,
    )
    label = Column(Text, nullable=False)  # e.g. "Asha & Ravi"
    created_at = Column(
        Text,
        nullable=False,
        server_default=text("now()"),
    )


class GroupMember(Base):
    """M2M join — which patients belong to a group."""
    __tablename__ = "group_members"

    group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("groups.group_id"),
        primary_key=True,
    )
    patient_id = Column(
        UUID(as_uuid=True),
        ForeignKey("patients.patient_id"),
        primary_key=True,
    )


class AppointmentSession(Base):
    """
    One appointment (a single visit). Wraps multiple segment summaries.

    Named AppointmentSession to avoid colliding with SQLAlchemy's Session;
    the table is `sessions`.
    """
    __tablename__ = "sessions"

    session_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    clinician_id = Column(
        UUID(as_uuid=True),
        ForeignKey("clinicians.clinician_id"),
        nullable=False,
    )
    # NULL = solo appointment (no group); set for couple/family visits
    group_id = Column(
        UUID(as_uuid=True),
        ForeignKey("groups.group_id"),
        nullable=True,
    )
    label = Column(Text, nullable=True)  # e.g. "Asha & Ravi"
    created_at = Column(
        Text,
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
    # The appointment this segment belongs to. NULL = legacy solo session.
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sessions.session_id"),
        nullable=True,
    )
    # 'joint' | 'individual' | 'solo' (NULL for legacy rows = solo)
    segment_type = Column(Text, nullable=True)
    ai_summary = Column(Text, nullable=True)
    transcription = Column(Text, nullable=True)
    clinician_notes = Column(Text, nullable=True)
    created_at = Column(
        Text,
        nullable=False,
        server_default=text("now()"),
    )


class SummaryParticipant(Base):
    """
    M2M join — which patients were present in a given segment.

    This is the access list that drives confidentiality: an individual (1:1)
    segment has exactly one participant, and that person's per-view export
    excludes the partner's individual segments.
    """
    __tablename__ = "summary_participants"

    summary_id = Column(
        UUID(as_uuid=True),
        ForeignKey("summaries.summary_id"),
        primary_key=True,
    )
    patient_id = Column(
        UUID(as_uuid=True),
        ForeignKey("patients.patient_id"),
        primary_key=True,
    )


class Job(Base):
    """
    Tracks async processing jobs submitted via POST /api/sessions/process.

    Status lifecycle:
        pending → uploading → transcribing → summarizing → complete
                                                         → failed
    """
    __tablename__ = "jobs"

    job_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    patient_id = Column(
        UUID(as_uuid=True),
        ForeignKey("patients.patient_id"),
        nullable=False,
    )
    clinician_id = Column(
        UUID(as_uuid=True),
        ForeignKey("clinicians.clinician_id"),
        nullable=False,
    )
    # Appointment + segment metadata (NULL for legacy solo jobs)
    session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("sessions.session_id"),
        nullable=True,
    )
    segment_type = Column(Text, nullable=True)  # 'joint' | 'individual' | 'solo'
    # Comma-separated patient UUIDs present in this segment
    participant_ids = Column(Text, nullable=True)
    # Current pipeline stage
    status = Column(Text, nullable=False, default="pending")
    # Set once complete — links to the saved summary
    summary_id = Column(
        UUID(as_uuid=True),
        ForeignKey("summaries.summary_id"),
        nullable=True,
    )
    # Error message if status == "failed"
    error = Column(Text, nullable=True)
    # Local temp file path (deleted after processing)
    audio_path = Column(Text, nullable=True)
    # MIME type detected from the upload (handles iOS audio/mp4 vs webm)
    mime_type = Column(Text, nullable=True, default="audio/webm")
    created_at = Column(
        Text,
        nullable=False,
        server_default=text("now()"),
    )
