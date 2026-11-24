/** A section of the app (a group of screens). */
export type Role = "staff" | "manager" | "client";
/** What a signed-in person is allowed to do. Decided by the server. */
export type AppRole = "staff" | "manager" | "ceo" | "client" | "admin";
export type Status = "approved" | "pending" | "rejected";
export type Method = "timer" | "manual";

export interface Department {
  id: string;
  name: string;
  /** Index into the department colour palette. */
  c: number;
  /** Hours allocated to this department within each cycle, when the client's hours are split between departments. */
  hours?: number | null;
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  dept: string;
  active?: boolean;
  appRole?: AppRole;
  /** Only sent to admins. */
  email?: string;
  /** True until the person has chosen a password. Only sent to admins. */
  invited?: boolean;
}

export interface Project {
  id: string;
  name: string;
  active?: boolean;
}

export interface Entry {
  id: string;
  staffId: string;
  projectId: string;
  task: string;
  note: string;
  proof: string;
  /** ISO timestamps. */
  start: string;
  end: string;
  minutes: number;
  method: Method;
  reason: string;
  status: Status;
  reviewerId: string | null;
  reviewNote: string;
  reviewedAt: string | null;
  createdAt: string;
  /** Set when management typed the entry in for someone else. */
  loggedById?: string | null;
}

export interface Timer {
  projectId: string;
  task: string;
  note: string;
  proof: string;
  startedAt: number;
  accMs: number;
  running: boolean;
}

export interface Settings {
  clientName: string;
  budgetHours: number;
  cycleDays: number;
  /** First day of a cycle, YYYY-MM-DD. */
  anchor: string;
  /** A timer must have run at least this many minutes before it can be submitted. */
  minTimerMinutes?: number;
}

/** Extra hours management added to one cycle. */
export interface Extension {
  id: string;
  /** First day of the cycle, YYYY-MM-DD. */
  cycleStart: string;
  hours: number;
  reason: string;
  by: string;
  at: string;
}

export interface AppData {
  settings: Settings;
  departments: Department[];
  staff: Staff[];
  projects: Project[];
  tasks: string[];
  entries: Entry[];
  timers: Record<string, Timer>;
  extensions: Extension[];
}

export interface Prefs {
  staffId: string;
  managerId: string;
}

export interface CycleRange {
  start: Date;
  end: Date;
}

export interface Summary {
  range: CycleRange;
  list: Entry[];
  approved: number;
  pending: number;
  rejected: number;
  byDept: Record<string, number>;
  byProject: Record<string, number>;
  byStaff: Record<string, number>;
  pendStaff: Record<string, number>;
  byDay: number[];
  budget: number;
  remaining: number;
}
