import type { Clinician, ClinicianRole } from '../types';
import { API_BASE, fetchWithAuth, token } from './base';

type ClinicianOut = {
  id: string;
  name: string;
  email: string;
  role?: ClinicianRole;
  clinic_id?: string | null;
  clinic_name?: string | null;
};

type LoginResponseOut = {
  access_token: string;
  token_type: string;
  clinician: ClinicianOut;
};

export type LoginMode = 'individual' | 'clinic';

function toClinician(c: ClinicianOut): Clinician {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    role: c.role ?? 'therapist',
    clinicId: c.clinic_id ?? undefined,
    clinicName: c.clinic_name ?? undefined,
  };
}

type LoginResult = { accessToken: string; clinician: Clinician };

// Exchange Google credential for app JWT + clinician info
export async function googleLogin(credential: string, mode: LoginMode = 'individual'): Promise<LoginResult> {
  const resp = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential, mode }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `Login failed: ${resp.status}`);
  }
  const data = (await resp.json()) as LoginResponseOut;
  return { accessToken: data.access_token, clinician: toClinician(data.clinician) };
}

// Verify existing token and return clinician (used on page load)
export async function getMe(): Promise<Clinician> {
  const resp = await fetchWithAuth('/api/auth/me');
  if (!resp.ok) throw new Error('Not authenticated');
  return toClinician((await resp.json()) as ClinicianOut);
}

// Public — whether the clinic sign-in path should be shown on the login screen
export async function getAuthConfig(): Promise<{ clinicEnabled: boolean }> {
  try {
    const resp = await fetch(`${API_BASE}/api/auth/config`);
    if (!resp.ok) return { clinicEnabled: false };
    const data = (await resp.json()) as { clinic_enabled: boolean };
    return { clinicEnabled: data.clinic_enabled };
  } catch {
    return { clinicEnabled: false };
  }
}

// Clear local token (backend JWTs are stateless — no server-side invalidation needed)
export function logout(): void {
  token.clear();
}
