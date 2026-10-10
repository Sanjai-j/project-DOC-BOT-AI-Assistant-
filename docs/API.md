# DocBot TeleMed — API Documentation

Base URL (dev): `http://localhost:4000` — the Vite dev server also proxies `/api` on port 5173.

## Authentication

All authenticated endpoints expect `Authorization: Bearer <JWT>`. Tokens are issued by the login endpoints and carry `{ sub, role, name, doctorCode? }`.

- **Patients** — email/phone + OTP (or password if set at registration)
- **Doctors** — unique Doctor ID (e.g. `DOC1001`) + password; only `APPROVED` doctors can log in
- **Admins** — email + password at the hidden `/admin/login` route

Errors use `{ "error": "human readable message" }` with appropriate status codes (400 validation, 401 auth, 403 role/status, 404 missing, 409 conflict, 413 upload, 423 time-window, 429 rate-limit, 500 server).

---

## Auth

### POST /api/auth/patient/register
Create a patient account and send an OTP.
```json
{ "fullName": "Ravi K", "email": "ravi@example.com", "phone": "+919876543210",
  "dateOfBirth": "1992-04-12", "gender": "male", "location": "Bengaluru", "password": "optional-min-8" }
```
→ `201 { message, sentTo, devOtp? }` (`devOtp` only outside production; in production plug an email/SMS provider in `server/src/routes/auth.ts → deliverOtp`).

### POST /api/auth/patient/send-otp
`{ "identifier": "ravi@example.com or +919876543210" }` → `200 { message, devOtp? }`

### POST /api/auth/patient/verify-otp
`{ "identifier": "...", "code": "123456" }` → `200 { token, user }`
Errors: `Invalid OTP code`, `This OTP has expired` (expiry configurable), suspended accounts → 403.

### POST /api/auth/patient/login
`{ "identifier": "...", "password": "..." }` → `200 { token, user }`

### POST /api/auth/doctor/login
`{ "doctorCode": "DOC1001", "password": "..." }` → `200 { token, user }`
Status errors (403): pending verification, info requested, rejected, suspended.

### POST /api/auth/admin/login
`{ "email": "admin@docbot.dev", "password": "..." }` → `200 { token, user }`

### GET /api/auth/me *(any role)*
→ `{ user: { ...profile, patient fields | doctor fields } }`

### PATCH /api/auth/me *(patient)*
`{ fullName?, location?, gender?, dateOfBirth? }` → `{ message }`

---

## Doctors

### POST /api/doctors/register *(multipart/form-data)*
Fields: `fullName, doctorIdNumber, hospitalName, hospitalAddress, yearsExperience, specialization, email, phone, password (min 8), availableDays (e.g. "1,2,3"), availableHours "09:00-17:00", qualifications?, languages?, consultationFee?, city?`
Files: `idDocument` (required, JPG/PNG/WEBP/PDF ≤5 MB, **stored privately**), `photo` (optional).
→ `201 { message }` — status `PENDING`; login blocked until admin approval.

### GET /api/doctors
Query: `specialty, city, hospital, minRating, availableThisWeek=true, date=YYYY-MM-DD`
→ `{ doctors: [...] }` — approved doctors only, rated/alpha order.

### GET /api/doctors/nearby
Query: `lat, lng` (haversine ranking, `distance_km` added) or `city`
→ `{ doctors, mode }`

### GET /api/doctors/:id
Public profile (no verification data) + latest reviews → `{ doctor, reviews }`

### GET /api/doctors/:id/slots
Query: `date?` (default next 7 days)
→ `{ weekly: [...availability], days: [{ date, weekday, slots: [{ start, end, status: available|booked|break|past }] }] }`

### PUT /api/doctors/:id/availability *(doctor, own)*
`{ rows: [{ weekday 0-6, enabled, start "HH:MM", end, slotMinutes, breakStart?, breakEnd? }] }`
Replaces the weekly schedule; booked appointments are unaffected.

### GET|POST /api/doctors/:id/unavailable *(doctor, own)* ; DELETE `/:id/unavailable/:date`
Leave dates — slots on those days disappear.

---

## Appointments

### POST /api/appointments *(patient)*
`{ doctorId, date, time "HH:MM", consultationType: IN_PERSON|VIDEO, reason? }`
→ `201 { id, status: "PENDING", message }` — validates the slot is still open (409 otherwise); creates `video_consultations` row for VIDEO.

### GET /api/appointments *(role-aware: patient → own, doctor → own, admin → all)*
Query: `status, type` → `{ appointments }` with joined names/statuses.

### POST /api/appointments/:id/accept *(doctor)* → confirms + notifies patient.
### POST /api/appointments/:id/reject *(doctor)* `{ reason? }` → notifies patient.
### POST /api/appointments/:id/cancel *(patient or doctor, own)* → PENDING/CONFIRMED only.
### POST /api/appointments/:id/complete *(doctor)* → unlocks review.
### POST /api/appointments/:id/review *(patient)* `{ rating 1-5, comment? }` — one per appointment; recalculates doctor average.
### GET /api/appointments/:id/review *(patient)* → existing review.

