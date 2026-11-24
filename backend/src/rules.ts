/** Pure business rules. No database, no HTTP: easy to test. Mirrors frontend/src/lib/actions.ts and cycles.ts. */

export const MIN_NOTE_LENGTH = 5;
export const MIN_PASSWORD_LENGTH = 10;

export type AppRole = "staff" | "manager" | "ceo" | "client" | "admin";
export const APP_ROLES: readonly AppRole[] = ["staff", "manager", "ceo", "client", "admin"];

/** Everyone except the client logs time on the client's projects. */
export const canLogTime = (role: AppRole) => role !== "client";

/** Only managers and the CEO approve hours. Admins manage people and settings, not hours. */
export const canApprove = (role: AppRole) => role === "manager" || role === "ceo";

/** Managers, the CEO and admins see every entry. */
export const seesEverything = (role: AppRole) => role !== "staff" && role !== "client";

export const isAdmin = (role: AppRole) => role === "admin";

/** Management (managers, the CEO and admins) can log time for other people and add hours to a cycle. */
/** Managers, the CEO and admins add people. A manager or CEO can only create these kinds of account; an admin can create any. */
export const canAddPeople = seesEverything;
export const MANAGER_ASSIGNABLE_ROLES = ["staff", "client"] as const;

export const canLogForOthers = seesEverything;
export const canExtendHours = seesEverything;

/** Proof links become anchors in the UI, so only web links are allowed. */
export function isSafeUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export interface RuleError {
  message: string;
  field?: string;
}

export function validateNote(note: string): RuleError | null {
  return note.trim().length >= MIN_NOTE_LENGTH ? null : { message: "Write a short note on what you did.", field: "note" };
}

export function validateProof(proof: string): RuleError | null {
  return !proof || isSafeUrl(proof) ? null : { message: "The proof link must start with http:// or https://.", field: "proof" };
}

export function validatePassword(password: string): RuleError | null {
  return password.length >= MIN_PASSWORD_LENGTH
    ? null
    : { message: `Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`, field: "password" };
}

export function validateManualTimes(start: Date, end: Date, now: Date): RuleError | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { message: "Fill in the date, start and end time.", field: "start" };
  if (end <= start) return { message: "The end time must be after the start time.", field: "end" };
  // One minute of slack for clock drift between the phone and the server.
  if (end.getTime() > now.getTime() + 60_000) return { message: "You cannot log time in the future.", field: "end" };
  return null;
}

export const minutesBetween = (start: Date, end: Date) => Math.round((end.getTime() - start.getTime()) / 60000);

export interface TimerState {
  startedAt: Date;
  accMs: number;
  running: boolean;
}

export const elapsedMs = (t: TimerState, now: Date) => t.accMs + (t.running ? now.getTime() - t.startedAt.getTime() : 0);

// ---------- Cycles (worked out in the client's time zone, so a late-night entry lands in the right cycle) ----------

const DAY_MS = 86_400_000;

/** Whole days since 1970-01-01 of the calendar date `instant` falls on in `timeZone`. */
export function localDayNumber(instant: Date, timeZone: string): number {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
  return Math.floor(Date.parse(`${ymd}T00:00:00Z`) / DAY_MS);
}

export const dayNumberOfYmd = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / DAY_MS);

export const ymdOfDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export interface CycleSettings {
  cycleAnchor: string;
  cycleDays: number;
  timezone: string;
}

export function cycleIndexAt(s: CycleSettings, instant: Date): number {
  return Math.floor((localDayNumber(instant, s.timezone) - dayNumberOfYmd(s.cycleAnchor)) / s.cycleDays);
}

/** First calendar day (YYYY-MM-DD) of cycle `i`. */
export function cycleStartYmd(s: CycleSettings, i: number): string {
  return ymdOfDayNumber(dayNumberOfYmd(s.cycleAnchor) + i * s.cycleDays);
}

export type AlertThreshold = 80 | 100;

/** Which thresholds the approved minutes have reached. */
export function thresholdsReached(approvedMinutes: number, budgetHours: number): AlertThreshold[] {
  const pct = (approvedMinutes / (budgetHours * 60)) * 100;
  const out: AlertThreshold[] = [];
  if (pct >= 80) out.push(80);
  if (pct >= 100) out.push(100);
  return out;
}

// ---------- Sign-in attempts ----------

/**
 * Locks an account for a while after repeated wrong passwords. The per-IP rate limit in the
 * auth routes does not help when guesses come from many addresses, so the count is kept per
 * account as well. The steps are deliberately short: this is to slow guessing down, not to
 * let someone lock a colleague out by guessing badly on purpose.
 */
const LOCK_STEPS: ReadonlyArray<{ after: number; minutes: number }> = [
  { after: 10, minutes: 60 },
  { after: 8, minutes: 15 },
  { after: 5, minutes: 5 },
];

export const isLocked = (lockedUntil: Date | null, now: Date) => !!lockedUntil && lockedUntil > now;

export function lockMinutesLeft(lockedUntil: Date | null, now: Date): number {
  if (!isLocked(lockedUntil, now)) return 0;
  return Math.max(1, Math.ceil((lockedUntil!.getTime() - now.getTime()) / 60_000));
}

/** The counter and lock to store after one failed sign-in. */
export function afterFailedLogin(failedLogins: number, now: Date): { failedLogins: number; lockedUntil: Date | null } {
  const next = failedLogins + 1;
  const step = LOCK_STEPS.find((s) => next >= s.after);
  return { failedLogins: next, lockedUntil: step ? new Date(now.getTime() + step.minutes * 60_000) : null };
}
