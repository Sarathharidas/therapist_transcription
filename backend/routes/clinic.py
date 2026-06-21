"""
Clinic routes — membership + invites for the enterprise/clinic model.

  GET    /api/clinic                 — clinic info: name, members, pending invites
  GET    /api/clinic/members         — list members
  POST   /api/clinic/invites         — (admin) invite an email { email, role }
  DELETE /api/clinic/invites/{id}    — (admin) revoke a pending invite
  PATCH  /api/clinic/members/{id}    — (admin) change a member's role
  DELETE /api/clinic/members/{id}    — (admin) remove a member from the clinic

All routes are scoped to the caller's own clinic. Solo (clinic-less) clinicians
get 404 — there is no clinic to manage.
"""

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.db import Clinic, ClinicInvite, Clinician
from backend.db.session import get_db
from backend.services.auth import get_current_clinician, require_admin

router = APIRouter(prefix="/api/clinic", tags=["clinic"])

VALID_ROLES = ("admin", "therapist")


# ── Pydantic shapes ────────────────────────────────────────────────────────

class MemberOut(BaseModel):
    id: str
    name: str
    email: str
    role: str


class InviteOut(BaseModel):
    invite_id: str
    email: str
    role: str
    status: str
    created_at: str


class ClinicOut(BaseModel):
    clinic_id: str
    name: str
    members: List[MemberOut]
    pending_invites: List[InviteOut]


class InviteCreate(BaseModel):
    email: str
    role: str = "therapist"


class RoleUpdate(BaseModel):
    role: str


# ── Helpers ────────────────────────────────────────────────────────────────

def _require_clinic(clinician: Clinician) -> uuid.UUID:
    if clinician.clinic_id is None:
        raise HTTPException(status_code=404, detail="You are not part of a clinic")
    return clinician.clinic_id


def _member_out(c: Clinician) -> MemberOut:
    return MemberOut(id=str(c.clinician_id), name=c.name, email=c.email, role=c.role or "therapist")


def _members(db: Session, clinic_id: uuid.UUID) -> List[Clinician]:
    return (
        db.query(Clinician)
        .filter(Clinician.clinic_id == clinic_id)
        .order_by(Clinician.name.asc())
        .all()
    )


def _admin_count(db: Session, clinic_id: uuid.UUID) -> int:
    return (
        db.query(Clinician)
        .filter(Clinician.clinic_id == clinic_id, Clinician.role == "admin")
        .count()
    )


# ── Routes ─────────────────────────────────────────────────────────────────

@router.get("", response_model=ClinicOut)
def get_clinic(
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Clinic name, members, and pending invites (any member may view)."""
    clinic_id = _require_clinic(clinician)
    clinic = db.query(Clinic).filter(Clinic.clinic_id == clinic_id).first()
    if clinic is None:
        raise HTTPException(status_code=404, detail="Clinic not found")

    invites = (
        db.query(ClinicInvite)
        .filter(ClinicInvite.clinic_id == clinic_id, ClinicInvite.status == "pending")
        .order_by(ClinicInvite.created_at.desc())
        .all()
    )
    return ClinicOut(
        clinic_id=str(clinic.clinic_id),
        name=clinic.name,
        members=[_member_out(m) for m in _members(db, clinic_id)],
        pending_invites=[
            InviteOut(
                invite_id=str(i.invite_id),
                email=i.email,
                role=i.role,
                status=i.status,
                created_at=str(i.created_at),
            )
            for i in invites
        ],
    )


@router.get("/members", response_model=List[MemberOut])
def list_members(
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    clinic_id = _require_clinic(clinician)
    return [_member_out(m) for m in _members(db, clinic_id)]


@router.post("/invites", response_model=InviteOut, status_code=201)
def create_invite(
    body: InviteCreate,
    db: Session = Depends(get_db),
    admin: Clinician = Depends(require_admin),
):
    """Invite an email to the admin's clinic (admin only)."""
    clinic_id = admin.clinic_id
    email = body.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="A valid email is required")
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role: {body.role}")

    # Already a member of this clinic?
    existing_member = (
        db.query(Clinician)
        .filter(Clinician.clinic_id == clinic_id, Clinician.email == email)
        .first()
    )
    if existing_member is not None:
        raise HTTPException(status_code=409, detail="That person is already a member")

    # Already a pending invite for this clinic?
    existing_invite = (
        db.query(ClinicInvite)
        .filter(
            ClinicInvite.clinic_id == clinic_id,
            ClinicInvite.email == email,
            ClinicInvite.status == "pending",
        )
        .first()
    )
    if existing_invite is not None:
        raise HTTPException(status_code=409, detail="That email is already invited")

    invite = ClinicInvite(
        clinic_id=clinic_id,
        email=email,
        role=body.role,
        status="pending",
        invited_by=admin.clinician_id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    print(f"[clinic] {admin.email} invited {email} as {body.role}")
    return InviteOut(
        invite_id=str(invite.invite_id),
        email=invite.email,
        role=invite.role,
        status=invite.status,
        created_at=str(invite.created_at),
    )


@router.delete("/invites/{invite_id}", status_code=200)
def revoke_invite(
    invite_id: str,
    db: Session = Depends(get_db),
    admin: Clinician = Depends(require_admin),
):
    invite = (
        db.query(ClinicInvite)
        .filter(
            ClinicInvite.invite_id == uuid.UUID(invite_id),
            ClinicInvite.clinic_id == admin.clinic_id,
        )
        .first()
    )
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite.status = "revoked"
    db.commit()
    return {"ok": True}


@router.patch("/members/{member_id}", response_model=MemberOut)
def update_member_role(
    member_id: str,
    body: RoleUpdate,
    db: Session = Depends(get_db),
    admin: Clinician = Depends(require_admin),
):
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail=f"Invalid role: {body.role}")
    member = (
        db.query(Clinician)
        .filter(
            Clinician.clinician_id == uuid.UUID(member_id),
            Clinician.clinic_id == admin.clinic_id,
        )
        .first()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")

    # Don't allow demoting the last admin (would leave the clinic unmanageable)
    if member.role == "admin" and body.role != "admin" and _admin_count(db, admin.clinic_id) <= 1:
        raise HTTPException(status_code=409, detail="Can't demote the only admin")

    member.role = body.role
    db.commit()
    db.refresh(member)
    return _member_out(member)


@router.delete("/members/{member_id}", status_code=200)
def remove_member(
    member_id: str,
    db: Session = Depends(get_db),
    admin: Clinician = Depends(require_admin),
):
    """Remove a member from the clinic — they revert to a solo account; data is kept."""
    if str(admin.clinician_id) == member_id:
        raise HTTPException(status_code=409, detail="You can't remove yourself")
    member = (
        db.query(Clinician)
        .filter(
            Clinician.clinician_id == uuid.UUID(member_id),
            Clinician.clinic_id == admin.clinic_id,
        )
        .first()
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if member.role == "admin" and _admin_count(db, admin.clinic_id) <= 1:
        raise HTTPException(status_code=409, detail="Can't remove the only admin")

    member.clinic_id = None
    member.role = "therapist"
    db.commit()
    print(f"[clinic] {admin.email} removed {member.email} from the clinic")
    return {"ok": True}
