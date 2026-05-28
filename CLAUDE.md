# Aura Clinical — Project Reference

This file is the authoritative guide for any AI agent or developer working on this codebase.
Read it fully before making any changes.

---

## What This App Does

Aura Clinical is a browser-based tool for therapists to record sessions, transcribe them, and generate AI clinical summaries. The workflow is:

1. Therapist selects or creates a patient
2. Presses **Start Session** — browser records audio via MediaRecorder API
3. Presses **Stop** — audio is sent to the backend
4. Backend uploads audio to Gemini, gets a transcript + plain-language summary
5. Results are saved to PostgreSQL and displayed in a split-pane view (transcript left, summary right)

**Key domain facts:**
- Sessions are in Malayalam + English (code-switching / Manglish). Gemini translates everything to English.
- Transcript format: `Therapist: ...` / `Patient: ...` speaker labels on every turn
- Summary format: 2–4 plain paragraphs, no headings or bullet points
- Single clinician per deployment — seeded from `.env` on startup, no auth system yet
- No audio is stored permanently — the Gemini Files API file is deleted after processing

---

## Architecture

```
┌─────────────────────────────────┐     ┌──────────────────────────────────┐
│  Frontend (Vercel)              │     │  Backend (Railway)               │
│  React 19 + Vite + Tailwind v4  │────▶│  FastAPI + SQLAlchemy            │
│  TypeScript                     │     │  Python 3.9                      │
└─────────────────────────────────┘     └──────────────┬───────────────────┘
                                                        │
                                          ┌─────────────▼─────────────┐
                                          │  PostgreSQL (Neon/Supabase)│
                                          └───────────────────────────┘
                                                        │
                                          ┌─────────────▼─────────────┐
                                          │  Google Gemini API        │
                                          │  (gemini-2.5-flash)       │
                                          └───────────────────────────┘
```

**In development:** Vite dev server proxies `/api/*` → `localhost:8000`. No CORS config needed.  
**In production:** Frontend on Vercel calls the Railway backend URL directly via `VITE_API_URL`.

---

## Folder Structure

```
Therapist Transcripts/
├── .env                          # Secrets — never committed (see .gitignore)
├── .gitignore
├── CLAUDE.md                     # ← you are here
│
├── backend/
│   ├── requirements.txt          # Python deps
│   ├── main.py                   # FastAPI app — startup, CORS, route registration
│   ├── models.py                 # Pydantic response models (SessionResult)
│   ├── db/
│   │   ├── __init__.py           # SQLAlchemy ORM: Clinician, Patient, Summary
│   │   ├── session.py            # Engine + SessionLocal + get_db() generator
│   │   └── seed.py               # Seeds clinician from .env on startup; caches UUID
│   ├── routes/
│   │   ├── patients.py           # GET/POST /api/patients
│   │   └── sessions.py           # POST /api/sessions/process
│   └── services/
│       └── gemini.py             # GeminiService — upload, transcribe, summarise
│
└── frontend/
    ├── .env.production           # VITE_API_URL= (fill in Railway URL before deploying)
    ├── index.html
    ├── vite.config.ts            # Vite proxy: /api → localhost:8000 (dev only)
    ├── package.json
    └── src/
        ├── api/
        │   ├── base.ts           # API_BASE = VITE_API_URL ?? '' (empty = use proxy)
        │   ├── patients.ts       # listPatients(), createPatient()
        │   └── sessions.ts       # processSession(audio, patientId)
        ├── components/
        │   ├── App.tsx           # Root — view state: 'select' | 'session'
        │   ├── PatientSelect.tsx # Patient search/create with dropdown
        │   ├── SessionView.tsx   # Recording controls + processing stages
        │   ├── ResultsPanel.tsx  # Split view: transcript (left) + summary (right)
        │   └── Sidebar.tsx       # Left nav
        ├── hooks/
        │   └── useRecorder.ts    # MediaRecorder wrapper — start/stop/blob/reset
        ├── types.ts              # Shared TypeScript types
        ├── styles.css            # Tailwind v4 + CSS custom properties (fonts, tokens)
        └── vite-env.d.ts         # import.meta.env types
```

---

## Database Schema