---

## Video consultations

### POST /api/video/request *(patient)*
`{ doctorId, date, time, reason? }` → `201` — creates PENDING video appointment. Patients can never start calls (403 on start).

### POST /api/video/accept *(doctor)* `{ appointmentId }` → CONFIRMED + private `room_id`.
### POST /api/video/reject *(doctor)* `{ appointmentId }` → REJECTED + notify.
### GET /api/video/mine *(patient/doctor)* → role-aware list.
### GET /api/video/room/:appointmentId *(participant)*
Doctor: allowed 15 min before → 30 min after. Patient: only when CONFIRMED and 10 min before → 15 min after; otherwise **423** with a friendly message.
→ `{ roomId, token (signed, short-lived), role, appointment, otherParty, videoStatus }`

### POST /api/video/:appointmentId/start *(doctor only)* → IN_PROGRESS + notify patient.
### POST /api/video/:appointmentId/end *(doctor only)* → ENDED + appointment COMPLETED.
### GET /api/video/monitor *(admin)* → all consultations.

**Signaling (Socket.IO, path `/socket.io`)** — connect with `auth: { token: <JWT> }`; then
`join-room { roomId, token }` (ack `{ok}`) → `peer-joined`; relay `signal { roomId, data }` (offer/answer/ICE) → `signal { from, data }`; `chat { roomId, text }` → `chat { from, text, at }`; `leave-room`; auto `peer-left` on disconnect.

---

## Hospitals

### GET /api/hospitals — `q, city, specialty, emergency=true, minRating`
### GET /api/hospitals/nearby — `lat & lng` (haversine) or `city`
### GET /api/hospitals/top-rated — rating → reviews → specialty coverage (max 12)
### GET /api/hospitals/:id — detail + approved doctors

Ratings carry `rating_source: "APP" | "GOOGLE"` — the UI labels them honestly; nothing is fabricated.

---

## DocBot chat

### POST /api/chat *(any logged-in role; UI is patient-facing)*
`{ "message": "I have a sore throat and ear pain" }`
→ `{ reply, suggestedSpecialty, emergency, quickReplies, actionButtons: [{ label, action, payload }] }`
Actions: `show_specialty` (deep-link to filtered doctor list), `call_emergency` (tel: dial + log), `emergency_help` (in-app emergency page).
Emergencies also create an `emergency_requests` row + notification. GET `/api/chat` returns history; DELETE clears it.

---

## Notifications

### GET /api/notifications → `{ notifications, unread }`
### GET /api/notifications/stream *(SSE keep-alive bridge for the bell)*
### POST /api/notifications `{ id? }` — mark one/all read.

Created automatically for: appointment requested/confirmed/rejected/cancelled/completed, video confirmed/starting/reminders (30 & 10 min), doctor approval/rejection/info-request, DocBot emergency detection, admin emergency alerts.

---

## Emergency

### GET /api/emergency/number *(public)* → `{ number, message, notice }`
### POST /api/emergency *(any role)*
`{ kind: CALL_LOG|HELP_REQUEST, message?, phoneUsed?, lat?, lng? }` → `201` + admin alerts.
### GET /api/emergency/mine *(any role)* → own history.

---

## Admin *(all require admin role)*

| Method & path | Purpose |
|---|---|
| GET `/api/admin/stats` | Dashboard counters |
| GET `/api/admin/doctors?status=` | Verification queue / directory |
| GET `/api/admin/doctors/:id/documents` | Metadata (+ authenticated URLs) |
| GET `/api/admin/documents/:storedName` | **Authenticated document stream** (never public) |
| POST `/api/admin/doctors/:id/approve` `{ doctorCode? }` | Assigns unique `DOC####` (409 on duplicate) |
| POST `/api/admin/doctors/:id/reject` `{ reason? }` | Reject |
| POST `/api/admin/doctors/:id/request-info` `{ note? }` | Request additional info |
| POST `/api/admin/doctors/:id/suspend` / `reactivate` | Block/restore login |
| GET `/api/admin/patients` | Accounts + appointment counts |
| POST `/api/admin/patients/:id/suspend` / `reactivate` | Moderate patients |
| GET|POST `/api/admin/hospitals`, PUT|DELETE `/api/admin/hospitals/:id` | Hospital CRUD |
| GET `/api/admin/appointments?status=` | Monitor all appointments |
| GET `/api/admin/emergency` | Emergency log |
| POST `/api/admin/emergency/:id/resolve` `{ status: RESOLVED|FALSE_ALARM }` | Triage |
| GET|PUT `/api/admin/settings` | Emergency number, slot duration, reminder toggles |
| GET `/api/admin/reports` | Status/specialty breakdown, top doctors |

---

## Health

### GET /api/health *(public)* → `{ ok, db: "pglite"|"pg", emergencyNumber, time }`
