import type { AppData, AppRole } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");

const TOKEN_KEY = "p5hours.token";

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Storage blocked: the person stays signed in until they close the tab.
    }
  },
};

/** An error from the server with a message that is safe to show, and the field to focus when there is one. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public field?: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = tokenStore.get();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Cannot reach the server. Check your internet connection and try again.", 0);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; field?: string };
  if (!res.ok) {
    if (res.status === 401 && auth && token) onUnauthorized?.();
    throw new ApiError(json.error ?? "Something went wrong. Try again.", res.status, json.field);
  }
  return json as T;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  jobTitle: string;
  departmentId: string | null;
  appRole: AppRole;
}

export interface Session {
  token: string;
  user: SessionUser;
}

export interface DataResponse {
  serverNow: number;
  me: SessionUser;
  data: AppData;
}

export interface InviteResult {
  link: string;
  emailed: boolean;
}

export interface ImportResult {
  people: number;
  projects: number;
  skipped: Array<{ name: string; reason: string }>;
  invites: Array<{ id: string; email: string; name: string; link: string; emailed: boolean }>;
}

export const api = {
  login: (email: string, password: string) => request<Session>("POST", "/api/auth/login", { email, password }, false),
  setPassword: (token: string, password: string) => request<Session>("POST", "/api/auth/set-password", { token, password }, false),
  forgot: (email: string) => request<{ ok: true }>("POST", "/api/auth/forgot", { email }, false),
  me: () => request<{ user: SessionUser }>("GET", "/api/auth/me"),
  // The server ends every older session, so it hands back a fresh token for this device.
  changePassword: (current: string, next: string) => request<{ ok: true; token: string }>("POST", "/api/auth/change-password", { current, next }),

  // `back` is how many cycles of entries to load, counting the current one.
  data: (back?: number) => request<DataResponse>("GET", back ? `/api/data?back=${back}` : "/api/data"),

  startTimer: (b: { projectId: string; task: string; note: string; proof: string }) => request("POST", "/api/timer", b),
  pauseTimer: () => request("POST", "/api/timer/pause"),
  resumeTimer: () => request("POST", "/api/timer/resume"),
  patchTimer: (b: { note?: string; proof?: string }) => request("PATCH", "/api/timer", b),
  discardTimer: () => request("DELETE", "/api/timer"),
  stopTimer: (b: { note: string; proof: string }) => request<{ id: string; minutes: number }>("POST", "/api/timer/stop", b),

  addManualEntry: (b: { staffId?: string; projectId: string; task: string; note: string; proof?: string; start: string; end: string; reason: string }) =>
    request<{ id: string; minutes: number }>("POST", "/api/entries", b),
  deleteEntry: (id: string) => request("DELETE", `/api/entries/${encodeURIComponent(id)}`),
  review: (id: string, status: "approved" | "rejected", note: string) =>
    request("POST", `/api/entries/${encodeURIComponent(id)}/review`, { status, note }),
  approveTimerEntries: () => request<{ count: number }>("POST", "/api/entries/approve-timer-entries"),

  saveSettings: (b: { clientName: string; budgetHours: number; cycleDays: number; minTimerMinutes?: number; anchor: string }) => request("PUT", "/api/admin/settings", b),
  addUser: (b: { name: string; email: string; jobTitle: string; departmentId: string | null; appRole: AppRole }) =>
    request<InviteResult & { id: string }>("POST", "/api/admin/users", b),
  // Managers and the CEO add staff and client accounts; only an administrator can add the other kinds.
  addPerson: (b: { name: string; email: string; jobTitle: string; departmentId: string | null; appRole: "staff" | "client" }) =>
    request<InviteResult & { id: string }>("POST", "/api/people", b),
  patchUser: (id: string, b: { name?: string; jobTitle?: string; departmentId?: string | null; appRole?: AppRole; active?: boolean }) =>
    request("PATCH", `/api/admin/users/${encodeURIComponent(id)}`, b),
  inviteUser: (id: string) => request<InviteResult>("POST", `/api/admin/users/${encodeURIComponent(id)}/invite`),
  addDepartment: (name: string) => request<{ id: string }>("POST", "/api/admin/departments", { name }),
  patchDepartment: (id: string, b: { name?: string; allocatedHours?: number | null }) => request("PATCH", `/api/admin/departments/${encodeURIComponent(id)}`, b),
  addExtension: (b: { cycleStart: string; hours: number; reason: string }) => request<{ id: string }>("POST", "/api/extensions", b),
  removeExtension: (id: string) => request("DELETE", `/api/extensions/${encodeURIComponent(id)}`),
  addProject: (name: string) => request<{ id: string }>("POST", "/api/admin/projects", { name }),
  patchProject: (id: string, b: { name?: string; active?: boolean }) => request("PATCH", `/api/admin/projects/${encodeURIComponent(id)}`, b),
  importTeam: (body: unknown) => request<ImportResult>("POST", "/api/admin/import", body),
};
