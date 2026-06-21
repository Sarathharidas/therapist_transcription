"""
Group routes — persistent couples / families seen together.

  GET  /api/groups   — list all groups for the authenticated clinician
  POST /api/groups   — create a group { label, patient_ids[] }
"""

import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.db import Clinician, Group, GroupMember, Patient
from backend.db.session import get_db
from backend.services.auth import get_current_clinician

router = APIRouter(prefix="/api/groups", tags=["groups"])


# ── Pydantic shapes ────────────────────────────────────────────────────────

class GroupCreate(BaseModel):
    label: str
    patient_ids: List[str]


class MemberOut(BaseModel):
    patient_id: str
    name: str
    initials: str


class GroupOut(BaseModel):
    group_id: str
    label: str
    created_at: str
    members: List[MemberOut]


# ── Helpers ────────────────────────────────────────────────────────────────

def _initials(name: str) -> str:
    return "".join(w[0] for w in name.split() if w)[:2].upper()


def _member_out(p: Patient) -> MemberOut:
    return MemberOut(patient_id=str(p.patient_id), name=p.name, initials=_initials(p.name))


def _group_out(db: Session, group: Group) -> GroupOut:
    members = (
        db.query(Patient)
        .join(GroupMember, GroupMember.patient_id == Patient.patient_id)
        .filter(GroupMember.group_id == group.group_id)
        .all()
    )
    return GroupOut(
        group_id=str(group.group_id),
        label=group.label,
        created_at=str(group.created_at),
        members=[_member_out(p) for p in members],
    )


# ── Endpoints ──────────────────────────────────────────────────────────────

@router.get("", response_model=List[GroupOut])
def list_groups(
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Return all groups belonging to the authenticated clinician, newest first."""
    groups = (
        db.query(Group)
        .filter(Group.clinician_id == clinician.clinician_id)
        .order_by(Group.created_at.desc())
        .all()
    )
    return [_group_out(db, g) for g in groups]


@router.post("", response_model=GroupOut, status_code=201)
def create_group(
    body: GroupCreate,
    db: Session = Depends(get_db),
    clinician: Clinician = Depends(get_current_clinician),
):
    """Create a group from existing patients (couples need 2+ members)."""
    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail="Group name cannot be empty")
    if len(body.patient_ids) < 2:
        raise HTTPException(status_code=422, detail="A group needs at least two patients")

    # Verify every patient exists and belongs to this clinician
    member_ids: List[uuid.UUID] = []
    for pid in body.patient_ids:
        try:
            puid = uuid.UUID(pid)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid patient id: {pid}")
        owned = (
            db.query(Patient)
            .filter(
                Patient.patient_id == puid,
                Patient.clinician_id == clinician.clinician_id,
            )
            .first()
        )
        if not owned:
            raise HTTPException(status_code=404, detail=f"Patient not found: {pid}")
        member_ids.append(puid)

    group = Group(clinician_id=clinician.clinician_id, label=label)
    db.add(group)
    db.flush()  # populate group_id

    for puid in member_ids:
        db.add(GroupMember(group_id=group.group_id, patient_id=puid))

    db.commit()
    db.refresh(group)
    print(f"[groups] Created group '{label}' with {len(member_ids)} members")
    return _group_out(db, group)
