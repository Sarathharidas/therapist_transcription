"""Tests for /api/sessions endpoints."""

import io
import uuid
from datetime import datetime, timedelta
from unittest.mock import patch

from backend.db import Job, Patient, Summary


# ── Helpers ──────────────────────────────────────────────────────────────

def _make_summary(db, patient, transcript="t", summary="s", notes=None, days_ago=0):
    """Create + persist a Summary row, optionally backdated."""
    when = (datetime.utcnow() - timedelta(days=days_ago)).isoformat()
    s = Summary(
        summary_id=uuid.uuid4(),
        patient_id=patient.patient_id,
        transcription=transcript,
        ai_summary=summary,
        clinician_notes=notes,
        created_at=when,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


# ── POST /api/sessions/process ───────────────────────────────────────────

def test_submit_session_creates_job_and_returns_id(auth_client, patient, db):
    """Posting audio should immediately return a job_id (background task starts)."""
    audio = ("session.webm", io.BytesIO(b"fake-audio-bytes"), "audio/webm")

    # Don't actually run the background job — patch it to a no-op
    with patch("backend.routes.sessions.run_job"):
        resp = auth_client.post(
            "/api/sessions/process",
            files={"audio": audio},
            data={"patient_id": str(patient.patient_id)},
        )

    assert resp.status_code == 202
    body = resp.json()
    assert "job_id" in body
    assert uuid.UUID(body["job_id"])  # parseable

    # Job row was created
    job = db.query(Job).filter(Job.job_id == uuid.UUID(body["job_id"])).first()
    assert job is not None
    assert job.status == "pending"
    assert job.patient_id == patient.patient_id
    assert job.mime_type == "audio/webm"


def test_submit_session_rejects_wrong_clinicians_patient(
    auth_client, other_clinician, db,
):
    """Trying to record for another clinician's patient → 404."""
    other_patient = Patient(
        patient_id=uuid.uuid4(),
        name="Not Mine",
        clinician_id=other_clinician.clinician_id,
        created_at="2026-01-01T00:00:00",
    )
    db.add(other_patient)
    db.commit()

    audio = ("s.webm", io.BytesIO(b"x"), "audio/webm")
    with patch("backend.routes.sessions.run_job"):
        resp = auth_client.post(
            "/api/sessions/process",
            files={"audio": audio},
            data={"patient_id": str(other_patient.patient_id)},
        )

    assert resp.status_code == 404


def test_submit_session_requires_auth(client, patient):
    audio = ("s.webm", io.BytesIO(b"x"), "audio/webm")
    resp = client.post(
        "/api/sessions/process",
        files={"audio": audio},
        data={"patient_id": str(patient.patient_id)},
    )
    assert resp.status_code == 401


def test_submit_session_rejects_oversized_upload(auth_client, patient):
    """Content-Length over the limit should be rejected with 413, not buffered."""
    audio = ("s.webm", io.BytesIO(b"x"), "audio/webm")
    huge_size = 400 * 1024 * 1024  # 400 MB, over the 300 MB cap
    with patch("backend.routes.sessions.run_job"):
        resp = auth_client.post(
            "/api/sessions/process",
            files={"audio": audio},
            data={"patient_id": str(patient.patient_id)},
            headers={"Content-Length": str(huge_size)},
        )
    assert resp.status_code == 413


def test_submit_session_preserves_ios_mime_type(auth_client, patient, db):
    """iPhone uploads come as audio/mp4 — we should record that on the Job."""
    audio = ("session.m4a", io.BytesIO(b"x"), "audio/mp4")
    with patch("backend.routes.sessions.run_job"):
        resp = auth_client.post(
            "/api/sessions/process",
            files={"audio": audio},
            data={"patient_id": str(patient.patient_id)},
        )

    assert resp.status_code == 202
    job = db.query(Job).filter(Job.job_id == uuid.UUID(resp.json()["job_id"])).first()
    assert job.mime_type == "audio/mp4"


# ── GET /api/sessions/job/{job_id} ───────────────────────────────────────

def test_get_job_status_returns_current_state(auth_client, clinician, patient, db):
    job = Job(
        job_id=uuid.uuid4(),
        patient_id=patient.patient_id,
        clinician_id=clinician.clinician_id,
        status="transcribing",
    )
    db.add(job)
    db.commit()

    resp = auth_client.get(f"/api/sessions/job/{job.job_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "transcribing"
    assert body["summary_id"] is None
    assert body["error"] is None


def test_get_job_status_returns_summary_id_when_complete(
    auth_client, clinician, patient, db,
):
    summary = _make_summary(db, patient)
    job = Job(
        job_id=uuid.uuid4(),
        patient_id=patient.patient_id,
        clinician_id=clinician.clinician_id,
        status="complete",
        summary_id=summary.summary_id,
    )
    db.add(job)
    db.commit()

    resp = auth_client.get(f"/api/sessions/job/{job.job_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "complete"
    assert body["summary_id"] == str(summary.summary_id)


def test_get_job_status_404_for_other_clinicians_job(
    auth_client, other_clinician, db,
):
    other_patient = Patient(
        patient_id=uuid.uuid4(),
        name="x",
        clinician_id=other_clinician.clinician_id,
        created_at="2026-01-01T00:00:00",
    )
    db.add(other_patient)
    db.commit()

    job = Job(
        job_id=uuid.uuid4(),
        patient_id=other_patient.patient_id,
        clinician_id=other_clinician.clinician_id,
        status="transcribing",
    )
    db.add(job)
    db.commit()

    resp = auth_client.get(f"/api/sessions/job/{job.job_id}")
    assert resp.status_code == 404


def test_stuck_job_marked_failed_after_15_minutes(
    auth_client, clinician, patient, db,
):
    """Polling a job older than 15 minutes that hasn't completed should auto-fail it."""
    stale_created = (datetime.utcnow() - timedelta(minutes=20)).isoformat()
    job = Job(
        job_id=uuid.uuid4(),
        patient_id=patient.patient_id,
        clinician_id=clinician.clinician_id,
        status="transcribing",
        created_at=stale_created,
    )
    db.add(job)
    db.commit()

    resp = auth_client.get(f"/api/sessions/job/{job.job_id}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "failed"
    assert "timed out" in resp.json()["error"].lower()

    # And the DB row was actually updated
    db.refresh(job)
    assert job.status == "failed"


def test_recent_jobs_not_marked_failed(auth_client, clinician, patient, db):
    """A fresh job in 'transcribing' state should NOT be auto-failed."""
    job = Job(
        job_id=uuid.uuid4(),
        patient_id=patient.patient_id,
        clinician_id=clinician.clinician_id,
        status="transcribing",
        created_at=datetime.utcnow().isoformat(),
    )
    db.add(job)
    db.commit()

    resp = auth_client.get(f"/api/sessions/job/{job.job_id}")
    assert resp.json()["status"] == "transcribing"  # unchanged


# ── GET /api/sessions/recent ─────────────────────────────────────────────

def test_recent_sessions_returns_owned_summaries_in_reverse_chronological(
    auth_client, patient, db,
):
    old = _make_summary(db, patient, summary="Old session", days_ago=10)
    new = _make_summary(db, patient, summary="New session", days_ago=1)

    resp = auth_client.get("/api/sessions/recent")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert body[0]["summary_id"] == str(new.summary_id)  # newest first
    assert body[1]["summary_id"] == str(old.summary_id)


def test_recent_sessions_excludes_other_clinicians(
    auth_client, other_clinician, db,
):
    other_patient = Patient(
        patient_id=uuid.uuid4(),
        name="x",
        clinician_id=other_clinician.clinician_id,
        created_at="2026-01-01T00:00:00",
    )
    db.add(other_patient)
    db.commit()
    _make_summary(db, other_patient, summary="Theirs not mine")

    resp = auth_client.get("/api/sessions/recent")
    assert resp.status_code == 200
    assert resp.json() == []


def test_recent_sessions_limits_to_20(auth_client, patient, db):
    for i in range(25):
        _make_summary(db, patient, summary=f"Session {i}", days_ago=i)
    resp = auth_client.get("/api/sessions/recent")
    assert len(resp.json()) == 20


# ── GET /api/sessions/{summary_id} ───────────────────────────────────────

def test_get_session_returns_full_detail(auth_client, patient, db):
    s = _make_summary(db, patient,
                      transcript="Therapist: Hi\nPatient: Hello",
                      summary="They chatted",
                      notes="Patient seems well")

    resp = auth_client.get(f"/api/sessions/{s.summary_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary_id"] == str(s.summary_id)
    assert body["transcript"] == "Therapist: Hi\nPatient: Hello"
    assert body["summary"] == "They chatted"
    assert body["clinician_notes"] == "Patient seems well"
    assert body["patient_name"] == patient.name


def test_get_session_404_for_other_clinicians_summary(
    auth_client, other_clinician, db,
):
    other_patient = Patient(
        patient_id=uuid.uuid4(),
        name="x",
        clinician_id=other_clinician.clinician_id,
        created_at="2026-01-01T00:00:00",
    )
    db.add(other_patient)
    db.commit()
    s = _make_summary(db, other_patient)

    resp = auth_client.get(f"/api/sessions/{s.summary_id}")
    assert resp.status_code == 404


# ── PATCH /api/sessions/{summary_id}/notes ───────────────────────────────

def test_save_notes_persists_for_owner(auth_client, patient, db):
    s = _make_summary(db, patient)

    resp = auth_client.patch(
        f"/api/sessions/{s.summary_id}/notes",
        json={"notes": "Follow up in 2 weeks"},
    )
    assert resp.status_code == 200

    db.refresh(s)
    assert s.clinician_notes == "Follow up in 2 weeks"


def test_save_notes_overwrites_existing(auth_client, patient, db):
    s = _make_summary(db, patient, notes="First version")

    resp = auth_client.patch(
        f"/api/sessions/{s.summary_id}/notes",
        json={"notes": "Updated version"},
    )
    assert resp.status_code == 200

    db.refresh(s)
    assert s.clinician_notes == "Updated version"


def test_save_notes_404_for_other_clinicians_summary(
    auth_client, other_clinician, db,
):
    other_patient = Patient(
        patient_id=uuid.uuid4(),
        name="x",
        clinician_id=other_clinician.clinician_id,
        created_at="2026-01-01T00:00:00",
    )
    db.add(other_patient)
    db.commit()
    s = _make_summary(db, other_patient)

    resp = auth_client.patch(
        f"/api/sessions/{s.summary_id}/notes",
        json={"notes": "Trying to write to another clinician's session"},
    )
    assert resp.status_code == 404


def test_save_notes_requires_auth(client, patient, db):
    s = _make_summary(db, patient)
    resp = client.patch(
        f"/api/sessions/{s.summary_id}/notes",
        json={"notes": "unauthorized"},
    )
    assert resp.status_code == 401
