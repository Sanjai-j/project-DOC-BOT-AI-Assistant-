/**
 * Registers a throwaway demo doctor so the first-time verification flow can be
 * walked through live. Usage: npx tsx src/scripts/register-demo-doctor.ts
 * (Run from the server directory. Data is fictional demo data.)
 */
const stamp = Date.now();

const fd = new FormData();
fd.append('fullName', 'Vikram Rao');
fd.append('doctorIdNumber', `REG-${stamp}`);
fd.append('hospitalName', 'City Care Hospital');
fd.append('hospitalAddress', '12 MG Road, Bengaluru');
fd.append('yearsExperience', '8');
fd.append('specialization', 'Cardiologist');
fd.append('email', `vikram.rao.${stamp}@docbot.dev`);
fd.append('phone', `+9199${String(stamp).slice(-8)}`);
fd.append('password', 'cardio123');
fd.append('availableDays', '1,3');
fd.append('availableHours', '10:00-14:00');
fd.append('idDocument', new Blob([Buffer.from('demo id')], { type: 'image/png' }), 'id.png');

const res = await fetch('http://localhost:4000/api/doctors/register', { method: 'POST', body: fd });
console.log(res.status, JSON.stringify(await res.json()));
console.log('registered email:', `vikram.rao.${stamp}@docbot.dev`);
