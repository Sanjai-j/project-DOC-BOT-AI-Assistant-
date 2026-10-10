/**
 * E2E API smoke test — exercises every major workflow against a running server.
 * Run: npx tsx src/scripts/e2e.ts  (server must be on localhost:4000)
 */
const BASE = process.env.API_BASE ?? 'http://localhost:4000';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    console.log(`  ✔ ${name}`);
  } else {
    failures++;
    console.error(`  ✘ ${name}`, extra ?? '');
  }
}

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* stream endpoints */
  }
  return { status: res.status, json };
}

async function main() {
  console.log('— health —');
  const health = await api('GET', '/api/health');
  check('health ok', health.status === 200 && health.json?.ok === true, health);

  console.log('— patient login —');
  const login = await api('POST', '/api/auth/patient/login', {
    identifier: 'patient@docbot.dev',
    password: 'patient123',
  });
  check('patient login', login.status === 200 && login.json?.token, login.json);
  const pToken = login.json.token;

  console.log('— docbot —');
  const chat1 = await api('POST', '/api/chat', { message: 'I have a sore throat, blocked nose and ear pain' }, pToken);
  check('ENT suggestion', chat1.json?.suggestedSpecialty === 'ENT', chat1.json);
  const reply = chat1.json?.reply ?? '';
  check(
    'no diagnosis claim',
    /not a diagnosis|guidance/i.test(reply) && !/you have an? (infection|disease|flu)|you are diagnosed/i.test(reply),
    reply.slice(0, 80)
  );
  const chat2 = await api('POST', '/api/chat', { message: 'I have severe chest pain and difficulty breathing' }, pToken);
  check('emergency detected', chat2.json?.emergency === true, chat2.json);
  check('emergency buttons', (chat2.json?.actionButtons ?? []).some((b: any) => b.action === 'call_emergency'));

  console.log('— doctor discovery —');
  const docs = await api('GET', '/api/doctors?specialty=ENT');
  check('ENT doctors listed', docs.status === 200 && (docs.json?.doctors?.length ?? 0) >= 1);
  // Book with the first listed ENT; the doctor login below uses the SAME
  // doctor's code + name (directory doctors share the demo password).
  const entDoctor = docs.json.doctors[0];
  const nearby = await api('GET', '/api/doctors/nearby?lat=12.97&lng=77.64');
  check('nearby sorted with distance', nearby.json?.doctors?.[0]?.distance_km !== undefined, nearby.json?.mode);

  console.log('— slots —');
  const slots = await api('GET', `/api/doctors/${entDoctor.id}/slots`);
  check('7 days of slots', (slots.json?.days?.length ?? 0) === 7);
  const openDay = slots.json.days.find((d: any) => d.slots.some((s: any) => s.status === 'available'));
  const openSlot = openDay?.slots.find((s: any) => s.status === 'available');

  console.log('— appointment booking (video) —');
  const book = await api(
    'POST',
    '/api/video/request',
    { doctorId: entDoctor.id, date: openDay.date, time: openSlot.start, reason: 'ear pain follow-up' },
    pToken
  );
  check('video request created PENDING', book.status === 201 && book.json?.status === 'PENDING', book.json);

  console.log('— patient cannot start call —');
  const patientStart = await api('POST', `/api/video/${book.json.id}/start`, {}, pToken);
  check('patient start forbidden', patientStart.status === 403, patientStart.status);

  console.log('— doctor accepts —');
  const dlogin = await api('POST', '/api/auth/doctor/login', {
    fullName: entDoctor.full_name,
    doctorCode: entDoctor.doctor_code,
    password: 'doctor123',
  });
  check('doctor login (name + ID + password)', dlogin.status === 200 && dlogin.json?.user?.doctorCode === entDoctor.doctor_code, dlogin.json);
  const badNameLogin = await api('POST', '/api/auth/doctor/login', {
    fullName: 'Wrong Name',
    doctorCode: entDoctor.doctor_code,
    password: 'doctor123',
  });
  check('mismatched name rejected', badNameLogin.status === 401, badNameLogin.status);
  const dToken = dlogin.json.token;
  const accept = await api('POST', '/api/video/accept', { appointmentId: book.json.id }, dToken);
  check('doctor confirms video', accept.status === 200, accept.json);

  console.log('— patient join window enforced —');
  const patientRoom = await api('GET', `/api/video/room/${book.json.id}`, undefined, pToken);
  check('patient join gated by time window', patientRoom.status === 423, patientRoom.status);
  const doctorRoom = await api('GET', `/api/video/room/${book.json.id}`, undefined, dToken);
  check('doctor room access within window or 423', [200, 423].includes(doctorRoom.status), doctorRoom.status);

  console.log('— notifications —');
  const notifs = await api('GET', '/api/notifications', undefined, pToken);
  check('patient has notifications', (notifs.json?.notifications?.length ?? 0) >= 1);

  console.log('— emergency log —');
  const em = await api('POST', '/api/emergency', { kind: 'CALL_LOG' }, pToken);
  check('emergency call logged', em.status === 201, em.json);
  const num = await api('GET', '/api/emergency/number');
  check('emergency number configured', typeof num.json?.number === 'string' && num.json.number.length >= 3);

  console.log('— hospitals —');
  const hosp = await api('GET', '/api/hospitals/nearby?lat=12.97&lng=77.64');
  check('nearby hospitals', (hosp.json?.hospitals?.length ?? 0) >= 1);
  const top = await api('GET', '/api/hospitals/top-rated');
  check('top-rated hospitals', (top.json?.hospitals?.length ?? 0) >= 1);

  console.log('— admin —');
  // Register a fresh pending doctor so this suite is idempotent.
  const stamp = Date.now();
  const fd = new FormData();
  fd.append('fullName', 'E2E Test Doctor');
  fd.append('doctorIdNumber', `REG-${stamp}`);
  fd.append('hospitalName', 'E2E General Hospital');
  fd.append('hospitalAddress', '1 Test Lane, Bengaluru');
  fd.append('yearsExperience', '5');
  fd.append('specialization', 'Dentist');
  fd.append('email', `e2e.doctor.${stamp}@docbot.dev`);
  fd.append('phone', `+9199${String(stamp).slice(-8)}`);
  fd.append('password', 'doctor123');
  fd.append('availableDays', '1');
  fd.append('availableHours', '09:00-12:00');
  fd.append('idDocument', new Blob([Buffer.from('demo medical certificate')], { type: 'image/png' }), 'id.png');
  const reg = await fetch(`${BASE}/api/doctors/register`, { method: 'POST', body: fd });
  const regJson = await reg.json().catch(() => ({}));
  check('doctor registration → PENDING', reg.status === 201, regJson);

  // First-time login must be blocked until the admin approves, and the status
  // checker must report PENDING before approval and the DOC code after it.
  const regEmail = `e2e.doctor.${stamp}@docbot.dev`;
  const pendingStatus = await api('POST', '/api/auth/doctor/status', {
    email: regEmail,
    password: 'doctor123',
  });
  check('first-time status check → PENDING', pendingStatus.status === 200 && pendingStatus.json?.status === 'PENDING', pendingStatus.json);

  const alogin = await api('POST', '/api/auth/admin/login', {
    email: 'admin@docbot.dev',
    password: 'ChangeMe!123',
  });
  check('admin login', alogin.status === 200 && alogin.json?.token, alogin.json);
  const aToken = alogin.json.token;
  const stats = await api('GET', '/api/admin/stats', undefined, aToken);
  check('admin stats', stats.json?.stats?.pendingDoctors >= 1 && stats.json?.stats?.patients >= 1, stats.json);

  const pending = await api('GET', '/api/admin/doctors?status=PENDING', undefined, aToken);
  const pendingDoc = pending.json?.doctors?.[0];
  check('pending doctor listed', Boolean(pendingDoc), pending.json);
  if (pendingDoc) {
    const approve = await api('POST', `/api/admin/doctors/${pendingDoc.id}/approve`, {}, aToken);
    check('approve assigns DOC code', approve.status === 200 && /^DOC\d+$/.test(approve.json?.doctorCode ?? ''), approve.json);
    const newCode = approve.json.doctorCode;
    const approvedStatus = await api('POST', '/api/auth/doctor/status', {
      email: regEmail,
      password: 'doctor123',
    });
    check('status check after approval → DOC code',
      approvedStatus.status === 200 && approvedStatus.json?.status === 'APPROVED' && approvedStatus.json?.doctorCode === newCode,
      approvedStatus.json);

    const newDocLogin = await api('POST', '/api/auth/doctor/login', {
      fullName: 'E2E Test Doctor',
      doctorCode: newCode,
      password: 'doctor123',
    });
    check('approved doctor can now log in', newDocLogin.status === 200, newDocLogin.json);
  }

  const forbidden = await api('GET', '/api/admin/stats', undefined, pToken);
  check('patient blocked from admin routes', forbidden.status === 403, forbidden.status);

  console.log(failures === 0 ? '\nALL E2E CHECKS PASSED ✅' : `\n${failures} E2E CHECKS FAILED ❌`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
