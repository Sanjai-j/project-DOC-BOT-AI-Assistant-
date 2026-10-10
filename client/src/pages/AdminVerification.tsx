import { useCallback, useEffect, useState } from 'react';
import { api, getToken } from '../lib/api';
import { Spinner, EmptyState, ErrorBox, OkBox, StatusBadge, Modal } from '../components/ui';

interface DocRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  specialization: string;
  qualifications: string | null;
  experience_years: number;
  hospital_name: string;
  hospital_address: string;
  doctor_code: string;
  status: string;
  id_docs: number;
}

interface DocFile {
  id: string;
  doc_type: string;
  file_name: string;
  mime_type: string;
  url: string;
}

export default function AdminVerification() {
  const [rows, setRows] = useState<DocRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocFile[] | null>(null);
  const [docsFor, setDocsFor] = useState<DocRow | null>(null);
  const [rejectFor, setRejectFor] = useState<DocRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [infoFor, setInfoFor] = useState<DocRow | null>(null);
  const [infoNote, setInfoNote] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [approving, setApproving] = useState<DocRow | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ doctors: DocRow[] }>('/api/admin/doctors?status=PENDING').catch(() => ({ doctors: [] }));
    setRows(r.doctors);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function viewDocuments(d: DocRow) {
    api<{ documents: DocFile[] }>(`/api/admin/doctors/${d.id}/documents`)
      .then((r) => {
        setDocs(r.documents);
        setDocsFor(d);
      })
      .catch((e) => setError(e.message));
  }

  async function approve() {
    if (!approving) return;
    try {
      const res = await api<{ doctorCode: string }>(`/api/admin/doctors/${approving.id}/approve`, {
        method: 'POST',
        body: customCode ? { doctorCode: customCode } : {},
      });
      setOk(`Approved! Doctor ID assigned: ${res.doctorCode}. The doctor can now log in.`);
      setApproving(null);
      setCustomCode('');
    } catch (e: any) {
      setError(e.message);
    }
    load();
  }

  async function reject() {
    if (!rejectFor) return;
    try {
      await api(`/api/admin/doctors/${rejectFor.id}/reject`, { method: 'POST', body: { reason: rejectReason } });
      setOk('Registration rejected. The doctor has been notified.');
      setRejectFor(null);
      setRejectReason('');
    } catch (e: any) {
      setError(e.message);
    }
    load();
  }

  async function requestInfo() {
    if (!infoFor) return;
    try {
      await api(`/api/admin/doctors/${infoFor.id}/request-info`, { method: 'POST', body: { note: infoNote } });
      setOk('Additional information requested. The doctor has been notified.');
      setInfoFor(null);
      setInfoNote('');
    } catch (e: any) {
      setError(e.message);
    }
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">Doctor verification</h1>
        <p className="text-sm text-slate-500">
          Review each applicant's medical ID before approval. Only approved doctors can log in.
        </p>
      </div>

      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      {rows === null ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="check" title="Verification queue is empty" hint="New doctor registrations will appear here." />
      ) : (
        <div className="space-y-4">
          {rows.map((d) => (
            <div key={d.id} className="card p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
                <div className="grid flex-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
                  <div><span className="text-slate-400">Name:</span> <b>{d.full_name}</b></div>
                  <div><span className="text-slate-400">Specialization:</span> {d.specialization}</div>
                  <div><span className="text-slate-400">Medical reg. no.:</span> {d.doctor_code}</div>
                  <div><span className="text-slate-400">Experience:</span> {d.experience_years} years</div>
                  <div><span className="text-slate-400">Hospital:</span> {d.hospital_name}</div>
                  <div><span className="text-slate-400">Address:</span> {d.hospital_address}</div>
                  <div><span className="text-slate-400">Email:</span> {d.email}</div>
                  <div><span className="text-slate-400">Phone:</span> {d.phone}</div>
                  {d.qualifications && <div className="sm:col-span-2"><span className="text-slate-400">Qualifications:</span> {d.qualifications}</div>}
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                <button className="btn-outline !py-2 !text-xs" onClick={() => viewDocuments(d)}>
                  View ID document {d.id_docs > 0 ? '' : '(missing)'}
                </button>
                <button className="btn-success !py-2 !text-xs" onClick={() => setApproving(d)}>Approve</button>
                <button className="btn-danger !py-2 !text-xs" onClick={() => setRejectFor(d)}>Reject</button>
                <button className="btn-outline !py-2 !text-xs" onClick={() => setInfoFor(d)}>✉ Request additional info</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Document viewer — authenticated stream, never public */}
      <Modal open={Boolean(docsFor)} title={`Documents — ${docsFor?.full_name ?? ''}`} onClose={() => setDocsFor(null)}>
        {docs === null ? (
          <p>Loading…</p>
        ) : docs.length === 0 ? (
          <p>No documents were uploaded.</p>
        ) : (
          <div className="space-y-3">
            {docs.map((f) => (
              <div key={f.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{f.doc_type === 'MEDICAL_ID' ? 'Medical ID' : 'Profile photo'} — {f.file_name}</span>
                  <a className="btn-outline !py-1.5 !text-xs" href={f.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
                {f.mime_type.startsWith('image/') && (
                  <img src={f.url} alt={f.file_name} className="mt-2 max-h-48 rounded-lg" />
                )}
              </div>
            ))}
            <p className="text-xs text-slate-400">
              Documents stream through an admin-only authenticated endpoint and are never publicly accessible.
            </p>
          </div>
        )}
      </Modal>

      {/* Approve dialog with optional custom code */}
      {approving && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Approve Dr. {approving.full_name}?</h3>
            <p className="mt-1 text-sm text-slate-600">
              A unique Doctor ID (e.g. DOC1001) will be assigned automatically{customCode ? '' : ', or set one below'}.
            </p>
            <input
              className="input mt-3 uppercase"
              placeholder="Custom Doctor ID (optional)"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setApproving(null)}>Cancel</button>
              <button className="btn-success" onClick={approve}>Approve & assign ID</button>
            </div>
          </div>
        </div>
      )}

      {/* Reject dialog */}
      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Reject Dr. {rejectFor.full_name}?</h3>
            <textarea
              className="input mt-3"
              rows={2}
              placeholder="Reason (shared with the doctor)…"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setRejectFor(null)}>Cancel</button>
              <button className="btn-danger" onClick={reject}>Reject registration</button>
            </div>
          </div>
        </div>
      )}

      {/* Request info dialog */}
      {infoFor && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">Request additional information</h3>
            <textarea
              className="input mt-3"
              rows={2}
              placeholder="What do you need from Dr. … ?"
              value={infoNote}
              onChange={(e) => setInfoNote(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-outline" onClick={() => setInfoFor(null)}>Cancel</button>
              <button className="btn-primary" onClick={requestInfo}>Send request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
