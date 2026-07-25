// In dev, VITE_API_URL is empty — Vite's proxy forwards /api → localhost:8000
// In production (Vercel), VITE_API_URL is set to the Railway backend URL
export const API_BASE = import.meta.env.VITE_API_URL ?? '';

const AUTH_ATTEMPT_KEY = 'aura_auth_attempt_id';
let memoryAttemptId: string | null = null;

function newAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

// A non-secret correlation ID that links browser failures to Railway logs.
// sessionStorage is best-effort; the in-memory fallback covers restricted browsers.
export const authAttempt = {
  create: (): string => newAttemptId(),
  get: (): string | null => {
    if (memoryAttemptId) return memoryAttemptId;
    try {
      memoryAttemptId = sessionStorage.getItem(AUTH_ATTEMPT_KEY);
    } catch {
      // Some privacy modes disable storage. The in-memory fallback still works.
    }
    return memoryAttemptId;
  },
  set: (attemptId: string): void => {
    memoryAttemptId = attemptId;
    try {
      sessionStorage.setItem(AUTH_ATTEMPT_KEY, attemptId);
    } catch {
      // The trace remains available in memory for the current page.
    }
  },
  ensure: (): string => {
    const existing = authAttempt.get();
    if (existing) return existing;
    const created = newAttemptId();
    authAttempt.set(created);
    return created;
  },
  clear: (): void => {
    memoryAttemptId = null;
    try {
      sessionStorage.removeItem(AUTH_ATTEMPT_KEY);
    } catch {
      // Nothing else to clear.
    }
  },
};

export function authReference(attemptId: string): string {
  return attemptId.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
}

export type AuthClientEvent =
  | 'google_on_error'
  | 'google_credential_missing'
  | 'railway_network_failure'
  | 'login_http_failure'
  | 'login_response_invalid'
  | 'jwt_storage_failure'
  | 'post_login_unauthorized';

type AuthClientEventDetails = {
  mode?: 'individual' | 'clinic';
  status?: number;
  path?: string;
};

/**
 * Best-effort, privacy-safe browser failure reporting. Only controlled event
 * names, an opaque attempt ID, mode, and status are sent; never credentials,
 * JWTs, email addresses, clinic names, or request bodies.
 */
export function reportAuthClientEvent(
  event: AuthClientEvent,
  attemptId: string,
  details: AuthClientEventDetails = {},
): void {
  console.warn('[auth]', {
    event,
    attempt_id: authReference(attemptId),
    ...details,
  });

  const traceQuery = encodeURIComponent(attemptId);
  void fetch(`${API_BASE}/api/auth/client-event?auth_attempt_id=${traceQuery}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event,
      attempt_id: attemptId,
      mode: details.mode,
      status: details.status,
    }),
    keepalive: true,
  }).catch(() => {
    // If Railway or CORS is the failure, this diagnostic request may fail too.
    // The visible reference code and browser console remain available.
  });
}

// JWT token helpers — stored in localStorage across page refreshes
export const token = {
  get: (): string | null => localStorage.getItem('aura_token'),
  set: (t: string): void => { localStorage.setItem('aura_token', t); },
  clear: (): void => { localStorage.removeItem('aura_token'); },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run a fetch-returning fn, retrying ONLY transport-level failures — i.e. when
 * fetch() itself rejects (a TypeError like "Load failed" / "Failed to fetch"),
 * which happens on a backend cold start or a transient network blip. Any HTTP
 * response (including 4xx/5xx) resolves and is returned as-is — never retried.
 *
 * Wrap ONLY the fetch call with this, so response-level error handling stays
 * outside the retry.
 */
export async function withNetworkRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(500 * (attempt + 1)); // 0.5s, 1s
    }
  }
}

// Set just before bouncing to login on an expired/rejected token, so the login
// screen can show a friendly "your session ended" notice instead of nothing.
const SESSION_EXPIRED_KEY = 'aura_session_expired';
export function consumeSessionExpired(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
      sessionStorage.removeItem(SESSION_EXPIRED_KEY);
      return true;
    }
  } catch {
    // storage disabled — no notice, not fatal
  }
  return false;
}

/**
 * True when running inside an app's embedded browser (Google app, Facebook,
 * Instagram, etc.) rather than standalone Safari/Chrome. These webviews often
 * don't persist localStorage and block Google Sign-In, so the JWT is never
 * stored/sent → every authenticated request 401s. We warn the user to open in a
 * real browser. Keyed off explicit in-app tokens to avoid false positives.
 */
export function isInAppBrowser(): boolean {
  const ua = navigator.userAgent || '';
  return /GSA\/|FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|WhatsApp|Snapchat|MicroMessenger/i.test(ua);
}

// Authenticated fetch — adds Authorization header and handles 401 globally
export async function fetchWithAuth(path: string, init?: RequestInit): Promise<Response> {
  const t = token.get();

  // No token → don't hit the backend at all. Prevents stray token-less requests
  // (e.g. background polls that fire during/after logout) from emitting 401s.
  if (!t) {
    return new Response(JSON.stringify({ detail: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const attemptId = authAttempt.ensure();
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${t}`,
      ...(attemptId ? { 'X-Auth-Attempt-ID': attemptId } : {}),
    },
  });
  if (resp.status === 401 && token.get()) {
    // Token exists but was rejected (expired) — clear and reload to show login
    if (attemptId) {
      reportAuthClientEvent('post_login_unauthorized', attemptId, { status: 401, path });
    }
    try { sessionStorage.setItem(SESSION_EXPIRED_KEY, '1'); } catch { /* storage off */ }
    token.clear();
    window.location.href = '/';
  }
  return resp;
}
