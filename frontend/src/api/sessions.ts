import type { JobStatus, PastSession, SessionDetail } from '../types';
import { fetchWithAuth } from './base';

/**
 * Submit audio for async processing.
 * Returns the job_id immediately (backend responds 202).
 * The caller should then poll pollJobStatus() to track progress.
 */
export async function submitSession(
  audio: Blob,
  patientId: string,
): Promise<string> {
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

  const data = await resp.json() as { job_id: string };
  return data.job_id;
}

/**
 * Poll the status of a background processing job.
 * Call every ~4 seconds until status is 'complete' or 'failed'.
 */
export async function pollJobStatus(jobId: string): Promise<JobStatus> {
  const resp = await fetchWithAuth(`/api/sessions/job/${jobId}`);
  if (!resp.ok) throw new Error(`Job status check failed: ${resp.status}`);
  return resp.json() as Promise<JobStatus>;
}

export async function getSession(summaryId: string): Promise<SessionDetail> {
  const resp = await fetchWithAuth(`/api/sessions/${summaryId}`);
  if (!resp.ok) throw new Error(`Failed to load session: ${resp.status}`);
  return resp.json() as Promise<SessionDetail>;
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

// Keep old name as alias so any other imports don't break
export const processSession = submitSession;
