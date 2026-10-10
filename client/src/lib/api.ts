const TOKEN_KEY = 'docbot_token';
const USER_KEY = 'docbot_user';

export interface AuthUser {
  id: string;
  role: 'patient' | 'doctor' | 'admin';
  name: string;
  doctorCode?: string;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | false } = {}
): Promise<T> {
  const token = options.token === false ? null : options.token ?? getToken();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Network error — is the server running?');
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`);
  }
  return json as T;
}

/** Multipart upload (doctor registration). */
export async function apiForm(path: string, form: FormData): Promise<any> {
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', body: form });
  } catch {
    throw new ApiError(0, 'Network error — is the server running?');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`);
  return json;
}

export function isMapsConfigured(): boolean {
  return Boolean((window as any).GOOGLE_MAPS_API_KEY);
}
