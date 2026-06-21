import type {
  Appointment,
  AppointmentDetail,
  JobStatus,
  PastSession,
  SegmentType,
  SessionDetail,
} from '../types';
import { fetchWithAuth } from './base';

// Extra metadata for a group/couple segment. Omit entirely for a solo session.
export type SegmentMeta = {
  sessionId: string;
  segmentType: SegmentType;
  participantIds: string[];
};

/**
 * Submit audio for async processing.
 * Returns the job_id immediately (backend responds 202).
 * The caller should then poll pollJobStatus() to track progress.
 *
 * For a group/couple segment, pass `meta` so the result is tagged to the
 * appointment and the confidentiality access list is recorded.
 */
export async function submitSession(
  audio: Blob,
  patientId: string,
  meta?: SegmentMeta,
): Promise<string> {
  const form = new FormData();
  form.append('audio', audio, 'session.webm');
  form.append('patient_id', patientId);
  if (meta) {
    form.append('session_id', meta.sessionId);
    form.append('segment_type', meta.segmentType);
    form.append('participant_ids', meta.participantIds.join(','));
  }

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
 * Start an appointment (one visit) from a saved group or an ad-hoc list of
 * patient ids. Returns the session_id used to tag the segment recordings.
 */
export async function createAppointment(
  args: { groupId?: string; participantIds?: string[]; label?: string },
): Promise<Appointment> {
  const resp = await fetchWithAuth('/api/sessions/appointment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      group_id: args.groupId,
      participant_ids: args.participantIds,
      label: args.label,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `Error ${resp.status}`);
  }
  const data = await resp.json() as {
    session_id: string;
    label: string;
    participants: Array<{ patient_id: string; name: string; initials: string }>;
  };
  return {
    sessionId: data.session_id,
    label: data.label,
    participants: data.participants.map((p) => ({
      id: p.patient_id,
      name: p.name,
      initials: p.initials,
    })),
  };
}

export async function getAppointment(sessionId: string): Promise<AppointmentDetail> {
  const resp = await fetchWithAuth(`/api/sessions/appointment/${sessionId}`);
  if (!resp.ok) throw new Error(`Failed to load appointment: ${resp.status}`);
  const data = await resp.json() as {
    session_id: string;
    label: string;
    date: string;
    participants: Array<{ patient_id: string; name: string; initials: string }>;
    segments: Array<{
      summary_id: string;
      segment_type: SegmentType;
      participants: Array<{ patient_id: string; name: string; initials: string }>;
      transcript: string;
      summary: string;
      clinician_notes: string | null;
      date: string;
    }>;
  };
  const member = (p: { patient_id: string; name: string; initials: string }) => ({
    id: p.patient_id,
    name: p.name,
    initials: p.initials,
  });
  return {
    sessionId: data.session_id,
    label: data.label,
    date: data.date,
    participants: data.participants.map(member),
    segments: data.segments.map((s) => ({
      summaryId: s.summary_id,
      segmentType: s.segment_type,
      participants: s.participants.map(member),
      transcript: s.transcript,
      summary: s.summary,
      clinicianNotes: s.clinician_notes,
      date: s.date,
    })),
  };
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
    session_id: string | null;
    session_label: string | null;
    segment_type: SegmentType | null;
  }>;
  return data.map((s) => ({
    id: s.summary_id,
    patientName: s.patient_name,
    date: s.date,
    noteSnippet: s.note_snippet,
    sessionId: s.session_id ?? undefined,
    sessionLabel: s.session_label ?? undefined,
    segmentType: s.segment_type ?? undefined,
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
