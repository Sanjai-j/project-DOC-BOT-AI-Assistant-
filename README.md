# 🩺 DocBot TeleMed

A full-stack **telemedicine web application** with three roles — **Patient**, **Doctor**, **Admin** — featuring an AI medical-guidance assistant (DocBot), doctor verification, appointment booking with doctor approval, WebRTC video consultations, reminders, emergency calling, and hospital/doctor discovery.

> ⚠️ **Medical safety notice:** DocBot TeleMed is a software platform, not a medical provider. DocBot provides general guidance and is **not a medical diagnosis**. It is never a replacement for a qualified doctor. The platform is **not an emergency medical service** — in a life-threatening emergency, contact your local emergency services immediately.

---

## Demo

![DocBot TeleMed landing page](docs/screenshots/landing.png)

**DocBot in action** — the patient describes symptoms in plain words; DocBot replies with statistically associated conditions from the disease–symptom dataset, a specialty suggestion, and one-click doctor discovery:

![DocBot chat conversation](docs/screenshots/docbot-chat.png)

**Admin operations** — doctor verification, platform health, appointment/specialty analytics over 6,212 doctors and 74 hospitals:

![Admin dashboard](docs/screenshots/admin-dashboard.png)

More: [How it works](docs/screenshots/how-it-works.png) · [Patient dashboard](docs/screenshots/patient-dashboard.png) · [Find doctors](docs/screenshots/find-doctors.png)

To try it live on your machine: run `npm run dev` (see Quick start below) and log in with the demo accounts. Screenshots are regenerated with `node scripts/screenshots.mjs` while the app is running.

---

## Quick start (zero configuration)

```bash
npm install
npm run setup     # initializes the embedded database and seeds demo data
npm run dev       # starts API (:4000) + web app (:5173)
```

Open **http://localhost:5173**

That's it — no Postgres server, no API keys. The backend uses an **embedded PostgreSQL (PGlite)** stored in your OS temp dir by default, and DocBot falls back to a built-in rule engine. Both upgrade seamlessly (see below).

### Demo accounts (development)

| Role | Credentials | Notes |
|---|---|---|
| **Patient** | `patient@docbot.dev` / `patient123` | Or OTP login — the code appears in the server console and in the UI (dev mode) |
| **Doctor** | Full name `Demo Doctor 0001` + Doctor ID `DOC200001` / `doctor123` | From the imported India doctor directory (6,210 doctors) |
| **Admin** | `admin@docbot.dev` / `ChangeMe!123` | Login at the hidden route `/admin/login` |

The seed also creates 5 hospitals, weekly availability, a completed consultation with a review, a confirmed video consultation, a pending appointment request, and **one pending doctor** so you can immediately test admin verification. Approved doctors come from the **India doctor directory dataset** — load it with `npm run doctors:import --workspace server` (6,210 doctors across 69 cities and 30 specialty categories, codes DOC200001+, shared demo password `doctor123`). All data is fictional.

---

## Technology

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS | Responsive (desktop / tablet / mobile), clean healthcare UI |
| Backend | Node.js + Express (REST) + Socket.IO | TypeScript, zod input validation, rate limiting |
| Database | PostgreSQL-compatible SQL | Hosted Postgres/Supabase via `DATABASE_URL`, or **embedded PGlite** with zero setup |
| Auth | JWT + bcrypt password hashing + OTP | Three separated role systems |
| AI | OpenAI-compatible API **or** built-in rule engine | No key required to run |
| Video | WebRTC (STUN) with Socket.IO signaling | Doctor-initiated calls; adapter layer for external providers |
| Maps | Stored coordinates + haversine distance | Optional Google Maps when a key is configured |

---

## Environment variables

Copy `.env.example` → `.env` (root). Everything is optional:

