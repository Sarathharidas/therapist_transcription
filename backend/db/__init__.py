"""
SQLAlchemy ORM models — mirrors the PostgreSQL schema exactly.

clinics             (clinic_id, name, created_at)                          ← enterprise tenant
clinic_invites      (invite_id, clinic_id FK, email, role, status,
                     invited_by FK, created_at, accepted_at)               ← invite gate
clinicians          (clinician_id, email, name, google_id, clinic_id FK, role)
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

from sqlalchemy import Column, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import text


class Base(DeclarativeBase):
    pass


class Clinic(Base):
    """An enterprise tenant — a clinic that groups multiple clinicians."""
    __tablename__ = "clinics"

    clinic_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name = Column(Text, nullable=False)
    created_at = Column(
        Text,
        nullable=False,
        server_default=text("now()"),
    )


class ClinicInvite(Base):
    """
    A pre-authorized email for a clinic. Because Google verifies the email at
    sign-in, an accepted invite needs no token/email delivery — matching a
    pending invite to the verified Google email is enough to admit the user.
    """
    __tablename__ = "clinic_invites"

    invite_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    clinic_id = Column(
        UUID(as_uuid=True),
        ForeignKey("clinics.clinic_id"),
        nullable=False,
    )
    email = Column(Text, nullable=False)  # always stored lowercased
    role = Column(Text, nullable=False, default="therapist")  # 'admin' | 'therapist'
    status = Column(Text, nullable=False, default="pending")  # pending | accepted | revoked
    invited_by = Column(
        UUID(as_uuid=True),
        ForeignKey("clinicians.clinician_id"),
        nullable=True,
    )
    created_at = Column(
        Text,
        nullable=False,
        server_default=text("now()"),
    )
    accepted_at = Column(Text, nullable=True)


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
    # Clinic membership — NULL = solo / grandfathered individual therapist
    clinic_id = Column(
        UUID(as_uuid=True),
        ForeignKey("clinics.clinic_id"),
        nullable=True,
    )
    role = Column(Text, nullable=False, default="therapist")  # 'admin' | 'therapist'
    # Custom summary/case-sheet format for this therapist. NULL = use the
    # built-in DEFAULT_SUMMARY_FORMAT. Edited via /api/settings/summary-format.
    summary_format = Column(Text, nullable=True)

    # ── Billing / subscription (Phase 1: per-therapist, hours-metered) ──
    # Credit wallet in seconds — unused hours carry forward. Deducted per session,
    # topped up by plan hours on each successful charge. See services/billing.py.
    seconds_balance = Column(Integer, nullable=False, server_default=text("0"))
    plan = Column(Text, nullable=True)                 # 'solo' | 'practice' | NULL
    subscription_status = Column(Text, nullable=True)  # trial|active|past_due|cancelled|expired
    trial_ends_at = Column(Text, nullable=True)        # ISO ts — set at signup (+14d)
    current_period_end = Column(Text, nullable=True)   # ISO ts — next renewal
    razorpay_customer_id = Column(Text, nullable=True)
    razorpay_subscription_id = Column(Text, nullable=True)


class UsageRecord(Base):
    """One row per metered transcription — powers the usage dashboard + history.
    Voice notes are NOT recorded here (they don't count toward hours)."""
    __tablename__ = "usage_records"

    usage_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    clinician_id = Column(
        UUID(as_uuid=True),
        ForeignKey("clinicians.clinician_id"),
        nullable=False,
    )
    seconds = Column(Integer, nullable=False)          # audio duration billed
    kind = Column(Text, nullable=True)                 # 'session' | 'segment'
    created_at = Column(Text, nullable=False, server_default=text("now()"))


class CreditTransaction(Base):
    """One row per credit top-up (subscription charge). Records purchases for the
    dashboard + audit, and doubles as webhook idempotency (unique payment id)."""
    __tablename__ = "credit_transactions"

    txn_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    clinician_id = Column(
        UUID(as_uuid=True),
        ForeignKey("clinicians.clinician_id"),
        nullable=False,
    )
    hours = Column(Integer, nullable=False)              # hours added this charge
    razorpay_payment_id = Column(Text, unique=True, nullable=True)
    period_end = Column(Text, nullable=True)             # ISO ts of the cycle end
    created_at = Column(Text, nullable=False, server_default=text("now()"))


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
    # Recording length reported by the browser — used to meter billing hours
    # without depending on server-side ffprobe.
    duration_seconds = Column(Integer, nullable=True)
    created_at = Column(
        Text,
        nullable=False,
        server_default=text("now()"),
    )
