import type { Clinician } from '../types';
import { API_BASE, fetchWithAuth, token } from './base';

type LoginResponse = {
  access_token: string;
  token_type: string;
  clinician: Clinician;
};

// Exchange Google credential for app JWT + clinician info
export async function googleLogin(credential: string): Promise<LoginResponse> {
  const resp = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error((err as { detail?: string }).detail ?? `Login failed: ${resp.status}`);
  }
  return resp.json() as Promise<LoginResponse>;
}

// Verify existing token and return clinician (used on page load)
export async function getMe(): Promise<Clinician> {
  const resp = await fetchWithAuth('/api/auth/me');
  if (!resp.ok) throw new Error('Not authenticated');
  return resp.json() as Promise<Clinician>;
}

// Clear local token (backend JWTs are stateless — no server-side invalidation needed)
export function logout(): void {
  token.clear();
}
