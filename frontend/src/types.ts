export type ClinicianRole = 'admin' | 'therapist';

export type Clinician = {
  id: string;
  name: string;
  email: string;
  role: ClinicianRole;
  clinicId?: string;
  clinicName?: string;
};

// ── Clinic (enterprise) ────────────────────────────────────────────────────

export type ClinicMember = {
  id: string;
  name: string;
  email: string;
  role: ClinicianRole;
};

export type ClinicInvite = {
  inviteId: string;
  email: string;
  role: ClinicianRole;
  status: string;
  createdAt: string;
};

export type Clinic = {
  clinicId: string;
  name: string;
  members: ClinicMember[];
  pendingInvites: ClinicInvite[];
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
  // Appointment grouping — set for couple/family visits, undefined for solo
  sessionId?: string;
  sessionLabel?: string;
  segmentType?: SegmentType;
};

// ── Group / couple therapy ────────────────────────────────────────────────

export type SegmentType = 'joint' | 'individual' | 'solo';

export type GroupMember = {
  id: string;       // patient_id
  name: string;
  initials: string;
};

export type Group = {
  id: string;       // group_id
  label: string;
  members: GroupMember[];
};

// An in-progress appointment (returned when a visit is started)
export type Appointment = {
  sessionId: string;
  label: string;
  participants: GroupMember[];
};

export type Segment = {
  summaryId: string;
  segmentType: SegmentType;
  participants: GroupMember[];
  transcript: string;
  summary: string;
  clinicianNotes: string | null;
  date: string;
};

export type AppointmentDetail = {
  sessionId: string;
  label: string;
  date: string;
  participants: GroupMember[];
  segments: Segment[];
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

export type AppView = 'select' | 'session' | 'past-session' | 'group-session' | 'appointment' | 'team';
export type SessionPhase = 'ready' | 'recording' | 'submitting';