```ini
PORT=4000
JWT_SECRET=dev-only-secret-change-me      # CHANGE IN PRODUCTION
DATABASE_URL=                             # empty = embedded PGlite; or Supabase/Postgres URL
ADMIN_EMAIL=admin@docbot.dev
ADMIN_PASSWORD=ChangeMe!123
OTP_EXPIRY_MINUTES=10

AI_API_KEY=                               # optional — enables LLM-powered DocBot
AI_MODEL=gpt-4o-mini
AI_BASE_URL=https://api.openai.com/v1    # any OpenAI-compatible endpoint (Groq, Ollama…)

GOOGLE_MAPS_API_KEY=                      # optional server-side
VITE_GOOGLE_MAPS_API_KEY=                 # optional client-side (interactive map)
DEFAULT_EMERGENCY_NUMBER=112              # admin can change it in Settings
```

**Never commit real secrets.** The `.gitignore` already excludes `.env*` files, uploads (private ID documents), and local database data.

### Viewing the database

The embedded Postgres is a real PostgreSQL engine — you can inspect it two ways:

**1. From the terminal (interactive SQL console):**

```bash
cd server
npm run db:sql        # shows all tables with row counts, then a SQL> prompt
npm run db:sql "SELECT full_name, email FROM users;"   # or run one query directly
```

Useful first queries:

```sql
SELECT doctor_code, full_name, specialization, status FROM doctors;
SELECT role, full_name, email FROM users;
SELECT status, count(*) FROM appointments GROUP BY status;
```

**2. From a GUI tool (pgAdmin, DBeaver, TablePlus, IntelliJ):**

```bash
cd server
npm run db:serve      # exposes Postgres wire protocol on 127.0.0.1:5434
```

Then connect with: Host `127.0.0.1`, Port `5434`, Database `postgres`, User `postgres`, Password *(blank)*. Stop the app dev server first if `db:serve` can't open the data dir — only one process can hold the embedded database at a time.

**3. Using a locally installed PostgreSQL instead:** set `DATABASE_URL` in `server/.env` (e.g. `postgresql://postgres:YOURPW@127.0.0.1:5432/docbot`), create the `docbot` database, then run `npm run db:setup --workspace server && npm run seed --workspace server`. The same schema works unchanged; your pgAdmin then shows live app data on that port.

> Passwords are stored as bcrypt hashes — you can see *that* a password exists, never its text. Run `npx tsx src/scripts/list-logins.ts` (from `server/`) to list accounts and check them against known demo passwords.

### Upgrading the database

