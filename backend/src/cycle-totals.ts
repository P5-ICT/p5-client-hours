import type { Db } from "./db.js";
import { cycleStartYmd, dayNumberOfYmd, localDayNumber, type CycleSettings } from "./rules.js";

export interface CycleTotals {
  cycleStart: string;
  approvedMinutes: number;
  pendingMinutes: number;
  people: number;
  projects: number;
  entries: number;
}

interface Row {
  started_at: Date;
  minutes: number;
  status: string;
  staff_id: string;
  project_id: string;
}

/**
 * Adds up one cycle's hours. Entries are stored as instants, so the query over-fetches by a day
 * either side and then buckets by the client's own calendar day: a 01:00 SAST entry belongs to
 * that local day, not to the UTC day before it.
 */
export async function cycleTotals(db: Db, s: CycleSettings, cycleIndex: number): Promise<CycleTotals> {
  const cycleStart = cycleStartYmd(s, cycleIndex);
  const first = dayNumberOfYmd(cycleStart);
  const from = new Date((first - 1) * 86_400_000);
  const to = new Date((first + s.cycleDays + 1) * 86_400_000);

  const { rows } = await db.query<Row>(
    "select started_at, minutes, status, staff_id, project_id from entries where started_at >= $1 and started_at < $2",
    [from, to],
  );
  const inCycle = rows.filter((r) => {
    const d = localDayNumber(r.started_at, s.timezone);
    return d >= first && d < first + s.cycleDays;
  });
  const approved = inCycle.filter((r) => r.status === "approved");
  return {
    cycleStart,
    approvedMinutes: approved.reduce((a, r) => a + r.minutes, 0),
    pendingMinutes: inCycle.filter((r) => r.status === "pending").reduce((a, r) => a + r.minutes, 0),
    people: new Set(approved.map((r) => r.staff_id)).size,
    projects: new Set(approved.map((r) => r.project_id)).size,
    entries: approved.length,
  };
}
