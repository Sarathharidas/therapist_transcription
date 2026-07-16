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
- Summary format: a structured **OP Case Sheet** (psychiatric intake) in Markdown —
  fields the transcript doesn't cover are marked "Not discussed". The format is
  **editable per therapist**: `DEFAULT_SUMMARY_FORMAT` (the Markdown skeleton) in
  `services/gemini.py` is the default; a therapist can override it via the **Format**
  button on the home screen (`SummaryFormatDialog.tsx` → `PUT /api/settings/summary-format`),
  stored on `clinicians.summary_format` (NULL = use default). The fixed clinical
  instructions wrapping the format (`SUMMARY_INSTRUCTIONS`) are NOT editable. The job
  runner resolves the owning therapist's format at summarize time. Rendered by
  `renderSummary()` in `ResultsPanel.tsx` (lightweight Markdown → HTML, no library).
  The `Format/` folder holds the source case-sheet scans this structure was derived from.
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
├── AGENTS.md                     # ← you are here
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
│   │   ├── auth.py               # Google login (dual-path) + /me + /config
│   │   ├── patients.py           # GET/POST /api/patients
│   │   ├── groups.py             # GET/POST /api/groups (couples/families)
│   │   ├── clinic.py             # clinic members + invites (enterprise)
│   │   ├── sessions.py           # appointment + segmented /process + appointment detail
│   │   └── settings.py           # per-therapist summary-format (GET/PUT)
│   ├── scripts/
│   │   └── encrypt_existing.py   # one-time backfill: encrypt existing plaintext rows
│   └── services/
│       ├── crypto.py             # at-rest PHI encryption (Fernet); encrypt()/decrypt()
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
        │   ├── sessions.ts       # processSession(audio, patientId)
        │   └── settings.ts       # getSummaryFormat(), saveSummaryFormat()
        ├── components/
        │   ├── App.tsx              # Root — views: select | session | group-session | appointment | past-session
        │   ├── PatientSelect.tsx    # Individual / Couple·Group tabs; group builder
        │   ├── SessionView.tsx      # Solo recording controls + processing stages
        │   ├── GroupSessionView.tsx # Segmented recording (joint / 1:1) for an appointment
        │   ├── AppointmentView.tsx  # Appointment results — segments + per-person confidentiality filter
        │   ├── LoginPage.tsx        # Google sign-in with Individual / Clinic path selector
        │   ├── TeamView.tsx         # Clinic admin: members, invites, roles
        │   ├── SummaryFormatDialog.tsx # Edit the per-therapist case-sheet format
        │   ├── ResultsPanel.tsx     # Split view: transcript (left) + summary (right)
        │   └── Sidebar.tsx          # Left nav — collapses appointment segments into one entry
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

### PHI encryption at rest

These columns are encrypted at rest when `ENCRYPTION_KEY` is set (`services/crypto.py`, Fernet):
`summaries.transcription`, `summaries.ai_summary`, `summaries.clinician_notes`,
**`patients.name`**, **`groups.label`**, and **`sessions.label`** (labels often embed patient
names, e.g. "Asha & Ravi").
- **Transparent to the frontend** — the backend `encrypt()`s on write and `decrypt()`s on
  read across `patients.py` / `groups.py` / `sessions.py` / `job_runner.py`; the API still
  returns/accepts plaintext, so no client change.
- **Names need special handling** — because Fernet is non-deterministic, you can't
  `ORDER BY`/`WHERE` an encrypted name. Participant lists are therefore sorted in Python
  after decryption (see `_pname` / `_segment_participants` in `sessions.py`); there are no
  name equality lookups or unique constraints. The AI name-hint (`job_runner`) decrypts
  names before passing them to Gemini. Client-side patient search works on decrypted names.
- **Opt-in + mixed-safe** — no key = values stored as plaintext (local dev / tests
  unaffected). A `enc:1:` marker tags ciphertext so `decrypt()` handles a mix of legacy
  plaintext and encrypted rows. Columns stay `TEXT` (ciphertext is base64) — no migration.
- **Backfill** existing rows once after setting the key:
  `PYTHONPATH=. python backend/scripts/encrypt_existing.py` (idempotent).
- **Threat model:** protects a DB-only compromise (stolen snapshot/backup/read access),
  NOT a compromised app server (it holds the key). Losing `ENCRYPTION_KEY` = unrecoverable
  data — back it up (e.g. AWS Secrets Manager). Rotate via comma-separated keys (MultiFernet)
  → re-run the backfill → drop the old key.

### Group / couple therapy tables

