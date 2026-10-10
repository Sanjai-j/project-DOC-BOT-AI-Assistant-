import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { ReminderToaster } from '../lib/useReminders';

/* ── Minimal professional icon set (inline SVG, stroke style) ── */
const ICONS = {
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.8V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.8" />
    </>
  ),
  chat: <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M10 21v-4h4v4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="7" width="12" height="10" rx="2" />
      <path d="m15 10 6-3v10l-6-3" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 4.5 1.5 5.5 2 6H4c.5-.5 2-1.5 2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c1.6-3.8 4.7-5 7.5-5s5.9 1.2 7.5 5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1.3-3.5 4-4.5 6.5-4.5s5.2 1 6.5 4.5" />
      <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18.5 15.7c1.6.7 2.6 2 3 4.3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.5 20h19z" />
      <path d="M12 10v4M12 17.2h.01" />
    </>
  ),
  phone: (
    <path d="M5 3h4l1.8 4.5-2.3 1.6a13 13 0 0 0 6.4 6.4l1.6-2.3L21 15v4a2 2 0 0 1-2.2 2A17 17 0 0 1 3 5.2 2 2 0 0 1 5 3" />
  ),
  cross: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2" />
    </>
  ),
  check: <path d="m4 12.5 5 5L20 6.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  file: (
    <>
      <path d="M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8z" />
      <path d="M13 3v5h5" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7.5 9 6 9-6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-5.8-7-11a7 7 0 1 1 14 0c0 5.2-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  logout: (
    <>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m15 16 5-4-5-4M20 12H9" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="7" width="13" height="10" rx="2" />
      <path d="m16 10.5 5-3v9l-5-3" />
    </>
  ),
  inbox: (
    <>
      <path d="M6 4h12l2.5 8.5V20H3.5v-7.5z" />
      <path d="M3.5 12.5H9l1.5 2.5h3l1.5-2.5h5.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-500">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function ErrorBox({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>
  );
}

export function OkBox({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'badge-pending',
    CONFIRMED: 'badge-confirmed',
    REJECTED: 'badge-rejected',
    COMPLETED: 'badge-completed',
    CANCELLED: 'badge-cancelled',
    APPROVED: 'badge-confirmed',
    SUSPENDED: 'badge-cancelled',
    INFO_REQUESTED: 'badge-pending',
    REQUESTED: 'badge-pending',
    IN_PROGRESS: 'badge-confirmed',
    ENDED: 'badge-completed',
    OPEN: 'badge-pending',
    RESOLVED: 'badge-confirmed',
    FALSE_ALARM: 'badge-cancelled',
    EMERGENCY: 'badge-emergency',
  };
  return <span className={map[status] ?? 'badge bg-slate-100 text-slate-600'}>{status.replace('_', ' ')}</span>;
}

export function Stars({ value, size = 'text-base' }: { value: number; size?: string }) {
  const full = Math.round(value);
  return (
    <span className={`${size} tracking-tight text-amber-500`} aria-label={`${value} out of 5 stars`}>
      {'★★★★★'.slice(0, full)}
      <span className="text-slate-300">{'★★★★★'.slice(0, 5 - full)}</span>
    </span>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="mb-2 text-lg font-bold text-slate-900">{title}</h3>
        <div className="text-sm text-slate-600">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-outline" onClick={onCancel}>
            Cancel
          </button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: IconName; title: string; hint?: string }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Icon name={icon} className="h-6 w-6" />
        </span>
      )}
      <div className="font-semibold text-slate-700">{title}</div>
      {hint && <div className="text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = () =>
      api<{ unread: number }>('/api/notifications')
        .then((r) => active && setUnread(r.unread))
        .catch(() => {});
    load();
    const t = setInterval(load, 20000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [user]);

  if (!user) return null;
  const base =
    user.role === 'patient' ? '/patient/notifications' : user.role === 'doctor' ? '/doctor/notifications' : '/admin';
  return (
    <Link to={base} className="relative rounded-xl p-2 hover:bg-slate-100" title="Notifications">
      <Icon name="bell" className="h-5 w-5 text-slate-600" />
      {unread > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const PATIENT_NAV: NavItem[] = [
  { to: '/patient', label: 'Dashboard', icon: 'home' },
  { to: '/patient/docbot', label: 'DocBot', icon: 'chat' },
  { to: '/patient/find', label: 'Find Doctor', icon: 'search' },
  { to: '/patient/hospitals', label: 'Hospitals', icon: 'building' },
  { to: '/patient/appointments', label: 'Appointments', icon: 'calendar' },
  { to: '/patient/video', label: 'Video Consultations', icon: 'video' },
  { to: '/patient/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/patient/profile', label: 'Profile', icon: 'user' },
  { to: '/patient/emergency', label: 'Emergency', icon: 'alert' },
];

const DOCTOR_NAV: NavItem[] = [
  { to: '/doctor', label: 'Dashboard', icon: 'home' },
  { to: '/doctor/requests', label: 'Appointment Requests', icon: 'inbox' },
  { to: '/doctor/appointments', label: 'Appointments', icon: 'calendar' },
  { to: '/doctor/video', label: 'Video Consultations', icon: 'video' },
  { to: '/doctor/schedule', label: 'Schedule', icon: 'clock' },
  { to: '/doctor/patients', label: 'Patients', icon: 'users' },
  { to: '/doctor/notifications', label: 'Notifications', icon: 'bell' },
  { to: '/doctor/profile', label: 'Profile', icon: 'user' },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: 'home' },
  { to: '/admin/verification', label: 'Doctor Verification', icon: 'check' },
  { to: '/admin/doctors', label: 'Doctors', icon: 'cross' },
  { to: '/admin/patients', label: 'Patients', icon: 'users' },
  { to: '/admin/hospitals', label: 'Hospitals', icon: 'building' },
  { to: '/admin/appointments', label: 'Appointments', icon: 'calendar' },
  { to: '/admin/emergency', label: 'Emergency Requests', icon: 'alert' },
  { to: '/admin/settings', label: 'Settings', icon: 'settings' },
];

export function RoleLayout({ nav }: { nav: NavItem[] }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-slate-200 px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Icon name="cross" className="h-5 w-5" />
          </span>
          <span className="text-lg font-extrabold text-brand-700">DocBot TeleMed</span>
        </div>
        <nav className="space-y-1 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/patient' || item.to === '/doctor' || item.to === '/admin'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
                }`
              }
            >
              <Icon name={item.icon} className="h-4.5 w-4.5 h-[18px] w-[18px]" />
              {item.label}
              {item.label === 'Emergency' && (
                <span className="ml-auto rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">SOS</span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Icon name="menu" className="h-5 w-5 text-slate-600" />
            </button>
            <span className="hidden text-sm text-slate-500 sm:block">
              Welcome back, <b className="text-slate-700">{user?.name}</b>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            {user?.role === 'patient' && (
              <Link to="/patient/emergency" className="btn-danger !px-3 !py-1.5 !text-xs">
                SOS
              </Link>
            )}
            <button
              className="btn-outline !px-3 !py-1.5 !text-xs"
              onClick={() => {
                logout();
                navigate('/');
              }}
            >
              Logout
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
        <ReminderToaster />
        <footer className="border-t border-slate-200 px-8 py-4 text-center text-xs text-slate-400">
          DocBot TeleMed is a software platform, not a medical provider. AI guidance is not a medical diagnosis.
        </footer>
      </div>
    </div>
  );
}

export function PatientLayout() {
  return <RoleLayout nav={PATIENT_NAV} />;
}
export function DoctorLayout() {
  return <RoleLayout nav={DOCTOR_NAV} />;
}
export function AdminLayout() {
  return <RoleLayout nav={ADMIN_NAV} />;
}
