import { addDays, dayDiff, parseYMD, ymd } from "./dates";
import type { AppData, CycleRange, Entry, Extension, Settings, Staff, Summary } from "./types";

export const anchorOf = (s: Settings) => parseYMD(s.anchor);

export const cycleIndexOf = (s: Settings, d: Date) => Math.floor(dayDiff(anchorOf(s), d) / s.cycleDays);

export function cycleRange(s: Settings, i: number): CycleRange {
  const start = addDays(anchorOf(s), i * s.cycleDays);
  return { start, end: addDays(start, s.cycleDays) };
}

/** Extra hours management added to cycle `i`. */
export function extensionsFor(data: AppData, i: number): Extension[] {
  const start = ymd(cycleRange(data.settings, i).start);
  return (data.extensions ?? []).filter((x) => x.cycleStart === start);
}

/** Minutes available in cycle `i`: the usual hours plus anything management added. */
export function budgetMinutesFor(data: AppData, i: number): number {
  const extra = extensionsFor(data, i).reduce((a, x) => a + x.hours, 0);
  return Math.round((data.settings.budgetHours + extra) * 60);
}

/** Entries that start inside `range`, newest first. */
export function entriesInRange(data: AppData, r: CycleRange): Entry[] {
  return data.entries
    .filter((e) => {
      const t = new Date(e.start);
      return t >= r.start && t < r.end;
    })
    .sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
}

/** Entries that start inside cycle `i`, newest first. */
export const entriesIn = (data: AppData, i: number): Entry[] => entriesInRange(data, cycleRange(data.settings, i));

/**
 * Totals for any date range. `budget` is the minutes available in the range, or 0 when the range has no
 * allocation of its own (a week or a month can span two cycles, so only a cycle has hours to compare against).
 */
export function summarizeRange(data: AppData, range: CycleRange, budget: number): Summary {
  const list = entriesInRange(data, range);
  const s: Summary = {
    range,
    list,
    approved: 0,
    pending: 0,
    rejected: 0,
    byDept: {},
    byProject: {},
    byStaff: {},
    pendStaff: {},
    byDay: Array.from({ length: Math.max(1, dayDiff(range.start, range.end)) }, () => 0),
    budget,
    remaining: 0,
  };
  const staffById = new Map<string, Staff>(data.staff.map((p) => [p.id, p]));
  for (const e of list) {
    if (e.status === "approved") {
      s.approved += e.minutes;
      const dId = staffById.get(e.staffId)?.dept ?? "none";
      s.byDept[dId] = (s.byDept[dId] ?? 0) + e.minutes;
      s.byProject[e.projectId] = (s.byProject[e.projectId] ?? 0) + e.minutes;
      s.byStaff[e.staffId] = (s.byStaff[e.staffId] ?? 0) + e.minutes;
      const di = dayDiff(range.start, new Date(e.start));
      if (di >= 0 && di < s.byDay.length) s.byDay[di] += e.minutes / 60;
    } else if (e.status === "pending") {
      s.pending += e.minutes;
      s.pendStaff[e.staffId] = (s.pendStaff[e.staffId] ?? 0) + e.minutes;
    } else {
      s.rejected += e.minutes;
    }
  }
  s.remaining = s.budget - s.approved;
  return s;
}

export function summarize(data: AppData, i: number): Summary {
  return summarizeRange(data, cycleRange(data.settings, i), budgetMinutesFor(data, i));
}
