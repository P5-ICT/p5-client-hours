import { entriesInRange, cycleRange } from "./cycles";
import { fmtH, hm, ymd } from "./dates";
import type { AppData, CycleRange } from "./types";

/** The column headings of the work log, shared by the CSV and the Excel file. */
export const WORK_LOG_HEAD = ["Date", "Start", "End", "Person", "Role", "Department", "Project", "Type of work", "Hours", "Note", "Logged by", "Approved by"];

/** One row per approved entry in the range, oldest first. Hours are written as a number. */
export function workLogRows(data: AppData, range: CycleRange): Array<Array<string | number>> {
  const staff = new Map(data.staff.map((p) => [p.id, p]));
  const depts = new Map(data.departments.map((d) => [d.id, d]));
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  return entriesInRange(data, range)
    .filter((e) => e.status === "approved")
    .reverse()
    .map((e) => {
      const p = staff.get(e.staffId);
      const st = new Date(e.start);
      const en = new Date(e.end);
      const typedBy = e.loggedById ? (staff.get(e.loggedById)?.name ?? "Removed person") : null;
      return [
        ymd(st),
        hm(st),
        hm(en),
        p?.name ?? "",
        p?.role ?? "",
        (p && depts.get(p.dept)?.name) ?? "",
        projects.get(e.projectId)?.name ?? "",
        e.task,
        Number(fmtH(e.minutes)),
        e.note,
        e.method === "timer" ? "Timer" : typedBy ? `Typed in by ${typedBy}` : "Typed in",
        (e.reviewerId && staff.get(e.reviewerId)?.name) || "Removed person",
      ];
    });
}

export function csvForRange(data: AppData, range: CycleRange): string {
  const rows: Array<Array<string | number>> = [WORK_LOG_HEAD, ...workLogRows(data, range)];
  return rows
    .map((r) => r.map((c) => String(c)).map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
}

export function csvFor(data: AppData, cycle: number): string {
  return csvForRange(data, cycleRange(data.settings, cycle));
}
