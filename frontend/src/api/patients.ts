import type { Patient } from '../types';
import { fetchWithAuth } from './base';

type PatientOut = {
  patient_id: string;
  name: string;
  initials: string;
  created_at: string;
};

function toPatient(p: PatientOut): Patient {
  return {
    id: p.patient_id,
    name: p.name,
    initials: p.initials,
    lastSeen: p.created_at
      ? new Date(p.created_at).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }).toUpperCase()
      : undefined,
  };
}

export async function listPatients(): Promise<Patient[]> {
  const resp = await fetchWithAuth('/api/patients');
  if (!resp.ok) throw new Error(`Failed to load patients: ${resp.status}`);
  const data = (await resp.json()) as PatientOut[];
  return data.map(toPatient);
}

export type PatientHistory = {
  overview: string | null;
  sessions: { summaryId: string; date: string; snippet: string }[];
};

export async function getPatientHistory(patientId: string): Promise<PatientHistory> {
  const resp = await fetchWithAuth(`/api/patients/${patientId}/history`);
  if (!resp.ok) throw new Error(`Failed to load history: ${resp.status}`);
  const d = (await resp.json()) as {
    overview: string | null;
    sessions: { summary_id: string; date: string; snippet: string }[];
  };
  return {
    overview: d.overview,
    sessions: (d.sessions ?? []).map((s) => ({
      summaryId: s.summary_id, date: s.date, snippet: s.snippet,
    })),
  };
}

export async function createPatient(name: string): Promise<Patient> {
  const resp = await fetchWithAuth('/api/patients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) throw new Error(`Failed to create patient: ${resp.status}`);
  const p = (await resp.json()) as PatientOut;
  return toPatient(p);
}
