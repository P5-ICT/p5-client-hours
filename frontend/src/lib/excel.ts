import { WORK_LOG_HEAD, workLogRows } from "./csv";
import { fmtH } from "./dates";
import { buildExecutiveReport } from "./executive";
import { PERIOD_LABELS, cycleIndexOfPeriod, periodLabel, summarizePeriod, type Period } from "./periods";
import type { AppData } from "./types";

export type XlsxCell = { value: string | number | null; fontWeight?: "bold"; format?: string; wrap?: boolean };

/** One worksheet, described without any library so it can be tested and handed to the Excel writer later. */
export interface SheetModel {
  name: string;
  widths: number[];
  rows: XlsxCell[][];
}

const text = (value: string, bold = false): XlsxCell => ({ value, fontWeight: bold ? "bold" : undefined });
const hours = (minutes: number): XlsxCell => ({ value: Number(fmtH(minutes)), format: "0.0" });
const head = (labels: string[]): XlsxCell[] => labels.map((l) => text(l, true));

/** The workbook for a report: a summary, then hours by department, project and person, then the full work log. */
export function reportSheets(data: AppData, p: Period, now: Date = new Date()): SheetModel[] {
  const s = summarizePeriod(data, p, now);
  const label = periodLabel(p.kind, s.range);
  const cycleIndex = cycleIndexOfPeriod(data, p, now);
  const deptName = new Map(data.departments.map((d) => [d.id, d.name]));
  const projectName = new Map(data.projects.map((x) => [x.id, x.name]));
  const exec = buildExecutiveReport(data, p, now);

  const summary: XlsxCell[][] = [
    [text(data.settings.clientName, true)],
    [text(`${PERIOD_LABELS[p.kind]}: ${label}`)],
    [],
    [text("Hours used (approved)"), hours(s.approved)],
    [text("Awaiting approval"), hours(s.pending)],
  ];
  if (cycleIndex !== null) {
    summary.push([text("Hours allocated"), hours(s.budget)]);
    summary.push([text(s.remaining < 0 ? "Extra hours" : "Hours left"), hours(Math.abs(s.remaining))]);
  }
  summary.push([], [text("Summary", true)], [text(exec.headline)]);
  for (const sec of exec.sections) {
    summary.push([], [text(sec.heading, true)]);
    sec.paragraphs?.forEach((t) => summary.push([text(t)]));
    sec.bullets?.forEach((t) => summary.push([text(`• ${t}`)]));
    if (sec.table) {
      summary.push(head(sec.table.head));
      sec.table.rows.forEach((r) => summary.push(r.map((c) => text(c))));
    }
  }

  const byDept: XlsxCell[][] = [head(["Department", "Hours", "Share (%)", "Allocated hours"])];
  for (const d of data.departments) {
    const m = s.byDept[d.id] ?? 0;
    if (!m && d.hours == null) continue;
    byDept.push([text(d.name), hours(m), { value: s.approved ? Math.round((m / s.approved) * 100) : 0 }, cycleIndex !== null && d.hours != null ? { value: d.hours, format: "0.0" } : { value: null }]);
  }
  byDept.push([text("Total", true), hours(s.approved), { value: 100 }, { value: null }]);

  const byProject: XlsxCell[][] = [head(["Project", "Hours", "Share (%)"])];
  Object.entries(s.byProject)
    .sort((a, b) => b[1] - a[1])
    .forEach(([id, m]) => byProject.push([text(projectName.get(id) ?? "Removed project"), hours(m), { value: s.approved ? Math.round((m / s.approved) * 100) : 0 }]));
  byProject.push([text("Total", true), hours(s.approved), { value: 100 }]);

  const byPerson: XlsxCell[][] = [head(["Person", "Role", "Department", "Approved hours", "Pending hours"])];
  data.staff
    .filter((x) => s.byStaff[x.id] || s.pendStaff[x.id])
    .sort((a, b) => (s.byStaff[b.id] ?? 0) - (s.byStaff[a.id] ?? 0))
    .forEach((x) => byPerson.push([text(x.name), text(x.role), text(deptName.get(x.dept) ?? ""), hours(s.byStaff[x.id] ?? 0), hours(s.pendStaff[x.id] ?? 0)]));

  const log: XlsxCell[][] = [head(WORK_LOG_HEAD)];
  workLogRows(data, s.range).forEach((r) =>
    log.push(r.map((c, i) => (i === 8 ? { value: c as number, format: "0.0" } : { value: String(c), wrap: i === 9 }))),
  );
  log.push([...Array.from({ length: 7 }, () => ({ value: null }) as XlsxCell), text("Total", true), hours(s.approved)]);

  return [
    { name: "Summary", widths: [34, 14, 12, 14, 12], rows: summary },
    { name: "By department", widths: [26, 10, 12, 16], rows: byDept },
    { name: "By project", widths: [34, 10, 12], rows: byProject },
    { name: "By person", widths: [26, 26, 20, 16, 16], rows: byPerson },
    { name: "Work log", widths: [12, 8, 8, 22, 22, 18, 26, 16, 8, 60, 22, 18], rows: log },
  ];
}

export function reportFileName(data: AppData, p: Period, ext: "xlsx" | "csv", now: Date = new Date()): string {
  const { range } = summarizePeriod(data, p, now);
  const y = range.start;
  const stamp = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  return `hours-${p.kind}-${stamp}.${ext}`;
}
