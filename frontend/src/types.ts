export type Clinician = {
  id: string;
  name: string;
  email: string;
};

export type Patient = {
  id: string;        // DB UUID
  name: string;
  initials: string;
  lastSeen?: string;
};

export type PastSession = {
  id: string;
  patientName: string;
  date: string;
  noteSnippet: string;
};

export type SessionResult = {
  transcript: string;
  summary: string;
  patient_id: string;
  summary_id: string;
};

export type SessionDetail = {
  summary_id: string;
  patient_id: string;
  patient_name: string;
  transcript: string;
  summary: string;
  clinician_notes: string | null;
  date: string;
};

export type JobStatus = {
  job_id: string;
  status: 'pending' | 'uploading' | 'transcribing' | 'summarizing' | 'complete' | 'failed';
  summary_id: string | null;
  error: string | null;
};

export type AppView = 'select' | 'session' | 'past-session';
export type SessionPhase = 'ready' | 'recording' | 'submitting';
