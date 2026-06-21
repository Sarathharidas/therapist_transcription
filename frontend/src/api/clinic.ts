import type { Clinic, ClinicInvite, ClinicMember, ClinicianRole } from '../types';
import { fetchWithAuth } from './base';

type MemberOut = { id: string; name: string; email: string; role: ClinicianRole };
type InviteOut = { invite_id: string; email: string; role: ClinicianRole; status: string; created_at: string };
type ClinicResp = {
  clinic_id: string;
  name: string;
  members: MemberOut[];
  pending_invites: InviteOut[];
};

const toMember = (m: MemberOut): ClinicMember => ({ id: m.id, name: m.name, email: m.email, role: m.role });
const toInvite = (i: InviteOut): ClinicInvite => ({
  inviteId: i.invite_id,
  email: i.email,
  role: i.role,
  status: i.status,
  createdAt: i.created_at,
});

async function detail(resp: Response): Promise<string> {
  const err = await resp.json().catch(() => ({ detail: resp.statusText }));
  return (err as { detail?: string }).detail ?? `Error ${resp.status}`;
}

export async function getClinic(): Promise<Clinic> {
  const resp = await fetchWithAuth('/api/clinic');
  if (!resp.ok) throw new Error(await detail(resp));
  const data = (await resp.json()) as ClinicResp;
  return {
    clinicId: data.clinic_id,
    name: data.name,
    members: data.members.map(toMember),
    pendingInvites: data.pending_invites.map(toInvite),
  };
}

export async function createInvite(email: string, role: ClinicianRole): Promise<void> {
  const resp = await fetchWithAuth('/api/clinic/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  if (!resp.ok) throw new Error(await detail(resp));
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const resp = await fetchWithAuth(`/api/clinic/invites/${inviteId}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(await detail(resp));
}

export async function updateMemberRole(memberId: string, role: ClinicianRole): Promise<void> {
  const resp = await fetchWithAuth(`/api/clinic/members/${memberId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!resp.ok) throw new Error(await detail(resp));
}

export async function removeMember(memberId: string): Promise<void> {
  const resp = await fetchWithAuth(`/api/clinic/members/${memberId}`, { method: 'DELETE' });
  if (!resp.ok) throw new Error(await detail(resp));
}
