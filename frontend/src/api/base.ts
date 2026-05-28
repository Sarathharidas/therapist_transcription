// In dev, VITE_API_URL is empty — Vite's proxy forwards /api → localhost:8000
// In production (Vercel), VITE_API_URL is set to the Railway backend URL
export const API_BASE = import.meta.env.VITE_API_URL ?? '';
