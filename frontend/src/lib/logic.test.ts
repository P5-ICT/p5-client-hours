import { describe, expect, it } from "vitest";
import { WORK_LOG_HEAD, csvFor } from "./csv";
import { toWriterSheets } from "./download";
import { reportFileName, reportSheets } from "./excel";
import { buildExecutiveReport, reportToText } from "./executive";
import { periodRange, summarizePeriod } from "./periods";
import {
  addEntry,
  approveTimerEntries,
  deleteEntry,
  isOverBudget,
  isSafeUrl,
  parseManualEntry,
  parseSettings,
  pauseTimer,
  resumeTimer,
  reviewEntry,
  startTimer,
  stopTimer,
} from "./actions";
import { cycleIndexOf, cycleRange, summarize, summarizeRange } from "./cycles";
import { fmtDur, fmtH, ymd } from "./dates";
import { sampleData } from "./test-data";

const NOW = new Date(2026, 9, 12, 14, 0, 0); // 12 Oct 2026, day 8 of the cycle starting 5 Oct

describe("formatting", () => {
  it("formats minutes as hours with one decimal", () => {
    expect(fmtH(90)).toBe("1.5");
    expect(fmtH(2700)).toBe("45.0");
  });
  it("formats durations", () => {
    expect(fmtDur(90)).toBe("1h 30m");
    expect(fmtDur(120)).toBe("2h");
    expect(fmtDur(0)).toBe("0m");
  });
});

describe("cycles", () => {
  const data = sampleData(NOW);
  it("finds the cycle a date belongs to", () => {
    expect(cycleIndexOf(data.settings, NOW)).toBe(0);
    expect(cycleIndexOf(data.settings, new Date(2026, 9, 4))).toBe(-1);
    expect(cycleRange(data.settings, 1).start.getDate()).toBe(19);
  });
  it("matches the demo story: last cycle is 7.5 h over the 45 hours allocated", () => {
    const last = summarize(data, -1);
    expect(last.approved).toBe(52.5 * 60);
    expect(last.approved - last.budget).toBe(7.5 * 60);
  });
  it("counts only approved time against the budget", () => {
    const cur = summarize(data, 0);
    expect(cur.pending).toBeGreaterThan(0);
    expect(cur.remaining).toBe(cur.budget - cur.approved);
    expect(cur.byDay.reduce((a, b) => a + b, 0) * 60).toBeCloseTo(cur.approved);
  });
});

describe("csv", () => {
  it("exports approved entries only, with a header row and quoted commas", () => {
    let data = sampleData(NOW);
    data = addEntry(data, {
      staffId: "sib",
      projectId: "web",
      task: "Development",
      note: 'Said "hi", then left',
      start: new Date(2026, 9, 12, 9),
      end: new Date(2026, 9, 12, 10),
      minutes: 60,
      method: "timer",
    });
    const id = data.entries[data.entries.length - 1].id;
    data = reviewEntry(data, id, "approved", "", "candice");
    const lines = csvFor(data, 0).split("\n");
    expect(lines[0]).toMatch(/^Date,Start,End,Person/);
    expect(csvFor(data, 0)).toContain('"Said ""hi"", then left"');
    expect(csvFor(data, -1)).not.toContain("Supplier admin"); // the rejected entry
  });
});

describe("entries and review", () => {
  it("adds entries as pending, deletes only pending ones", () => {
    let data = sampleData(NOW);
    data = addEntry(data, {
      staffId: "sib", projectId: "web", task: "Admin", note: "Filing", start: NOW, end: NOW, minutes: 30, method: "timer",
    });
    const added = data.entries[data.entries.length - 1];
    expect(added.status).toBe("pending");
    const approved = data.entries.find((e) => e.status === "approved")!;
    expect(deleteEntry(data, approved.id).entries).toHaveLength(data.entries.length);
    expect(deleteEntry(data, added.id).entries).toHaveLength(data.entries.length - 1);
  });
  it("approves all pending timer entries but leaves typed-in ones", () => {
    const data = sampleData(NOW);
    const pendingTimers = data.entries.filter((e) => e.status === "pending" && e.method === "timer").length;
    const r = approveTimerEntries(data, "candice");
    expect(r.count).toBe(pendingTimers);
    expect(r.data.entries.some((e) => e.status === "pending" && e.method === "manual")).toBe(true);
  });
});

