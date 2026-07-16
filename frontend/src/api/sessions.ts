import type {
  Appointment,
  AppointmentDetail,
  JobStatus,
  PastSession,
  SegmentType,
  SessionDetail,
} from '../types';
import { fetchWithAuth, withNetworkRetry } from './base';

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
// Long uploads over slow/flaky uplinks occasionally fail at the transport layer
// (the browser rejects fetch with "Load failed"/"Failed to fetch", or the request
// hangs). We retry ONLY those — never an HTTP error response (413/429/404 are
// deterministic). A generous timeout backstops a truly hung request.
const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10 min — backstop, not an SLA
const UPLOAD_MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function submitSession(
  audio: Blob,
  patientId: string,
  meta?: SegmentMeta,
  durationSeconds?: number,
): Promise<string> {
  const buildForm = () => {
    const form = new FormData();
    form.append('audio', audio, 'session.webm');
    form.append('patient_id', patientId);
    if (durationSeconds != null) form.append('duration_seconds', String(Math.round(durationSeconds)));
    if (meta) {
      form.append('session_id', meta.sessionId);
      form.append('segment_type', meta.segmentType);
      form.append('participant_ids', meta.participantIds.join(','));
    }
    return form;
  };

  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

    let resp: Response;
    try {
      // A fresh FormData per attempt — the Blob is re-readable, the FormData is not.
      resp = await fetchWithAuth('/api/sessions/process', {
        method: 'POST',
        body: buildForm(),
        signal: controller.signal,
      });
    } catch (err) {
      // Transport-level failure (network drop, "Load failed", or our abort timeout).
      if (attempt < UPLOAD_MAX_ATTEMPTS) {
        console.warn(`[session] Upload attempt ${attempt} failed (${err}); retrying…`);
        await sleep(1000 * attempt); // linear backoff: 1s, 2s
        continue;
      }
      throw new Error('upload_failed');
    } finally {
      clearTimeout(timeout);
    }

    // Got an HTTP response — these are deterministic, do NOT retry.
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      if (resp.status === 429) throw new Error('quota_exceeded');
      throw new Error((err as { detail?: string }).detail ?? `Error ${resp.status}`);
    }

    const data = (await resp.json()) as { job_id: string };
    return data.job_id;
  }

  // Unreachable — the loop either returns or throws.
  throw new Error('upload_failed');
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

// Save a therapist-edited AI summary (whole reassembled markdown; encrypted at rest).
export async function saveSummary(summaryId: string, summary: string): Promise<void> {
  const resp = await fetchWithAuth(`/api/sessions/${summaryId}/summary`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `Error ${resp.status}`);
  }
}

// Transcribe a short clinician voice note → returns the (English) text.
// Audio is not stored server-side; the text is saved via saveNotes().
export async function transcribeNote(audio: Blob): Promise<string> {
  const resp = await withNetworkRetry(() => {
    const form = new FormData();
    form.append('audio', audio, 'note.webm');
    return fetchWithAuth('/api/sessions/transcribe-note', { method: 'POST', body: form });
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `Transcription failed: ${resp.status}`);
  }
  const data = (await resp.json()) as { text: string };
  return data.text;
}

// Keep old name as alias so any other imports don't break
export const processSession = submitSession;
