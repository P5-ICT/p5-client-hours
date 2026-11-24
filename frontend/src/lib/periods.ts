import { budgetMinutesFor, cycleIndexOf, cycleRange, summarizeRange } from "./cycles";
import { addDays, fmtRange, sod } from "./dates";
import type { AppData, CycleRange, Summary } from "./types";

/** A report can cover a cycle, a calendar week (Monday to Sunday) or a calendar month. */
export type PeriodKind = "cycle" | "week" | "month";

export interface Period {
  kind: PeriodKind;
  /** 0 is the current one, -1 the one before, and so on. */
  offset: number;
}

export const PERIOD_LABELS: Record<PeriodKind, string> = { cycle: "Cycle", week: "Week", month: "Month" };

/** Monday of the week that holds `d`. */
function mondayOf(d: Date): Date {
  const x = sod(d);
  return addDays(x, -((x.getDay() + 6) % 7));
}

export function periodRange(data: AppData, p: Period, now: Date = new Date()): CycleRange {
  if (p.kind === "cycle") return cycleRange(data.settings, cycleIndexOf(data.settings, now) + p.offset);
  if (p.kind === "week") {
    const start = addDays(mondayOf(now), p.offset * 7);
    return { start, end: addDays(start, 7) };
  }
  const start = new Date(now.getFullYear(), now.getMonth() + p.offset, 1);
  return { start, end: new Date(start.getFullYear(), start.getMonth() + 1, 1) };
}

/** The cycle index when the period is a cycle, so its extra hours and allocations can be looked up. */
export const cycleIndexOfPeriod = (data: AppData, p: Period, now: Date = new Date()) =>
  p.kind === "cycle" ? cycleIndexOf(data.settings, now) + p.offset : null;

export function summarizePeriod(data: AppData, p: Period, now: Date = new Date()): Summary {
  const range = periodRange(data, p, now);
  const index = cycleIndexOfPeriod(data, p, now);
  return summarizeRange(data, range, index === null ? 0 : budgetMinutesFor(data, index));
}

export function periodLabel(kind: PeriodKind, range: CycleRange): string {
  if (kind === "month") return range.start.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  return fmtRange(range);
}

/** The period just before this one, for "compared with the last ..." lines. */
export const previousPeriod = (p: Period): Period => ({ kind: p.kind, offset: p.offset - 1 });

export function periodSubtitle(p: Period): string {
  if (p.offset === 0) return `Current ${PERIOD_LABELS[p.kind].toLowerCase()}`;
  if (p.offset === -1) return `Last ${PERIOD_LABELS[p.kind].toLowerCase()}`;
  return `${PERIOD_LABELS[p.kind]} ${-p.offset} back`;
}