describe("manual entry validation", () => {
  const ok = { date: "2026-10-12", start: "09:00", end: "10:30", projectId: "web", task: "Admin", note: "Wrote docs", reason: "Forgot" };
  it("accepts a valid entry", () => {
    const r = parseManualEntry(ok, NOW);
    expect(r.ok && r.minutes).toBe(90);
  });
  it.each([
    [{ end: "08:00" }, "m-end"],
    [{ end: "15:00" }, "m-end"],
    [{ note: "hi" }, "m-note"],
    [{ reason: " " }, "m-reason"],
    [{ date: "" }, "m-date"],
  ])("rejects %j", (patch, field) => {
    const r = parseManualEntry({ ...ok, ...patch }, NOW);
    expect(!r.ok && r.error.field).toBe(field);
  });
});

describe("timer", () => {
  const fields = { projectId: "web", task: "Development", note: "", proof: "" };
  it("accumulates elapsed time across pause and resume, then submits", () => {
    let data = startTimer(sampleData(NOW), "sib", fields, 0);
    data = pauseTimer(data, "sib", 20 * 60000);
    data = resumeTimer(data, "sib", 30 * 60000);
    const r = stopTimer(data, "sib", { note: "Built the page", proof: "" }, new Date(40 * 60000));
    expect(r.ok && r.minutes).toBe(30);
    expect(r.ok && r.data.timers.sib).toBeUndefined();
  });
  it("blocks a stop with a short note or under a minute", () => {
    const data = startTimer(sampleData(NOW), "sib", fields, 0);
    const shortNote = stopTimer(data, "sib", { note: "x", proof: "" }, new Date(10 * 60000));
    expect(!shortNote.ok && shortNote.error.field).toBe("t-note");
    const tooShort = stopTimer(data, "sib", { note: "Long enough", proof: "" }, new Date(10000));
    expect(tooShort.ok).toBe(false);
  });
});

describe("settings and team import", () => {
  it("validates settings", () => {
    const base = { clientName: "Acme", budgetHours: "45", cycleDays: "14", minTimerMinutes: "1", anchor: "2026-10-05" };
    expect(parseSettings(base).ok).toBe(true);
    expect(parseSettings({ ...base, budgetHours: "0" })).toMatchObject({ ok: false, error: { field: "s-hours" } });
    expect(parseSettings({ ...base, cycleDays: "99" })).toMatchObject({ ok: false, error: { field: "s-days" } });
  });
});