```sql
groups (
  group_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id  UUID REFERENCES clinicians(clinician_id) NOT NULL,
  label         TEXT NOT NULL,                   -- e.g. "Asha & Ravi"
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

group_members (                                  -- M2M: group ↔ patients
  group_id      UUID REFERENCES groups(group_id),
  patient_id    UUID REFERENCES patients(patient_id),
  PRIMARY KEY (group_id, patient_id)
)

sessions (                                       -- one appointment (a visit)
  session_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinician_id  UUID REFERENCES clinicians(clinician_id) NOT NULL,
  group_id      UUID REFERENCES groups(group_id),    -- NULL = solo appointment
  label         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

summary_participants (                           -- M2M: who was present in a segment
  summary_id    UUID REFERENCES summaries(summary_id),
  patient_id    UUID REFERENCES patients(patient_id),
  PRIMARY KEY (summary_id, patient_id)
)
```

`summaries` and `jobs` also gained columns for segment metadata:
`summaries.session_id`, `summaries.segment_type` (`joint` | `individual` | `solo`),
and `jobs.session_id`, `jobs.segment_type`, `jobs.participant_ids` (comma-separated UUIDs).
A summary = **one recorded segment**; a `sessions` row groups the segments of one visit.
Legacy solo summaries have `session_id = NULL` / `segment_type = NULL` and behave unchanged.

