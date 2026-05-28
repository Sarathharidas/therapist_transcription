import type { SessionResult } from '../types';
import { fetchWithAuth } from './base';

export async function processSession(
  audio: Blob,
  patientId: string,
): Promise<SessionResult> {
  const form = new FormData();
  form.append('audio', audio, 'session.webm');
  form.append('patient_id', patientId);

  const resp = await fetchWithAuth('/api/sessions/process', {
    method: 'POST',
    body: form,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    if (resp.status === 429) throw new Error('quota_exceeded');
    throw new Error((err as { detail?: string }).detail ?? `Error ${resp.status}`);
  }

  return resp.json() as Promise<SessionResult>;
}
