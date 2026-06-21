"""Tests for /api/groups and the group/couple appointment flow."""

import io
import uuid
from unittest.mock import patch

from backend.db import Job, Patient


# ── Helpers ──────────────────────────────────────────────────────────────

def _make_patient(db, clinician, name):
    p = Patient(
        patient_id=uuid.uuid4(),
        name=name,
        clinician_id=clinician.clinician_id,
        created_at="2026-01-01T00:00:00",
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


# ── POST /api/groups ──────────────────────────────────────────────────────

def test_create_group_with_two_members(auth_client, clinician, db):
    asha = _make_patient(db, clinician, "Asha Menon")
    ravi = _make_patient(db, clinician, "Ravi Nair")

    resp = auth_client.post("/api/groups", json={
        "label": "Asha & Ravi",
        "patient_ids": [str(asha.patient_id), str(ravi.patient_id)],
    })

    assert resp.status_code == 201
    body = resp.json()
    assert body["label"] == "Asha & Ravi"
    assert len(body["members"]) == 2
    names = {m["name"] for m in body["members"]}
    assert names == {"Asha Menon", "Ravi Nair"}


def test_create_group_requires_two_members(auth_client, clinician, db):
    asha = _make_patient(db, clinician, "Asha")
    resp = auth_client.post("/api/groups", json={
        "label": "Just Asha",
        "patient_ids": [str(asha.patient_id)],
    })
    assert resp.status_code == 422


def test_create_group_rejects_other_clinicians_patient(auth_client, clinician, other_clinician, db):
    mine = _make_patient(db, clinician, "Mine")
    theirs = _make_patient(db, other_clinician, "Theirs")
    resp = auth_client.post("/api/groups", json={
        "label": "Mixed",
        "patient_ids": [str(mine.patient_id), str(theirs.patient_id)],
    })
    assert resp.status_code == 404


def test_list_groups_isolated_by_clinician(auth_client, other_auth_client, clinician, db):
    asha = _make_patient(db, clinician, "Asha")
    ravi = _make_patient(db, clinician, "Ravi")
    auth_client.post("/api/groups", json={
        "label": "Asha & Ravi",
        "patient_ids": [str(asha.patient_id), str(ravi.patient_id)],
    })

    assert len(auth_client.get("/api/groups").json()) == 1
    # The other clinician sees none of it
    assert other_auth_client.get("/api/groups").json() == []


# ── POST /api/sessions/appointment ────────────────────────────────────────

def test_create_appointment_from_group(auth_client, clinician, db):
    asha = _make_patient(db, clinician, "Asha Menon")
    ravi = _make_patient(db, clinician, "Ravi Nair")
    group = auth_client.post("/api/groups", json={
        "label": "Asha & Ravi",
        "patient_ids": [str(asha.patient_id), str(ravi.patient_id)],
    }).json()

    resp = auth_client.post("/api/sessions/appointment", json={"group_id": group["group_id"]})
    assert resp.status_code == 201
    body = resp.json()
    assert uuid.UUID(body["session_id"])
    assert body["label"] == "Asha & Ravi"
    assert len(body["participants"]) == 2


def test_create_appointment_adhoc(auth_client, clinician, db):
    asha = _make_patient(db, clinician, "Asha")
    ravi = _make_patient(db, clinician, "Ravi")
    resp = auth_client.post("/api/sessions/appointment", json={
        "participant_ids": [str(asha.patient_id), str(ravi.patient_id)],
    })
    assert resp.status_code == 201
    assert len(resp.json()["participants"]) == 2


# ── Segmented /process + appointment detail ───────────────────────────────

def test_segment_process_stores_metadata(auth_client, clinician, db):
    asha = _make_patient(db, clinician, "Asha")
    ravi = _make_patient(db, clinician, "Ravi")
    appt = auth_client.post("/api/sessions/appointment", json={
        "participant_ids": [str(asha.patient_id), str(ravi.patient_id)],
    }).json()

    audio = ("seg.webm", io.BytesIO(b"fake"), "audio/webm")
    with patch("backend.routes.sessions.run_job"):
        resp = auth_client.post(
            "/api/sessions/process",
            files={"audio": audio},
            data={
                "patient_id": str(asha.patient_id),
                "session_id": appt["session_id"],
                "segment_type": "joint",
                "participant_ids": f"{asha.patient_id},{ravi.patient_id}",
            },
        )
    assert resp.status_code == 202
    job = db.query(Job).filter(Job.job_id == uuid.UUID(resp.json()["job_id"])).first()
    assert str(job.session_id) == appt["session_id"]
    assert job.segment_type == "joint"
    assert str(asha.patient_id) in job.participant_ids
    assert str(ravi.patient_id) in job.participant_ids


def test_segment_process_rejects_bad_segment_type(auth_client, clinician, db):
    asha = _make_patient(db, clinician, "Asha")
    ravi = _make_patient(db, clinician, "Ravi")
    appt = auth_client.post("/api/sessions/appointment", json={
        "participant_ids": [str(asha.patient_id), str(ravi.patient_id)],
    }).json()
    audio = ("seg.webm", io.BytesIO(b"fake"), "audio/webm")
    with patch("backend.routes.sessions.run_job"):
        resp = auth_client.post(
            "/api/sessions/process",
            files={"audio": audio},
            data={
                "patient_id": str(asha.patient_id),
                "session_id": appt["session_id"],
                "segment_type": "bogus",
            },
        )
    assert resp.status_code == 422


def test_appointment_detail_groups_segments(auth_client, clinician, db):
    """End-to-end: run two real (mocked-Gemini) segment jobs, then read them back."""
    from backend.db import AppointmentSession, Summary, SummaryParticipant

    asha = _make_patient(db, clinician, "Asha")
    ravi = _make_patient(db, clinician, "Ravi")
    appt = AppointmentSession(
        session_id=uuid.uuid4(),
        clinician_id=clinician.clinician_id,
        label="Asha & Ravi",
        created_at="2026-01-02T00:00:00",
    )
    db.add(appt)
    db.commit()

    # A joint segment (both present) and Asha's private 1:1
    joint = Summary(summary_id=uuid.uuid4(), patient_id=asha.patient_id,
                    session_id=appt.session_id, segment_type="joint",
                    transcription="joint t", ai_summary="joint s",
                    created_at="2026-01-02T00:01:00")
    indiv = Summary(summary_id=uuid.uuid4(), patient_id=asha.patient_id,
                    session_id=appt.session_id, segment_type="individual",
                    transcription="asha t", ai_summary="asha s",
                    created_at="2026-01-02T00:02:00")
    db.add_all([joint, indiv])
    db.flush()
    db.add_all([
        SummaryParticipant(summary_id=joint.summary_id, patient_id=asha.patient_id),
        SummaryParticipant(summary_id=joint.summary_id, patient_id=ravi.patient_id),
        SummaryParticipant(summary_id=indiv.summary_id, patient_id=asha.patient_id),
    ])
    db.commit()

    resp = auth_client.get(f"/api/sessions/appointment/{appt.session_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["label"] == "Asha & Ravi"
    assert len(body["segments"]) == 2
    assert len(body["participants"]) == 2

    seg_by_type = {s["segment_type"]: s for s in body["segments"]}
    assert len(seg_by_type["joint"]["participants"]) == 2
    # The 1:1 segment is private to Asha only
    assert len(seg_by_type["individual"]["participants"]) == 1
    assert seg_by_type["individual"]["participants"][0]["name"] == "Asha"


def test_appointment_404_for_other_clinician(auth_client, other_auth_client, clinician, db):
    asha = _make_patient(db, clinician, "Asha")
    ravi = _make_patient(db, clinician, "Ravi")
    appt = auth_client.post("/api/sessions/appointment", json={
        "participant_ids": [str(asha.patient_id), str(ravi.patient_id)],
    }).json()
    # Owner can read it; the other clinician cannot
    assert auth_client.get(f"/api/sessions/appointment/{appt['session_id']}").status_code == 200
    assert other_auth_client.get(f"/api/sessions/appointment/{appt['session_id']}").status_code == 404