```sql
clinicians (
  clinician_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL
)

patients (
  patient_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  clinician_id  UUID REFERENCES clinicians(clinician_id) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

summaries (
  summary_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id    UUID REFERENCES patients(patient_id) NOT NULL,
  ai_summary    TEXT,
  transcription TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Tables are created automatically on startup via `Base.metadata.create_all()`.
The clinician row is seeded from `CLINICIAN_EMAIL` / `CLINICIAN_NAME` in `.env`.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/patients` | List all patients for the seeded clinician, newest first |
| `POST` | `/api/patients` | Create a patient `{ name: string }` → returns `PatientOut` |
| `POST` | `/api/sessions/process` | Form: `audio` (file) + `patient_id` (str) → `SessionResult` |

**`PatientOut`** (JSON):
```json
{ "patient_id": "uuid", "name": "string", "initials": "string", "created_at": "string" }
```

**`SessionResult`** (JSON):
```json
{ "transcript": "string", "summary": "string", "patient_id": "uuid", "summary_id": "uuid" }
```

---

## Environment Variables

### Backend (`.env` in project root)
```
GEMINI_API_KEY=          # Google AI Studio key — required
DATABASE_URL=            # PostgreSQL connection string — required
CLINICIAN_EMAIL=         # e.g. doctor@clinic.com — seeded to DB on startup
CLINICIAN_NAME=          # e.g. Dr. Abid — seeded to DB on startup
FRONTEND_ORIGIN=         # Vercel URL e.g. https://your-app.vercel.app (CORS)
```

### Frontend (set in Vercel dashboard, or `frontend/.env.production`)
```
VITE_API_URL=            # Railway backend URL e.g. https://your-backend.up.railway.app
                         # Leave empty for local dev (Vite proxy handles it)
```

---

## Running Locally

Two terminals:

**Terminal 1 — Backend:**
```bash
cd "Therapist Transcripts"
pip3 install -r backend/requirements.txt
PYTHONPATH=. python3 -m uvicorn backend.main:app --port 8000 --reload
```

Expected startup output:
```
[seed] Clinician created: Dr. Abid <abid@gmail.com>
INFO: Uvicorn running on http://127.0.0.1:8000
```

**Terminal 2 — Frontend:**
```bash
cd "Therapist Transcripts/frontend"
npm install
npm run dev
```

Open **http://localhost:5173**

---

## Deployment

| Service | What it runs | Config |
|---------|-------------|--------|
| **Railway** | FastAPI backend | Start: `pip install -r backend/requirements.txt && uvicorn backend.main:app --host 0.0.0.0 --port $PORT` |
| **Vercel** | React frontend | Root: `frontend/`, Build: `npm run build`, Output: `dist` |
| **Neon / PostgreSQL** | Database | Any IPv4-accessible PostgreSQL — Neon free tier works well |

**Deployment order:**
1. Deploy backend on Railway → get its public URL
2. Set `VITE_API_URL` in Vercel to that URL
3. Set `FRONTEND_ORIGIN` in Railway to the Vercel URL
4. Deploy frontend on Vercel

---

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| `google.genai` (not `google.generativeai`) | `google.generativeai` is deprecated; new SDK is `google-genai` package |
| `gemini-2.5-flash` model | Only model confirmed available on this account via `client.models.list()` |
| Gemini Files API (upload then reference) | Required for audio >20 MB and long sessions; files deleted after use |
| `pool_pre_ping=True` on SQLAlchemy engine | Prevents stale connection errors from Supabase/Neon idle timeouts |
| `Optional[X]` not `X \| None` | Python 3.9 compatibility — union syntax requires 3.10+ |
| Single clinician seeded from `.env` | No auth system yet; multi-clinician support is a future addition |
| Neon over Supabase for local dev | Supabase free tier uses IPv6-only direct connections; Neon is IPv4 by default |
| `UUID(as_uuid=True)` + `server_default=text("gen_random_uuid()")` | psycopg2 rejects bare UUID strings; must wrap with `uuid.UUID()` before insert |
| Transcript stored as `transcription` column, summary as `ai_summary` | Column names in DB — don't rename without a migration |
| Audio sent as `audio/webm` (MediaRecorder default on Chrome/Firefox) | Backend saves to `.webm` temp file; Gemini accepts this mime type |

---

## Known Limitations / Future Work

- **No authentication** — single hardcoded clinician from `.env`; anyone with the URL can use it
- **No session history UI** — summaries are saved to DB but not yet displayed in the app
- **No patient editing/deletion** — patients can only be created, not edited or removed
- **Clinician notes not persisted** — the notes textarea in ResultsPanel is local state only
- **Python 3.9** — upgrade to 3.11+ when possible; several libraries warn about EOL
- **Audio format** — only `audio/webm` tested; Safari may produce `audio/mp4`
