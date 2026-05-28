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

export type AppView = 'select' | 'session';
export type SessionPhase = 'ready' | 'recording' | 'processing' | 'done';

export type ProcessingStage = {
  id: number;
  label: string;
  state: 'pending' | 'active' | 'done';
};
