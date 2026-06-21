import type { Group } from '../types';
import { fetchWithAuth } from './base';

type GroupOut = {
  group_id: string;
  label: string;
  created_at: string;
  members: Array<{ patient_id: string; name: string; initials: string }>;
};

function toGroup(g: GroupOut): Group {
  return {
    id: g.group_id,
    label: g.label,
    members: g.members.map((m) => ({
      id: m.patient_id,
      name: m.name,
      initials: m.initials,
    })),
  };
}

export async function listGroups(): Promise<Group[]> {
  const resp = await fetchWithAuth('/api/groups');
  if (!resp.ok) throw new Error(`Failed to load groups: ${resp.status}`);
  const data = (await resp.json()) as GroupOut[];
  return data.map(toGroup);
}

export async function createGroup(label: string, patientIds: string[]): Promise<Group> {
  const resp = await fetchWithAuth('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, patient_ids: patientIds }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `Error ${resp.status}`);
  }
  return toGroup((await resp.json()) as GroupOut);
}