**Migrations:** new tables are created by `create_all()`. The new *columns* on the
pre-existing `summaries`/`jobs` tables are added by idempotent `ALTER TABLE ... ADD
COLUMN IF NOT EXISTS` statements in `main.py:_run_column_migrations()` (Postgres only;
SQLite test DB is created fresh from the models).

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/patients` | List all patients for the authenticated clinician, newest first |
| `POST` | `/api/patients` | Create a patient `{ name: string }` → returns `PatientOut` |
| `GET` | `/api/groups` | List groups (couples/families) with members |
| `POST` | `/api/groups` | Create a group `{ label, patient_ids[] }` (2+ members) → `GroupOut` |
| `POST` | `/api/sessions/appointment` | Start a visit `{ group_id? , participant_ids?[], label? }` → `AppointmentOut` (`session_id`) |
| `POST` | `/api/sessions/process` | Form: `audio` + `patient_id` (+ optional `session_id`, `segment_type`, `participant_ids`) → `{ job_id }` (202) |
| `GET` | `/api/sessions/recent` | Recent segments; grouped rows carry `session_id` / `session_label` / `segment_type` |
| `GET` | `/api/sessions/appointment/{id}` | An appointment with all its segments + per-segment participants |
| `POST` | `/api/auth/login` | `{ credential, mode?, clinic_name? }` (`individual`\|`clinic`) → JWT + clinician |
| `POST` | `/api/auth/register-clinic` | Public — `{ credential, clinic_name, therapist_emails[] }` → creates clinic, admin, invites; JWT |
| `GET` | `/api/auth/config` | Public — `{ clinic_enabled }` (login screen no longer gates on it) |
| `GET` | `/api/settings/summary-format` | Therapist's effective summary format `{ format, is_default, default }` |
| `PUT` | `/api/settings/summary-format` | Save a custom format `{ format }` (empty string = reset to default) |
| `GET` | `/api/clinic` | Clinic name + members + pending invites (clinic members) |
| `POST` | `/api/clinic/invites` | *(admin)* Invite `{ email, role }` |
| `DELETE` | `/api/clinic/invites/{id}` | *(admin)* Revoke a pending invite |
| `PATCH`/`DELETE` | `/api/clinic/members/{id}` | *(admin)* Change role / remove member (last-admin guarded) |

**`PatientOut`** (JSON):
```json
{ "patient_id": "uuid", "name": "string", "initials": "string", "created_at": "string" }
```

**`SessionResult`** (JSON):
```json
{ "transcript": "string", "summary": "string", "patient_id": "uuid", "summary_id": "uuid" }
```

### Group / couple therapy workflow

A single appointment can involve 2+ people who are seen **jointly** and **one-on-one**
within the same visit. The clinician records each portion as its own segment, tagged
with who's in the room — so confidentiality is explicit, not guessed:

1. Pick (or create) a **group** in `PatientSelect` → `POST /api/sessions/appointment`
   returns a `session_id` for the visit.
2. In `GroupSessionView`, before each recording the clinician chooses **Joint
   (everyone)** or **Individual: <name>**; each Stop submits a segment via
   `/process` with `session_id` + `segment_type` + `participant_ids`.
3. `gemini.py` receives the participant names as a hint (`_names_hint`) so joint
   transcripts use real first names; an individual segment is labelled `Patient:`.
4. `AppointmentView` groups the segments. A **per-person filter** shows joint
   segments + that person's own 1:1 only — a partner's private 1:1 is never mixed in.

### Clinic / multi-therapist (enterprise)

Two login paths coexist on one deployment, chosen on the login screen:

- **Individual therapist** — open Google sign-in → a private solo account
  (`clinicians.clinic_id = NULL`). **Unchanged from the original single-user flow.**
- **Sign in to my clinic** — invite-gated join. Shown only when a clinic exists
  (`GET /api/auth/config` → `clinic_enabled`).

Key points:
- **Data is NOT shared.** A clinic is a login/membership boundary only; every therapist's
  patients/sessions stay scoped to their own `clinician_id` exactly as before.
- **Self-serve registration.** Clinic tab → **Register clinic**: Google sign-in, then name
  the clinic + add N teammate emails (`POST /api/auth/register-clinic`, `ClinicRegister.tsx`).
  The registrant becomes `admin`; the emails become `pending` invites. Clinic names are
  unique (case-insensitive).
- **Clinic login matches name + email.** Clinic tab → **Login**: Google sign-in + clinic
  name. `routes/auth.py:google_login` (mode `clinic`) resolves the clinic by name
  (`_clinic_by_name`, `ilike`), then admits an existing member of that clinic or a
  pending-invited email; otherwise 403. The **individual** mode path is unchanged
  (existing → return; new → solo signup).
- **No email infra.** Because Google verifies the email, matching a `pending`
  `clinic_invite` to the verified email is enough to admit a therapist — no magic links.
- Roles are `admin` | `therapist`; `require_admin` (`services/auth.py`) guards
  `/api/clinic/*` management; admins manage members/invites in `TeamView.tsx`.
- `main.py:_bootstrap_clinic` (env `CLINIC_NAME`/`CLINIC_ADMIN_EMAIL`) remains as an
  optional legacy bootstrap; self-serve registration is the primary path.

---

## Environment Variables

### Backend (`.env` in project root)
```
GEMINI_API_KEY=          # Google AI Studio key — required
DATABASE_URL=            # PostgreSQL connection string — required
CLINICIAN_EMAIL=         # e.g. doctor@clinic.com — seeded to DB on startup
CLINICIAN_NAME=          # e.g. Dr. Abid — seeded to DB on startup
FRONTEND_ORIGIN=         # Vercel URL(s) for CORS, e.g. https://your-app.vercel.app
                         # NO trailing slash (browsers send Origin without one).
                         # Comma-separate multiple (custom domain + vercel.app).
FRONTEND_ORIGIN_REGEX=   # OPTIONAL — allow preview deploys by regex, e.g.
                         # https://your-app[a-z0-9-]*\.vercel\.app

# PHI encryption at rest (OPTIONAL — unset = transcripts stored as plaintext)
ENCRYPTION_KEY=          # Fernet key(s). Encrypts summary/transcript/notes at rest.
                         # Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
                         # Comma-separate multiple keys for rotation (first encrypts, all decrypt).

# Clinic / enterprise (OPTIONAL — unset = plain single-therapist deployment)
CLINIC_NAME=             # e.g. "Bright Minds" — creates the clinic on startup
CLINIC_ADMIN_EMAIL=      # the first admin — promoted/invited on startup
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
| MediaRecorder capped at `audioBitsPerSecond: 32000` | Speech needs little bitrate; ~4–8× smaller uploads → fewer long-upload timeouts (`useRecorder.ts`) |
| Upload streamed to disk in 1 MB chunks (not `await audio.read()`) | Flat memory regardless of session length; avoids OOM on large files (`sessions.py` `/process`) |

### Upload reliability (long-audio "Load failed")

Long sessions on slow/flaky uplinks could drop mid-upload — the browser showed
"Load failed" and the recording was **lost** (no Job row created). Hardening:
- **Stream to disk** in `/process` — chunked write, size cap enforced as it goes,
  partial temp file cleaned up on failure.
- **Client retry + timeout** — `submitSession` retries transport-level failures
  (the "Load failed" rejection / abort) up to 3× with backoff via `AbortController`;
  HTTP errors (413/429/…) are *not* retried.
- **Recording preserved on failure** — `SessionView` / `GroupSessionView` keep the
  recorded blob in a `'failed'` phase with **Retry upload** / **Discard** instead of
  discarding it. The `beforeunload` guard also covers `'failed'`.
- Larger architectural fix (chunked/resumable upload) is deliberately deferred —
  see "Phase 2" discussion; revisit only if failures persist after the above.

---

## Known Limitations / Future Work

- **No authentication** — single hardcoded clinician from `.env`; anyone with the URL can use it
- **No session history UI** — summaries are saved to DB but not yet displayed in the app
- **No patient editing/deletion** — patients can only be created, not edited or removed
- **Clinician notes not persisted** — the notes textarea in ResultsPanel is local state only
- **Python 3.9** — upgrade to 3.11+ when possible; several libraries warn about EOL
- **Audio format** — only `audio/webm` tested; Safari may produce `audio/mp4`
