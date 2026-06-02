"""Tests for /api/patients (list + create) and cross-clinician isolation."""

import uuid

from backend.db import Patient


def test_list_patients_empty_for_new_clinician(auth_client):
    resp = auth_client.get("/api/patients")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_patients_returns_owned_patients(auth_client, patient):
    resp = auth_client.get("/api/patients")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["name"] == "Test Patient"
    assert body[0]["initials"] == "TP"
    assert body[0]["patient_id"] == str(patient.patient_id)


def test_list_patients_excludes_other_clinicians_patients(
    auth_client, other_clinician, db,
):
    """Strict ownership isolation: I must NOT see patients from another clinician."""
    other_patient = Patient(
        patient_id=uuid.uuid4(),
        name="Not Mine",
        clinician_id=other_clinician.clinician_id,
        created_at="2026-01-01T00:00:00",
    )
    db.add(other_patient)
    db.commit()

    resp = auth_client.get("/api/patients")
    assert resp.status_code == 200
    assert resp.json() == []  # I see zero patients despite one existing in DB


def test_list_patients_requires_auth(client):
    resp = client.get("/api/patients")
    assert resp.status_code == 401


def test_create_patient_persists_with_correct_owner(auth_client, clinician, db):
    resp = auth_client.post("/api/patients", json={"name": "John Doe"})

    assert resp.status_code == 201
    body = resp.json()
    assert body["name"] == "John Doe"
    assert body["initials"] == "JD"
    assert body["patient_id"]

    # Verify ownership in DB
    row = db.query(Patient).filter(Patient.patient_id == uuid.UUID(body["patient_id"])).first()
    assert row is not None
    assert row.clinician_id == clinician.clinician_id


def test_create_patient_strips_whitespace(auth_client):
    resp = auth_client.post("/api/patients", json={"name": "  Whitespace Test  "})
    assert resp.status_code == 201
    assert resp.json()["name"] == "Whitespace Test"


def test_create_patient_rejects_empty_name(auth_client):
    resp = auth_client.post("/api/patients", json={"name": ""})
    assert resp.status_code == 422

    resp = auth_client.post("/api/patients", json={"name": "   "})
    assert resp.status_code == 422


def test_create_patient_requires_auth(client):
    resp = client.post("/api/patients", json={"name": "Anyone"})
    assert resp.status_code == 401


def test_initials_computation_handles_single_name(auth_client):
    resp = auth_client.post("/api/patients", json={"name": "Madonna"})
    assert resp.status_code == 201
    assert resp.json()["initials"] == "M"


def test_initials_caps_at_two_characters(auth_client):
    resp = auth_client.post("/api/patients", json={"name": "Jean Claude Van Damme"})
    assert resp.status_code == 201
    assert resp.json()["initials"] == "JC"
