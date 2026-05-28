// In dev, VITE_API_URL is empty — Vite's proxy forwards /api → localhost:8000
// In production (Vercel), VITE_API_URL is set to the Railway backend URL
export const API_BASE = import.meta.env.VITE_API_URL ?? '';

// JWT token helpers — stored in localStorage across page refreshes
export const token = {
  get: (): string | null => localStorage.getItem('aura_token'),
  set: (t: string): void => { localStorage.setItem('aura_token', t); },
  clear: (): void => { localStorage.removeItem('aura_token'); },
};

// Authenticated fetch — adds Authorization header and handles 401 globally
export async function fetchWithAuth(path: string, init?: RequestInit): Promise<Response> {
  const t = token.get();
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
  });
  if (resp.status === 401 && token.get()) {
    // Token exists but was rejected (expired) — clear and reload to show login
    token.clear();
    window.location.href = '/';
  }
  return resp;
}
