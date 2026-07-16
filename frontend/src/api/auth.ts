import type { Clinician, ClinicianRole } from '../types';
import {
  API_BASE,
  authAttempt,
  authReference,
  fetchWithAuth,
  reportAuthClientEvent,
  token,
  withNetworkRetry,
} from './base';

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

function withReference(message: string, attemptId: string): string {
  return `${message} Reference: ${authReference(attemptId)}`;
}

// Exchange Google credential for app JWT + clinician info.
// For mode='clinic', clinicName is required and must match a registered clinic.
export async function googleLogin(
  credential: string,
  mode: LoginMode = 'individual',
  clinicName?: string,
  attemptId = authAttempt.ensure(),
): Promise<LoginResult> {
  // Retry only transport-level failures (cold start / blip) — not HTTP errors.
  let resp: Response;
  try {
    resp = await withNetworkRetry(() =>
      fetch(`${API_BASE}/api/auth/login?auth_attempt_id=${encodeURIComponent(attemptId)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Attempt-ID': attemptId,
        },
        body: JSON.stringify({ credential, mode, clinic_name: clinicName }),
      }),
    );
  } catch {
    reportAuthClientEvent('railway_network_failure', attemptId, { mode });
    throw new Error(withReference('Could not reach the login service. Please try again.', attemptId));
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    reportAuthClientEvent('login_http_failure', attemptId, { mode, status: resp.status });
    const message = (err as { detail?: string }).detail ?? `Login failed: ${resp.status}`;
    throw new Error(withReference(message, attemptId));
  }
  try {
    const data = (await resp.json()) as LoginResponseOut;
    return { accessToken: data.access_token, clinician: toClinician(data.clinician) };
  } catch {
    reportAuthClientEvent('login_response_invalid', attemptId, { mode, status: resp.status });
    throw new Error(withReference('The login service returned an invalid response.', attemptId));
  }
}

// Self-serve clinic registration — the Google user becomes the clinic admin.
export async function registerClinic(
  credential: string,
  clinicName: string,
  therapistEmails: string[],
  attemptId = authAttempt.ensure(),
): Promise<LoginResult> {
  let resp: Response;
  try {
    resp = await withNetworkRetry(() =>
      fetch(
        `${API_BASE}/api/auth/register-clinic?auth_attempt_id=${encodeURIComponent(attemptId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auth-Attempt-ID': attemptId,
          },
          body: JSON.stringify({
            credential,
            clinic_name: clinicName,
            therapist_emails: therapistEmails,
          }),
        },
      ),
    );
  } catch {
    reportAuthClientEvent('railway_network_failure', attemptId, { mode: 'clinic' });
    throw new Error(withReference('Could not reach the registration service. Please try again.', attemptId));
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    reportAuthClientEvent('login_http_failure', attemptId, { mode: 'clinic', status: resp.status });
    const message = (err as { detail?: string }).detail ?? `Registration failed: ${resp.status}`;
    throw new Error(withReference(message, attemptId));
  }
  try {
    const data = (await resp.json()) as LoginResponseOut;
    return { accessToken: data.access_token, clinician: toClinician(data.clinician) };
  } catch {
    reportAuthClientEvent('login_response_invalid', attemptId, { mode: 'clinic', status: resp.status });
    throw new Error(withReference('The registration service returned an invalid response.', attemptId));
  }
}

// Verify existing token and return clinician (used on page load)
export async function getMe(): Promise<Clinician> {
  const resp = await withNetworkRetry(() => fetchWithAuth('/api/auth/me'));
  if (!resp.ok) throw new Error('Not authenticated');
  return toClinician((await resp.json()) as ClinicianOut);
}

// Public — whether the clinic sign-in path should be shown on the login screen
export async function getAuthConfig(): Promise<{ clinicEnabled: boolean }> {
  try {
    const resp = await withNetworkRetry(() => fetch(`${API_BASE}/api/auth/config`));
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
  authAttempt.clear();
}
