import type { PastSession, SessionResult } from '../types';
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

export async function listRecentSessions(): Promise<PastSession[]> {
  const resp = await fetchWithAuth('/api/sessions/recent');
  if (!resp.ok) return [];
  const data = await resp.json() as Array<{
    summary_id: string;
    patient_name: string;
    date: string;
    note_snippet: string;
  }>;
  return data.map((s) => ({
    id: s.summary_id,
    patientName: s.patient_name,
    date: s.date,
    noteSnippet: s.note_snippet,
  }));
}

export async function saveNotes(summaryId: string, notes: string): Promise<void> {
  const resp = await fetchWithAuth(`/api/sessions/${summaryId}/notes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `Error ${resp.status}`);
  }
}
