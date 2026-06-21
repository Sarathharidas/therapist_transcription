"""Tests for the clinic (enterprise) model: dual-path login + membership."""

import uuid
from unittest.mock import patch

from backend.db import Clinic, ClinicInvite, Clinician


def _claims(sub, email, name="Dr. X"):
    return {"sub": sub, "email": email, "name": name}


def _invite(db, clinic, email, role="therapist", status="pending"):
    inv = ClinicInvite(
        invite_id=uuid.uuid4(),
        clinic_id=clinic.clinic_id,
        email=email.lower(),
        role=role,
        status=status,
        created_at="2026-01-01T00:00:00",
    )
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


# ── GET /api/auth/config ──────────────────────────────────────────────────

def test_auth_config_false_without_clinic(client):
    assert client.get("/api/auth/config").json() == {"clinic_enabled": False}


def test_auth_config_true_with_clinic(client, clinic):
    assert client.get("/api/auth/config").json() == {"clinic_enabled": True}


# ── Dual-path login ───────────────────────────────────────────────────────

def test_clinic_login_rejected_without_invite(client, clinic):
    claims = _claims("g-uninvited", "stranger@brightminds.com")
    with patch("backend.routes.auth.verify_google_token", return_value=claims):
        resp = client.post("/api/auth/login", json={"credential": "x", "mode": "clinic"})
    assert resp.status_code == 403


def test_individual_login_still_open(client, db):
    """Default mode auto-registers a solo account (today's behaviour)."""
    claims = _claims("g-solo", "solo@gmail.com", "Dr. Solo")
    with patch("backend.routes.auth.verify_google_token", return_value=claims):
        resp = client.post("/api/auth/login", json={"credential": "x"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["clinician"]["clinic_id"] is None
    assert body["clinician"]["role"] == "therapist"


def test_invited_email_admitted_to_clinic(client, db, clinic):
    _invite(db, clinic, "newdoc@brightminds.com", role="therapist")
    claims = _claims("g-newdoc", "NewDoc@brightminds.com", "Dr. New")
    with patch("backend.routes.auth.verify_google_token", return_value=claims):
        resp = client.post("/api/auth/login", json={"credential": "x", "mode": "clinic"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["clinician"]["clinic_id"] == str(clinic.clinic_id)
    assert body["clinician"]["clinic_name"] == "Bright Minds"
    assert body["clinician"]["role"] == "therapist"

    # Invite is now consumed
    inv = db.query(ClinicInvite).filter(ClinicInvite.email == "newdoc@brightminds.com").first()
    assert inv.status == "accepted"


def test_revoked_invite_blocks_clinic_login(client, db, clinic):
    _invite(db, clinic, "revoked@brightminds.com", status="revoked")
    claims = _claims("g-revoked", "revoked@brightminds.com")
    with patch("backend.routes.auth.verify_google_token", return_value=claims):
        resp = client.post("/api/auth/login", json={"credential": "x", "mode": "clinic"})
    assert resp.status_code == 403


# ── Invite management (admin-only) ────────────────────────────────────────

def test_admin_can_create_invite(admin_client, db, clinic):
    resp = admin_client.post("/api/clinic/invites", json={"email": "Teammate@brightminds.com", "role": "therapist"})
    assert resp.status_code == 201
    assert resp.json()["email"] == "teammate@brightminds.com"  # lowercased
    assert db.query(ClinicInvite).filter(ClinicInvite.email == "teammate@brightminds.com").count() == 1


def test_solo_therapist_cannot_create_invite(auth_client):
    """A clinic-less clinician is not an admin → 403."""
    resp = auth_client.post("/api/clinic/invites", json={"email": "x@y.com"})
    assert resp.status_code == 403


def test_clinic_therapist_cannot_create_invite(client, db, clinic):
    """A non-admin clinic member is forbidden from inviting."""
    from backend.services.auth import create_jwt
    from fastapi.testclient import TestClient
    from backend.main import app

    therapist = Clinician(
        clinician_id=uuid.uuid4(), email="t@brightminds.com", name="Dr. T",
        google_id="g-t", clinic_id=clinic.clinic_id, role="therapist",
    )
    db.add(therapist)
    db.commit()
    c = TestClient(app)
    c.headers.update({"Authorization": f"Bearer {create_jwt(str(therapist.clinician_id))}"})
    assert c.post("/api/clinic/invites", json={"email": "x@y.com"}).status_code == 403


def test_duplicate_invite_rejected(admin_client, db, clinic):
    admin_client.post("/api/clinic/invites", json={"email": "dup@brightminds.com"})
    resp = admin_client.post("/api/clinic/invites", json={"email": "dup@brightminds.com"})
    assert resp.status_code == 409


# ── Members ───────────────────────────────────────────────────────────────

def test_members_scoped_to_clinic(admin_client, db, clinic, other_clinician):
    """Only this clinic's members are listed (other clinicians excluded)."""
    member = Clinician(
        clinician_id=uuid.uuid4(), email="m@brightminds.com", name="Dr. M",
        google_id="g-m", clinic_id=clinic.clinic_id, role="therapist",
    )
    db.add(member)
    db.commit()

    rows = admin_client.get("/api/clinic/members").json()
    emails = {m["email"] for m in rows}
    assert "admin@brightminds.com" in emails
    assert "m@brightminds.com" in emails
    assert other_clinician.email not in emails  # different clinic / solo


def test_cannot_demote_last_admin(admin_client, clinic_admin):
    resp = admin_client.patch(f"/api/clinic/members/{clinic_admin.clinician_id}", json={"role": "therapist"})
    assert resp.status_code == 409


def test_cannot_remove_self(admin_client, clinic_admin):
    resp = admin_client.delete(f"/api/clinic/members/{clinic_admin.clinician_id}")
    assert resp.status_code == 409


def test_remove_member_detaches_clinic(admin_client, db, clinic):
    member = Clinician(
        clinician_id=uuid.uuid4(), email="leaving@brightminds.com", name="Dr. Leaving",
        google_id="g-leave", clinic_id=clinic.clinic_id, role="therapist",
    )
    db.add(member)
    db.commit()

    resp = admin_client.delete(f"/api/clinic/members/{member.clinician_id}")
    assert resp.status_code == 200
    db.refresh(member)
    assert member.clinic_id is None
    assert member.role == "therapist"


def test_admin_cannot_touch_other_clinics_member(admin_client, db):
    """Acting on a member outside the admin's clinic → 404."""
    other_clinic = Clinic(clinic_id=uuid.uuid4(), name="Other", created_at="2026-01-01T00:00:00")
    db.add(other_clinic)
    db.commit()
    outsider = Clinician(
        clinician_id=uuid.uuid4(), email="out@other.com", name="Dr. Out",
        google_id="g-out", clinic_id=other_clinic.clinic_id, role="therapist",
    )
    db.add(outsider)
    db.commit()

    assert admin_client.delete(f"/api/clinic/members/{outsider.clinician_id}").status_code == 404
    assert admin_client.patch(
        f"/api/clinic/members/{outsider.clinician_id}", json={"role": "admin"}
    ).status_code == 404