describe("proof links", () => {
  it("allows only http(s) links", () => {
    expect(isSafeUrl("https://github.com/org/repo/commit/1")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,hi")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });
  it("blocks stopping a timer with an unsafe proof link", () => {
    const data = startTimer(sampleData(NOW), "sib", { projectId: "web", task: "Admin", note: "", proof: "" }, 0);
    const r = stopTimer(data, "sib", { note: "Long enough", proof: "javascript:alert(1)" }, new Date(10 * 60000));
    expect(!r.ok && r.error.field).toBe("t-proof");
  });
});

describe("hours added by management", () => {
  it("raises the hours available in that cycle only", () => {
    const data = { ...sampleData(NOW), extensions: [{ id: "x1", cycleStart: "2026-10-05", hours: 10, reason: "Launch week", by: "candice", at: NOW.toISOString() }] };
    expect(summarize(data, 0).budget).toBe(55 * 60);
    expect(summarize(data, -1).budget).toBe(45 * 60);
    expect(summarize(data, 1).budget).toBe(45 * 60);
  });
  it("counts several extensions and tells isOverBudget about them", () => {
    const base = sampleData(NOW);
    const used = summarize(base, -1).approved + summarize(base, -1).pending;
    const prev = new Date(2026, 9, 1);
    expect(isOverBudget(base, prev)).toBe(used > 45 * 60);
    const extended = {
      ...base,
      extensions: [
        { id: "a", cycleStart: "2026-09-21", hours: 5, reason: "a", by: "x", at: "" },
        { id: "b", cycleStart: "2026-09-21", hours: 5, reason: "b", by: "x", at: "" },
      ],
    };
    expect(summarize(extended, -1).budget).toBe(55 * 60);
    expect(isOverBudget(extended, prev)).toBe(used > 55 * 60);
  });
});

describe("minimum timer length", () => {
  const fields = { projectId: "web", task: "Admin", note: "", proof: "" };
  it("blocks a timer that has not run long enough, and says how long it has to run", () => {
    const data = startTimer({ ...sampleData(NOW), settings: { ...sampleData(NOW).settings, minTimerMinutes: 15 } }, "sib", fields, 0);
    const early = stopTimer(data, "sib", { note: "Long enough", proof: "" }, new Date(10 * 60000));
    expect(!early.ok && early.error.message).toMatch(/at least 15 minutes/);
    expect(stopTimer(data, "sib", { note: "Long enough", proof: "" }, new Date(16 * 60000)).ok).toBe(true);
  });
  it("defaults to one minute", () => {
    const data = startTimer(sampleData(NOW), "sib", fields, 0);
    expect(stopTimer(data, "sib", { note: "Long enough", proof: "" }, new Date(2 * 60000)).ok).toBe(true);
  });
  it("validates the setting", () => {
    const base = { clientName: "Acme", budgetHours: "45", cycleDays: "14", minTimerMinutes: "15", anchor: "2026-10-05" };
    expect(parseSettings(base)).toMatchObject({ ok: true, values: { minTimerMinutes: 15 } });
    expect(parseSettings({ ...base, minTimerMinutes: "0" })).toMatchObject({ ok: false, error: { field: "s-min" } });
    expect(parseSettings({ ...base, minTimerMinutes: "500" })).toMatchObject({ ok: false, error: { field: "s-min" } });
  });
});

describe("weekly, monthly and cycle reports", () => {
  const data = sampleData(NOW); // Monday 12 Oct 2026 is inside the cycle that starts on 5 Oct

  it("runs a week from Monday to Sunday", () => {
    const r = periodRange(data, { kind: "week", offset: 0 }, new Date(2026, 9, 14)); // a Wednesday
    expect(ymd(r.start)).toBe("2026-10-12");
    expect(ymd(r.end)).toBe("2026-10-19");
    expect(ymd(periodRange(data, { kind: "week", offset: -1 }, new Date(2026, 9, 14)).start)).toBe("2026-10-05");
    // A Sunday belongs to the week that started the Monday before.
    expect(ymd(periodRange(data, { kind: "week", offset: 0 }, new Date(2026, 9, 18)).start)).toBe("2026-10-12");
  });
  it("runs a month from the 1st", () => {
    const r = periodRange(data, { kind: "month", offset: 0 }, new Date(2026, 9, 14));
    expect([ymd(r.start), ymd(r.end)]).toEqual(["2026-10-01", "2026-11-01"]);
    expect(ymd(periodRange(data, { kind: "month", offset: -1 }, new Date(2026, 0, 20)).start)).toBe("2025-12-01");
  });
  it("matches the cycle summary for a cycle, and has no allocation for a week or month", () => {
    const cycle = summarizePeriod(data, { kind: "cycle", offset: -1 }, NOW);
    expect(cycle.approved).toBe(summarize(data, -1).approved);
    expect(cycle.budget).toBe(45 * 60);
    const week = summarizePeriod(data, { kind: "week", offset: -1 }, NOW);
    expect(week.budget).toBe(0);
    expect(week.byDay).toHaveLength(7);
    expect(week.approved).toBeLessThanOrEqual(cycle.approved);
    const month = summarizePeriod(data, { kind: "month", offset: 0 }, NOW);
    expect(month.byDay).toHaveLength(31);
  });
  it("splits a week and the week after it without counting an entry twice", () => {
    const a = summarizePeriod(data, { kind: "week", offset: -1 }, NOW).approved;
    const b = summarizePeriod(data, { kind: "week", offset: 0 }, NOW).approved;
    const both = summarizeRange(data, { start: periodRange(data, { kind: "week", offset: -1 }, NOW).start, end: periodRange(data, { kind: "week", offset: 0 }, NOW).end }, 0).approved;
    expect(a + b).toBe(both);
  });
});

describe("executive report", () => {
  const data = sampleData(NOW);
  const lastCycle = { kind: "cycle", offset: -1 } as const;

  it("states the hours delivered and how far over the allocation they went", () => {
    const r = buildExecutiveReport(data, lastCycle, NOW);
    expect(r.headline).toMatch(/hours more than the 45\.0 hours allocated/);
    expect(r.subtitle).toMatch(/^Cycle: /);
    expect(r.sections.map((s) => s.heading)).toEqual(
      expect.arrayContaining(["Where the hours went", "Progress by project", "Type of work", "Who did the work"]),
    );
  });
  it("names the main pieces of work on each project", () => {
    const r = buildExecutiveReport(data, lastCycle, NOW);
    const projects = r.sections.find((s) => s.heading === "Progress by project")!;
    expect(projects.bullets!.length).toBeGreaterThan(0);
    expect(projects.bullets![0]).toMatch(/Main work: .+\(.+, .+ h\)/);
  });
  it("adds up: department hours equal the approved total", () => {
    const r = buildExecutiveReport(data, lastCycle, NOW);
    const table = r.sections.find((s) => s.heading === "Where the hours went")!.table!;
    const total = table.rows.reduce((a, row) => a + parseFloat(row[1]), 0);
    expect(total).toBeCloseTo(parseFloat(fmtH(summarize(data, -1).approved)), 0);
  });
  it("compares with the period before", () => {
    const r = buildExecutiveReport(data, lastCycle, NOW);
    expect(r.sections.find((s) => s.heading.startsWith("Compared with"))).toBeDefined();
  });
  it("shows each department against its allocation and flags the ones that went over", () => {
    const marketing = data.departments[2].id;
    const withAlloc = { ...data, departments: data.departments.map((d) => (d.id === marketing ? { ...d, hours: 1 } : d)) };
    const r = buildExecutiveReport(withAlloc, lastCycle, NOW);
    const sec = r.sections.find((s) => s.heading === "Where the hours went")!;
    expect(sec.table!.head).toEqual(["Department", "Hours", "Share", "Allocated", "Used"]);
    expect(sec.bullets?.some((b) => b.includes(data.departments[2].name) && /over/.test(b))).toBe(true);
    // A week has no allocation of its own, so the columns are left out.
    const week = buildExecutiveReport(withAlloc, { kind: "week", offset: -1 }, NOW);
    expect(week.sections.find((s) => s.heading === "Where the hours went")?.table?.head).toEqual(["Department", "Hours", "Share"]);
  });
  it("mentions hours management added", () => {
    const withExt = { ...data, extensions: [{ id: "x", cycleStart: "2026-09-21", hours: 8, reason: "Audit support.", by: "candice", at: "" }] };
    const r = buildExecutiveReport(withExt, lastCycle, NOW);
    expect(r.sections.find((s) => s.heading === "Worth knowing")?.bullets?.join(" ")).toMatch(/added 8\.0 hours to this cycle: Audit support\./);
    expect(r.headline).toMatch(/53\.0 hours allocated|hours allocated/);
  });
  it("keeps internal notes out of the client's copy", () => {
    const pendingOnly = { ...data, entries: [...data.entries, ...addEntry(data, { staffId: "sib", projectId: "web", task: "Admin", note: "Waiting on a manager", start: new Date(2026, 8, 25, 9), end: new Date(2026, 8, 25, 11), minutes: 120, method: "manual", reason: "Forgot" }).entries.slice(-1)] };
    const internal = buildExecutiveReport(pendingOnly, lastCycle, NOW, { internal: true });
    const client = buildExecutiveReport(pendingOnly, lastCycle, NOW, { internal: false });
    expect(internal.sections.find((s) => s.heading === "Worth knowing")?.bullets?.join(" ")).toMatch(/waiting for approval/);
    expect(client.sections.find((s) => s.heading === "Worth knowing")?.bullets?.join(" ") ?? "").not.toMatch(/waiting for approval|typed in/);
  });
  it("says so when there is no approved work, instead of inventing a summary", () => {
    const empty = { ...data, entries: [] };
    const r = buildExecutiveReport(empty, lastCycle, NOW);
    expect(r.headline).toMatch(/No approved work/);
    expect(r.sections[0].heading).toBe("Nothing to report yet");
  });
  it("uses the right word for how many more people contributed", () => {
    const approved = data.entries.filter((e) => e.status === "approved" && e.start >= cycleRange(data.settings, -1).start.toISOString() && e.start < cycleRange(data.settings, -1).end.toISOString());
    const people = [...new Set(approved.map((e) => e.staffId))];
    const text = (n: number) => {
      const keep = new Set(people.slice(0, n));
      const r = buildExecutiveReport({ ...data, entries: data.entries.filter((e) => e.status !== "approved" || keep.has(e.staffId)) }, lastCycle, NOW);
      return reportToText(r);
    };
    expect(text(6)).toMatch(/1 more person contributed/);
    expect(text(6)).not.toMatch(/1 more people/);
    expect(text(8)).toMatch(/3 more people contributed/);
  });
  it("turns into plain text for email", () => {
    const text = reportToText(buildExecutiveReport(data, lastCycle, NOW));
    expect(text).toMatch(/^Executive report: /);
    expect(text).toContain("WHERE THE HOURS WENT");
  });
});

describe("Excel and CSV export", () => {
  const data = sampleData(NOW);
  const p = { kind: "cycle", offset: -1 } as const;

  it("builds the five sheets, and the work log adds up to the approved hours", () => {
    const sheets = reportSheets(data, p, NOW);
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "By department", "By project", "By person", "Work log"]);
    const log = sheets[4].rows;
    expect(log[0].map((c) => c.value)).toEqual(WORK_LOG_HEAD);
    const body = log.slice(1, -1);
    const sum = body.reduce((a, r) => a + (r[8].value as number), 0);
    const total = log[log.length - 1][8].value as number;
    expect(total).toBe(Number(fmtH(summarize(data, -1).approved)));
    expect(sum).toBeCloseTo(total, 0);
    expect(body.length).toBe(summarize(data, -1).list.filter((e) => e.status === "approved").length);
  });
  it("writes hours as numbers, not text, so Excel can add them up", () => {
    const sheets = reportSheets(data, p, NOW);
    expect(typeof sheets[4].rows[1][8].value).toBe("number");
    expect(typeof sheets[1].rows[1][1].value).toBe("number");
  });
  it("makes a real .xlsx file", async () => {
    const { default: writeXlsxFile } = await import("write-excel-file/node");
    const buffer = await writeXlsxFile(toWriterSheets(reportSheets(data, p, NOW))).toBuffer();
    expect(buffer.length).toBeGreaterThan(1000);
    expect(Buffer.from(buffer).subarray(0, 2).toString()).toBe("PK"); // an .xlsx file is a zip
  });
  it("names files by period", () => {
    expect(reportFileName(data, p, "xlsx", NOW)).toBe("hours-cycle-2026-09-21.xlsx");
    expect(reportFileName(data, { kind: "month", offset: 0 }, "csv", NOW)).toBe("hours-month-2026-10-01.csv");
  });
  it("marks hours typed in by management in the work log", () => {
    const base = sampleData(NOW);
    const logged = addEntry(base, { staffId: "sib", projectId: "web", task: "Content", note: "Wrote the campaign copy", start: new Date(2026, 8, 28, 9), end: new Date(2026, 8, 28, 10), minutes: 60, method: "manual", reason: "Logged by management" });
    const last = logged.entries[logged.entries.length - 1];
    const reviewed = reviewEntry({ ...logged, entries: logged.entries.map((e) => (e.id === last.id ? { ...e, loggedById: "candice" } : e)) }, last.id, "approved", "", "megan");
    const csv = csvFor(reviewed, -1);
    expect(csv).toContain("Typed in by Mrs Candice");
  });
});
