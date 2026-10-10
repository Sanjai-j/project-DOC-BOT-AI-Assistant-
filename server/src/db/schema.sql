-- ============================================================
-- DocBot TeleMed — PostgreSQL schema
-- Runs unchanged on embedded PGlite and hosted Postgres/Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role          TEXT NOT NULL CHECK (role IN ('pending_doctor','patient','doctor','admin')),
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE,
  phone         TEXT,
  password_hash TEXT,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS patients (
  id            UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth DATE,
  gender        TEXT CHECK (gender IN ('male','female','other')),
  location      TEXT
);

CREATE TABLE IF NOT EXISTS specializations (
  id   SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS hospitals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  address        TEXT NOT NULL,
  city           TEXT NOT NULL,
  country        TEXT NOT NULL DEFAULT 'India',
  phone          TEXT,
  lat            DOUBLE PRECISION,
  lng            DOUBLE PRECISION,
  specialties    TEXT[] NOT NULL DEFAULT '{}',
  emergency_24x7 BOOLEAN NOT NULL DEFAULT false,
  image_url      TEXT,
  rating         DOUBLE PRECISION NOT NULL DEFAULT 0,
  reviews_count  INTEGER NOT NULL DEFAULT 0,
  rating_source  TEXT NOT NULL DEFAULT 'APP' CHECK (rating_source IN ('APP','GOOGLE')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hospitals_city ON hospitals(city);

-- doctors must be created before tables that reference it
CREATE TABLE IF NOT EXISTS doctors (
  id               UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  doctor_code      TEXT NOT NULL UNIQUE,
  specialization   TEXT NOT NULL,
  qualifications   TEXT,
  experience_years INTEGER NOT NULL DEFAULT 0,
  hospital_id      UUID REFERENCES hospitals(id) ON DELETE SET NULL,
  hospital_name    TEXT,
  hospital_address TEXT,
  languages        TEXT[] NOT NULL DEFAULT '{}',
  consultation_fee NUMERIC(10,2),
  fee_currency     TEXT NOT NULL DEFAULT 'INR',
  bio              TEXT,
  photo_url        TEXT,
  avg_rating       DOUBLE PRECISION NOT NULL DEFAULT 0,
  reviews_count    INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','APPROVED','REJECTED','SUSPENDED','INFO_REQUESTED')),
  info_note        TEXT,
  requested_at     TIMESTAMPTZ,
  lat              DOUBLE PRECISION,
  lng              DOUBLE PRECISION,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctors_specialization ON doctors(specialization);
CREATE INDEX IF NOT EXISTS idx_doctors_status ON doctors(status);

CREATE TABLE IF NOT EXISTS doctor_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id   UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doctor_availability (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id    UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  slot_minutes INTEGER NOT NULL DEFAULT 30,
  break_start  TIME,
  break_end    TIME,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (doctor_id, weekday, start_time, end_time)
);
CREATE INDEX IF NOT EXISTS idx_avail_doctor ON doctor_availability(doctor_id);

CREATE TABLE IF NOT EXISTS doctor_unavailable_dates (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  date      DATE NOT NULL,
  reason    TEXT,
  UNIQUE (doctor_id, date)
);

CREATE TABLE IF NOT EXISTS appointments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id         UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  hospital_id       UUID REFERENCES hospitals(id) ON DELETE SET NULL,
  date              DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  consultation_type TEXT NOT NULL DEFAULT 'IN_PERSON' CHECK (consultation_type IN ('IN_PERSON','VIDEO')),
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','CONFIRMED','REJECTED','COMPLETED','CANCELLED')),
  reason            TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appt_doctor ON appointments(doctor_id, date);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id, date);

-- A confirmed (or later) appointment occupies its slot exclusively.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot
  ON appointments(doctor_id, date, start_time)
  WHERE status IN ('PENDING','CONFIRMED','COMPLETED');

CREATE TABLE IF NOT EXISTS video_consultations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'REQUESTED'
                 CHECK (status IN ('REQUESTED','CONFIRMED','IN_PROGRESS','ENDED','REJECTED','CANCELLED')),
  room_id        TEXT,
  reminder_30_sent BOOLEAN NOT NULL DEFAULT false,
  reminder_10_sent BOOLEAN NOT NULL DEFAULT false,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  type       TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info','success','warning','error','emergency')),
  link       TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id      UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_doctor ON reviews(doctor_id);

CREATE TABLE IF NOT EXISTS emergency_requests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL DEFAULT 'CALL_LOG' CHECK (kind IN ('CALL_LOG','HELP_REQUEST')),
  phone_used TEXT,
  message    TEXT,
  status     TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','FALSE_ALARM')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_created ON emergency_requests(created_at);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_session ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS application_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otps (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  code       TEXT NOT NULL,
  purpose    TEXT NOT NULL DEFAULT 'LOGIN' CHECK (purpose IN ('LOGIN','REGISTER')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes',
  consumed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otps_ident ON otps(identifier);

-- ---------------------------------------------------------------------------
-- DocBot knowledge base (trained on Final_Augmented_dataset_Diseases_and_Symptoms)
-- kb_diseases: one row per distinct disease (773) with row counts + specialty.
-- kb_symptoms: one row per distinct symptom column (377) with document stats.
-- kb_disease_symptom: binary co-occurrence per disease x symptom with weight
--   = (# rows of disease having symptom / # rows of disease).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_diseases (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  row_count   INTEGER NOT NULL DEFAULT 0,
  specialty   TEXT NOT NULL DEFAULT 'General Physician',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_symptoms (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  df       INTEGER NOT NULL DEFAULT 0  -- number of disease rows containing it
);

CREATE TABLE IF NOT EXISTS kb_disease_symptom (
  disease_id  INTEGER NOT NULL REFERENCES kb_diseases(id) ON DELETE CASCADE,
  symptom_id  INTEGER NOT NULL REFERENCES kb_symptoms(id) ON DELETE CASCADE,
  weight      REAL NOT NULL DEFAULT 1.0, -- fraction of disease rows having the symptom
  PRIMARY KEY (disease_id, symptom_id)
);
CREATE INDEX IF NOT EXISTS idx_kb_ds_symptom ON kb_disease_symptom(symptom_id);

-- ---------------------------------------------------------------------------
-- DocBot text classifier (trained on Symptom2Disease.csv: 1,200 labeled
-- patient descriptions across 24 diseases). kb_text_classes stores per-class
-- token counts for multinomial Naive Bayes with Laplace smoothing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_text_classes (
  id          SERIAL PRIMARY KEY,
  label       TEXT NOT NULL UNIQUE,        -- disease label from the dataset
  specialty   TEXT NOT NULL DEFAULT 'General Physician',
  doc_count   INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  vocab       JSONB NOT NULL DEFAULT '{}'::jsonb  -- token -> count
);

CREATE TABLE IF NOT EXISTS kb_text_stopwords (
  token TEXT PRIMARY KEY
);

-- ---------------------------------------------------------------------------
-- DocBot triage layer (from doc_bot_medical_symptom_training_dataset.csv:
-- 144 curated conditions with specialties, triage levels, and red flags).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_triage_conditions (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,       -- e.g. MED_001
  condition     TEXT NOT NULL,
  symptoms      TEXT[] NOT NULL,            -- symptom phrases
  specialty     TEXT NOT NULL,              -- raw specialty string from dataset
  triage_level  TEXT NOT NULL,
  red_flags     TEXT[] NOT NULL,
  bot_instruction TEXT NOT NULL
);

