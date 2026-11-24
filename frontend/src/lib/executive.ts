import { extensionsFor } from "./cycles";
import { fmtH } from "./dates";
import { PERIOD_LABELS, cycleIndexOfPeriod, periodLabel, previousPeriod, summarizePeriod, type Period } from "./periods";
import type { AppData, Entry, Summary } from "./types";

export interface ReportSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: { head: string[]; rows: string[][] };
}

/** An executive report written from the approved work. Built with plain rules from the captured entries, no outside service. */
export interface ExecutiveReport {
  title: string;
  subtitle: string;
  headline: string;
  sections: ReportSection[];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (text: string, max = 140) => {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const stripEnd = (text: string) => text.replace(/[.\s]+$/, "");

/** The biggest distinct pieces of work in a set of entries, so the report can name what was done. */
function highlights(entries: Entry[], nameOf: (id: string) => string, limit: number): string[] {
  const groups = new Map<string, { entry: Entry; minutes: number }>();
  for (const e of entries) {
    const key = `${e.task}|${e.note.trim().toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.minutes += e.minutes;
    else groups.set(key, { entry: e, minutes: e.minutes });
  }
  return [...groups.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, limit)
    .map(({ entry, minutes }) => `${stripEnd(clip(entry.note))} (${entry.task}, ${nameOf(entry.staffId)}, ${fmtH(minutes)} h)`);
}

function headlineFor(data: AppData, p: Period, s: Summary, label: string): string {
  const people = Object.keys(s.byStaff).length;
  const projects = Object.keys(s.byProject).length;
  if (s.approved === 0) return `No approved work has been captured for ${label} yet.`;
  const spread = `across ${plural(projects, "project")} by ${plural(people, "person", "people")}`;
  if (p.kind === "cycle" && s.budget > 0) {
    if (s.approved > s.budget) {
      return `${fmtH(s.approved)} hours of work were delivered ${spread}. That is ${fmtH(s.approved - s.budget)} hours more than the ${fmtH(s.budget)} hours allocated for this cycle.`;
    }
    return `${fmtH(s.approved)} of the ${fmtH(s.budget)} hours allocated were used (${pct(s.approved, s.budget)}%), ${spread}. ${fmtH(s.remaining)} hours remain.`;
  }
  return `${fmtH(s.approved)} hours of approved work were delivered ${spread}.`;
}

export function buildExecutiveReport(data: AppData, p: Period, now: Date = new Date(), opts: { internal?: boolean } = {}): ExecutiveReport {
  const internal = opts.internal ?? true;
  const s = summarizePeriod(data, p, now);
  const prev = summarizePeriod(data, previousPeriod(p), now);
  const label = periodLabel(p.kind, s.range);
  const kindName = PERIOD_LABELS[p.kind].toLowerCase();
  const approved = s.list.filter((e) => e.status === "approved");
  const staff = new Map(data.staff.map((x) => [x.id, x]));
  const nameOf = (id: string) => staff.get(id)?.name ?? "Removed person";
  const cycleIndex = cycleIndexOfPeriod(data, p, now);

  const sections: ReportSection[] = [];

  if (s.approved === 0) {
    sections.push({ heading: "Nothing to report yet", paragraphs: ["Hours appear here once a manager has approved them."] });
  } else {
    // ---- By department, against each department's allocation when the period is a cycle ----
    const showAlloc = cycleIndex !== null && data.departments.some((d) => d.hours != null);
    const deptRows = data.departments
      .map((d) => ({ d, m: s.byDept[d.id] ?? 0 }))
      .filter((r) => r.m > 0 || (showAlloc && r.d.hours != null))
      .sort((a, b) => b.m - a.m);
    const over: string[] = [];
    sections.push({
      heading: "Where the hours went",
      table: {
        head: showAlloc ? ["Department", "Hours", "Share", "Allocated", "Used"] : ["Department", "Hours", "Share"],
        rows: deptRows.map(({ d, m }) => {
          const base = [d.name, fmtH(m), `${pct(m, s.approved)}%`];
          if (!showAlloc) return base;
          if (d.hours == null) return [...base, "–", "–"];
          if (m / 60 > d.hours) over.push(`${d.name} used ${fmtH(m)} of its ${fmtH(d.hours * 60)} allocated hours, which is ${fmtH(m - d.hours * 60)} hours over.`);
          return [...base, fmtH(d.hours * 60), `${pct(m, d.hours * 60)}%`];
        }),
      },
      bullets: over.length ? over : undefined,
    });

    // ---- By project, with the main pieces of work named ----
    const projects = data.projects
      .map((pr) => ({ pr, m: s.byProject[pr.id] ?? 0 }))
      .filter((r) => r.m > 0)
      .sort((a, b) => b.m - a.m);
    sections.push({
      heading: "Progress by project",
      bullets: projects.slice(0, 8).map(({ pr, m }) => {
        const rows = approved.filter((e) => e.projectId === pr.id);
        const people = new Set(rows.map((e) => e.staffId)).size;
        const named = highlights(rows, nameOf, 3);
        return `${pr.name}: ${fmtH(m)} h (${pct(m, s.approved)}%) by ${plural(people, "person", "people")}. Main work: ${named.join("; ")}.`;
      }),
      paragraphs: projects.length > 8 ? [`${projects.length - 8} smaller projects are in the work log.`] : undefined,
    });

    // ---- Type of work ----
    const byTask = new Map<string, number>();
    approved.forEach((e) => byTask.set(e.task, (byTask.get(e.task) ?? 0) + e.minutes));
    sections.push({
      heading: "Type of work",
      table: {
        head: ["Type of work", "Hours", "Share"],
        rows: [...byTask.entries()].sort((a, b) => b[1] - a[1]).map(([t, m]) => [t, fmtH(m), `${pct(m, s.approved)}%`]),
      },
    });

    // ---- People ----
    const top = Object.entries(s.byStaff).sort((a, b) => b[1] - a[1]).slice(0, 5);
    sections.push({
      heading: "Who did the work",
      bullets: top.map(([id, m]) => `${nameOf(id)} (${staff.get(id)?.role || "no role set"}): ${fmtH(m)} h, ${pct(m, s.approved)}%.`),
      paragraphs: Object.keys(s.byStaff).length > 5 ? [`${Object.keys(s.byStaff).length - 5} more ${Object.keys(s.byStaff).length - 5 === 1 ? "person" : "people"} contributed smaller amounts.`] : undefined,
    });
  }

  // ---- Compared with the period before ----
  if (s.approved > 0 || prev.approved > 0) {
    const diff = s.approved - prev.approved;
    sections.push({
      heading: `Compared with the last ${kindName}`,
      paragraphs: [
        prev.approved === 0
          ? `There was no approved work in the last ${kindName}, so there is nothing to compare with.`
          : `${fmtH(s.approved)} h this ${kindName}, against ${fmtH(prev.approved)} h in the last one. That is ${diff === 0 ? "the same" : `${fmtH(Math.abs(diff))} h ${diff > 0 ? "more" : "less"} (${pct(Math.abs(diff), prev.approved)}%)`}.`,
      ],
    });
  }

  // ---- Things management should know ----
  const notes: string[] = [];
  if (cycleIndex !== null) {
    for (const x of extensionsFor(data, cycleIndex)) notes.push(`Management added ${fmtH(x.hours * 60)} hours to this cycle: ${stripEnd(x.reason)}.`);
  }
  if (internal && s.pending > 0) {
    const n = s.list.filter((e) => e.status === "pending").length;
    notes.push(`${fmtH(s.pending)} hours (${plural(n, "entry", "entries")}) are still waiting for approval and are not counted above.`);
  }
  if (internal && s.rejected > 0) notes.push(`${fmtH(s.rejected)} hours were rejected and are not counted.`);
  const typed = approved.filter((e) => e.method === "manual").reduce((a, e) => a + e.minutes, 0);
  if (internal && s.approved > 0 && pct(typed, s.approved) >= 25) {
    notes.push(`${pct(typed, s.approved)}% of the approved hours were typed in rather than timed. A reminder to use the timer will make the record stronger.`);
  }
  if (notes.length) sections.push({ heading: "Worth knowing", bullets: notes });

  return {
    title: `Executive report: ${data.settings.clientName}`,
    subtitle: `${PERIOD_LABELS[p.kind]}: ${label}`,
    headline: headlineFor(data, p, s, label),
    sections,
  };
}

/** The same report as plain text, for pasting into an email or a document. */
export function reportToText(r: ExecutiveReport): string {
  const out: string[] = [r.title, r.subtitle, "", r.headline];
  for (const sec of r.sections) {
    out.push("", sec.heading.toUpperCase());
    sec.paragraphs?.forEach((t) => out.push(t));
    if (sec.table) {
      out.push(sec.table.head.join(" | "));
      sec.table.rows.forEach((row) => out.push(row.join(" | ")));
    }
    sec.bullets?.forEach((b) => out.push(`- ${b}`));
  }
  return out.join("\n");
}