Set `DATABASE_URL` to any PostgreSQL connection string (e.g. Supabase's free tier) and restart — the schema is applied automatically on boot. The SQL is identical for both drivers (`server/src/db/schema.sql`).

> Note: PGlite's data dir defaults to the OS temp folder (`DATA_DIR` overrides it) because its shared-memory files break under OneDrive/Dropbox sync.

### Upgrading DocBot's AI

Set `AI_API_KEY` (and optionally `AI_BASE_URL`/`AI_MODEL`) and DocBot uses the LLM with a strict, diagnosis-blocking system prompt. Emergency detection **always** also runs locally on every message, so the LLM can never suppress an escalation. Without a key, the deterministic rule engine handles everything.

### Training DocBot on the disease–symptom dataset

DocBot is trained on **Final_Augmented_dataset_Diseases_and_Symptoms** (246,945 rows, 773 diseases, 377 symptoms). The dataset is imported into three `kb_*` tables (`kb_diseases`, `kb_symptoms`, `kb_disease_symptom`) and used at chat time to recognize symptoms, surface statistically associated conditions, and route to the right specialty:

```bash
npm run kb:import --workspace server
```

The 182 MB CSV ships gzipped at [`datasets/`](datasets/) (1.6 MB) and is decompressed on the fly — no path argument needed. See [datasets/README.md](datasets/README.md) for details on all four datasets.

The chat pipeline is: **emergency detection → rule engine → KB enrichment (dataset-trained) → optional LLM**. Emergencies always short-circuit everything; KB replies always carry the not-a-diagnosis disclaimer; the KB can only confirm or improve specialty suggestions, never suppress them.

### Training DocBot on patient wording (Symptom2Disease.csv)

A second dataset, **Symptom2Disease.csv** (1,200 labeled patient descriptions across 24 diseases), trains DocBot's *language* side: a Naive Bayes text classifier stored in `kb_text_classes`. It handles free-form descriptions that never name a canonical symptom (e.g. "silver like dusting on my skin" → Psoriasis → Dermatologist):

```bash
npm run kb:text-import --workspace server
```

Hold-out evaluation (train 80% / test 20%): **97.1% top-1 accuracy, 100% top-3, 99.6% specialty agreement**. Re-run anytime with `npm run kb:eval --workspace server`.

Both knowledge bases work together: canonical symptom evidence leads when present; the text classifier takes over only for descriptions it recognizes with confidence; emergencies always win.

### Triage layer (doc_bot_medical_symptom_training_dataset.csv)

A third dataset — **144 curated conditions with symptom lists, recommended specialties, triage levels, and red flags** — adds safety-grade triage:

- **Urgency guidance**: replies may say "book today or tomorrow" (same-day/urgent triage levels) instead of a plain booking prompt.
- **Red-flag escalation**: phrases like *sudden worst-ever headache*, *vomiting blood*, *black tarry stool*, *rigid abdomen*, *non-blanching rash* trigger an emergency-style card with call/help buttons, even mid-conversation.
- **Fallback routing**: when the statistical KBs are inconclusive, the curated condition list decides specialty + urgency.

```bash
npm run kb:triage-import --workspace server
```

Full pipeline: **emergency detection → red-flag scan → rule engine → KB symptoms → text classifier → curated triage**. Every layer can escalate to the emergency card; none can downgrade it.

### Loading the India doctor directory (doc_bot_india_doctor_directory_synthetic.csv)

The bookable doctor directory is imported from **doc_bot_india_doctor_directory_synthetic.csv** (6,210 synthetic doctors: 30 specialty categories × 207, 69 Indian cities). The import REPLACES any previously imported directory doctors and the legacy sample set, then creates:

- one city hospital per city (`Demo Medical Centre — <City>`, 69 rows) with real city coordinates so nearby search and the map work
- one APPROVED doctor per CSV row: Doctor ID `DOC200001`+, specialty mapped to the app's bookable specialties, CSV experience/fee/languages kept verbatim, Mon–Sat availability (09:00–13:00 + 17:00–20:00, 30-min slots → 74,520 slots)
- deterministic synthetic ratings/review counts (the dataset contains none), stable across re-imports

```bash
npm run doctors:import --workspace server
```

(Defaults to the copy in `datasets/`; pass a path to use another CSV.) Doctor logins use the full name + Doctor ID + password, e.g. **Demo Doctor 0001 / DOC200001 / doctor123**.

---

## How the major workflows operate

### 1. DocBot (AI assistant)

1. Patient describes symptoms in plain language (`POST /api/chat`).
2. **Emergency screen first**: phrases like *severe chest pain, difficulty breathing, unconscious, severe bleeding, stroke, anaphylaxis, suicidal* immediately return an emergency card with **Call Emergency Services** and **Emergency Help** buttons — the chat never continues triage.
3. Otherwise the engine (rules and/or LLM) maps symptoms to a **suggested specialty** (e.g. sore throat + ear pain → ENT) with carefully non-diagnostic wording ("these symptoms can have several causes…").
4. Action buttons deep-link into Find Doctors pre-filtered by that specialty.
5. Every conversation is persisted per user (`chat_sessions`, `chat_messages`) and every reply carries the guidance disclaimer.

### 2. Doctor approval workflow

1. Doctor registers (`POST /api/doctors/register`) with medical reg. number, hospital, availability and a **medical ID document** upload → status `PENDING`, login blocked.
2. Admin sees the queue at **Admin → Doctor Verification**, can open the document (streamed through an **admin-only authenticated endpoint** — never public), then:
   - **Approve** → a unique sequential **Doctor ID** (`DOC1001`, `DOC1002`, …) is assigned (admins may supply a custom unused code; duplicates are rejected) and the doctor can log in with `Doctor ID + password`.
   - **Reject** → status `REJECTED`, doctor notified with the reason.
   - **Request additional info** → status `INFO_REQUESTED`, doctor notified.
3. Admins can later **Suspend** / **Reactivate** doctors; suspension blocks login immediately.

### 3. Appointment workflow

1. Patient picks doctor → date → generated slot → consultation type (in-person / video) → **Request Appointment** → status `PENDING`. The slot becomes unavailable to everyone else immediately (DB partial-unique index + slot revalidation).
2. Doctor sees the request (patient name, date, time, type, reason) and **Accepts** (`CONFIRMED`) or **Rejects**; both sides receive notifications.
3. Confirmed appointments can be cancelled by either party (notify the other) or **completed by the doctor**, which unlocks the patient's 1–5 star **review** (one review per appointment; averages recalculate automatically).
4. Slots are generated from each doctor's weekly availability (working days, start/end, duration, breaks, leave dates) with past-time and booked-slot exclusion — **"Available this week"** filters doctors who have ≥1 open slot in the next 7 days.

### 4. Video consultation workflow

1. The patient can only **request** a video slot (`PENDING`) — patients can never start calls.
2. The doctor **accepts** (creates a private room) or **rejects**.
3. At the appointment time **only the doctor sees Start Call** (15 min before → 30 min after the window), which marks the call `IN_PROGRESS` and notifies the patient.
4. The patient's **Join Consultation** button activates only when the call is confirmed and the join window is open (10 min before → 15 min after).
5. The room is WebRTC peer-to-peer with STUN; signaling goes through authenticated Socket.IO rooms (JWT + signed short-lived room tokens + appointment-membership check). The doctor ends the call → appointment `COMPLETED` → review unlocked.
6. `server/src/realtime/socket.ts` and `server/src/routes/video.ts` form the adapter layer — a hosted provider (Daily/Twilio) can replace the transport without touching the UI.

### 5. Reminder / alarm workflow

A scheduler on the server checks confirmed video consultations every minute and creates notifications **30 minutes** and **10 minutes** before start ("Video consultation with John is scheduled at 5:00 PM"). The client polls, then raises an **in-app toast** and a **browser notification** (with permission). Toggle both reminder classes in **Admin → Settings**.

### 6. Emergency workflow

- Every Emergency button dials the **admin-configured number** (`tel:` link) stored in `application_settings` (default from `DEFAULT_EMERGENCY_NUMBER`).
- Call attempts and help requests are logged (`CALL_LOG` / `HELP_REQUEST`, optionally with GPS coordinates) and shown to admins in **Emergency Requests** with Resolve / False-alarm actions.
- DocBot escalates suspected emergencies instantly (see above). The UI always states the platform is **not an emergency medical service**.

### 7. Hospitals & ratings

- Hospital directory with search, city/24×7 filters, nearby ranking by haversine distance, **Get Directions** (Google Maps link from stored coordinates), doctor counts and transparent rating labels (**Application Rating** vs **Google Rating** — nothing is fabricated).
- Only patients with a **completed** appointment can review that doctor; duplicates are blocked by a unique constraint; doctor averages and review counts recalculate on every review.

---

## Security

- bcrypt password hashing; JWT sessions; role-based middleware (`requireAuth(['admin'])` etc.) on every protected route.
- **Three separate login systems** — patients (email/phone + OTP), doctors (Doctor ID + password, approval-gated), admins (secrets + hidden `/admin/login` route).
- Role separation: patients can't reach doctor/admin dashboards or APIs (verified by tests); doctors only see their own appointments/schedule; admin document access is an authenticated stream.
- Medical ID documents are stored **outside** any public static path and served only through `GET /api/admin/documents/:storedName` after `requireAuth(['admin'])`.
- zod validation on all inputs; file-type/size validation on uploads (JPG/PNG/WEBP/PDF ≤ 5 MB); rate limiting on auth and API; parameterized SQL everywhere; CORS allow-list.

---

## Testing

```bash
npm test                 # vitest: DocBot rules, KB, triage, slots (53 tests)
cd server && npx tsx src/scripts/e2e.ts   # full API workflow test (needs server running)
```

The E2E script covers: health → patient login → DocBot mapping & emergency → doctor discovery/nearby → slots → video request → **patient cannot start call** → doctor login/accept → join-window enforcement → notifications → emergency logging → hospitals → admin stats → doctor registration → verification → **approval assigns DOC code → new doctor can log in** → role-based access denial.

---

## API overview

Full interactive list in [docs/API.md](docs/API.md). Quick map:

```
Auth        POST /api/auth/patient/register | send-otp | verify-otp | login
            POST /api/auth/doctor/login | admin/login        GET/PATCH /api/auth/me
Doctors     GET  /api/doctors | /nearby | /:id | /:id/slots
            POST /api/doctors/register
            PUT  /api/doctors/:id/availability   (doctor)
            GET|POST /api/doctors/:id/unavailable
Appointments POST /api/appointments             GET /api/appointments
            POST /api/appointments/:id/accept | reject | cancel | complete | review
Video       POST /api/video/request | accept | reject
            GET  /api/video/mine | /room/:appointmentId
            POST /api/video/:appointmentId/start | end       (doctor only)
Hospitals   GET  /api/hospitals | /nearby | /top-rated | /:id
Chat        POST|GET|DELETE /api/chat
Notifications GET /api/notifications | /stream   POST /read
Emergency   GET  /api/emergency/number | /mine   POST /api/emergency
Admin       GET  /api/admin/stats | /doctors | /patients | /hospitals | /appointments | /emergency | /settings | /reports
            POST /api/admin/doctors/:id/approve | reject | request-info | suspend | reactivate
            PUT  /api/admin/settings             POST/PUT/DELETE /api/admin/hospitals...
```

---

## Deployment (free/low-cost)

**Frontend** — Netlify / Vercel / Cloudflare Pages (free): build `client` (`npm run build` inside `client/`), publish `client/dist`, set `VITE_GOOGLE_MAPS_API_KEY` if using maps.

**Backend** — Render / Railway / Fly.io free tier: root directory `server`, start command `npm start` (add `"start": "node dist/index.js"` after `npm run build`), set env vars (`DATABASE_URL`, `JWT_SECRET`, `ADMIN_*`, optional `AI_*`). Use hosted Postgres (Supabase free tier) via `DATABASE_URL`.

**WebRTC note:** peer-to-peer with public STUN works for most networks; for symmetric-NAT offices add a TURN server (e.g. coturn or a metered TURN provider) via `iceServers` in `client/src/pages/VideoRoom.tsx`.

---

## Project structure

```
server/src
  db/          schema.sql + pg/PGlite adapter
  routes/      auth, doctors, appointments, video, hospitals, chat, notifications, emergency, admin
  services/    settings, notifications, slots, reminders
  docbot/      rules engine + LLM adapter
  realtime/    socket.io signaling
  scripts/     db-setup, seed, check, e2e, dataset importers
client/src
  pages/       landing, auth (3 roles), dashboards, DocBot, discovery, booking, video room, admin…
  components/  shared UI (layouts, badges, modals)
  lib/         api client, reminder alarms
  context/     auth
datasets/      the 4 training datasets (see datasets/README.md)
docs/          API reference + README screenshots
scripts/       screenshot capture (CDP, zero-dependency)
```

## Development order reference

Setup → DB → Auth → Patient flows → Doctor registration → Admin auth → Verification → Dashboards → Doctor search → Hospital search → Availability → Appointments → Approval → Notifications → Video → Reminders → Emergency → DocBot → Reviews → Security → Responsive UI → Tests. ✅ All implemented and verified (53 unit tests + 27-check E2E + live UI walkthrough of patient, doctor and admin journeys).
