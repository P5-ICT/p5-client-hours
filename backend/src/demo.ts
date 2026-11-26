/**
 * Trial mode: ready-made test accounts and sample data, so people can try the system without using their own email.
 *
 * It only runs when DEMO_DATA=1, which is set in render.free.yaml and nowhere else. Every account uses the email
 * domain below and one shared password (DEMO_PASSWORD). Nothing here is meant for real hours.
 */
import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth.js";
import type { Db } from "./db.js";
import type { Env } from "./env.js";
import { localDayNumber, ymdOfDayNumber, type AppRole } from "./rules.js";

export const DEMO_DOMAIN = "pillar5group.com";
export const isDemoEmail = (email: string) => email.trim().toLowerCase().endsWith(`@${DEMO_DOMAIN}`);

const TIMEZONE = "Africa/Johannesburg";
const DAY = 86_400_000;

type DeptKey = "ict" | "data" | "fin" | "mkt" | "ops";

const DEPARTMENTS: Array<{ key: DeptKey; name: string; colour: number; hours: number }> = [
  { key: "ict", name: "ICT", colour: 0, hours: 17 },
  { key: "data", name: "Database", colour: 1, hours: 8 },
  { key: "mkt", name: "Marketing", colour: 2, hours: 8 },
  { key: "fin", name: "Finance", colour: 3, hours: 6 },
  { key: "ops", name: "Operations and Admin", colour: 4, hours: 6 },
];

const PROJECTS = [
  { key: "apps", name: "App development" },
  { key: "systems", name: "Software and systems support" },
  { key: "database", name: "Database and reporting" },
  { key: "finance", name: "Finance and invoicing" },
  { key: "marketing", name: "Marketing and social media" },
  { key: "office", name: "Operations and office admin" },
] as const;
type ProjectKey = (typeof PROJECTS)[number]["key"];

/**
 * The people the testers sign in as come first. The names here are only job labels: this repository must not hold
 * colleagues' names. Real display names are set privately with DEMO_NAMES (see namesFrom).
 */
export const DEMO_PEOPLE: Array<{ key: string; name: string; title: string; dept: DeptKey; role: AppRole }> = [
  { key: "admin", name: "System Admin", title: "System Administrator", dept: "ict", role: "admin" },
  { key: "manager", name: "Manager", title: "Manager", dept: "ops", role: "manager" },
  { key: "manager2", name: "Second Manager", title: "Manager", dept: "mkt", role: "manager" },
  { key: "ceo", name: "CEO", title: "Chief Executive Officer", dept: "ops", role: "ceo" },
  { key: "staff", name: "Developer One", title: "Software Developer", dept: "ict", role: "staff" },
  { key: "staff2", name: "Developer Two", title: "Software Developer", dept: "ict", role: "staff" },
  { key: "client", name: "Client Contact", title: "Client", dept: "ops", role: "client" },
  { key: "developer3", name: "Developer Three", title: "Software Developer", dept: "ict", role: "staff" },
  { key: "database", name: "Database Officer", title: "Database Officer", dept: "data", role: "staff" },
  { key: "finance", name: "Finance Officer One", title: "Finance Officer", dept: "fin", role: "staff" },
  { key: "finance2", name: "Finance Officer Two", title: "Finance Officer", dept: "fin", role: "staff" },
  { key: "marketing", name: "Marketing Officer", title: "Marketing Officer", dept: "mkt", role: "staff" },
  { key: "operations", name: "Operations Officer", title: "Operations and Admin Officer", dept: "ops", role: "staff" },
];

/** Accounts from the first version of the sample data. A reset removes them. */
const RETIRED_KEYS = ["sipho", "kayla", "aisha", "johan"];

export const demoEmail = (key: string) => `${key}@${DEMO_DOMAIN}`;

/** Reads DEMO_NAMES, written as "staff=First Name; finance=Other Name". Unknown keys and empty names are ignored. */
export function namesFrom(value: string | undefined): Map<string, string> {
  const names = new Map<string, string>();
  for (const part of (value ?? "").split(";")) {
    const [rawKey = "", ...rest] = part.split("=");
    const key = rawKey.trim().toLowerCase();
    const name = rest.join("=").trim().slice(0, 80);
    if (name && DEMO_PEOPLE.some((p) => p.key === key)) names.set(key, name);
  }
  return names;
}

const POOLS: Record<DeptKey, { who: string[]; work: Array<[ProjectKey, string, string]> }> = {
  ict: {
    who: ["staff", "staff2", "developer3"],
    work: [
      ["apps", "Development", "Built new screens for the mobile app"],
      ["apps", "Testing", "Tested the app and fixed the bugs found"],
      ["systems", "Development", "Added a new feature to the web system"],
      ["systems", "Support", "Helped users with login and software problems"],
      ["apps", "Meetings", "Planned the next app release with the team"],
      ["systems", "Testing", "Checked the system on phones and laptops"],
    ],
  },
  data: {
    who: ["database"],
    work: [
      ["database", "Admin", "Captured and cleaned new records"],
      ["database", "Support", "Checked the database backups"],
      ["database", "Research", "Prepared the data report for management"],
      ["database", "Testing", "Checked records for duplicates and errors"],
    ],
  },
  fin: {
    who: ["finance", "finance2"],
    work: [
      ["finance", "Admin", "Captured invoices and payments"],
      ["finance", "Admin", "Reconciled the accounts"],
      ["finance", "Research", "Prepared the monthly finance report"],
      ["finance", "Support", "Followed up on outstanding payments"],
    ],
  },
  mkt: {
    who: ["marketing"],
    work: [
      ["marketing", "Content", "Wrote social media posts"],
      ["marketing", "Design", "Designed graphics for the campaign"],
      ["marketing", "Content", "Scheduled next week's posts"],
      ["marketing", "Meetings", "Planned the campaign with the team"],
    ],
  },
  ops: {
    who: ["operations"],
    work: [
      ["office", "Admin", "Updated office records and filing"],
      ["office", "Meetings", "Arranged meetings and sent the agendas"],
      ["office", "Support", "Ordered supplies and followed up with suppliers"],
      ["office", "Admin", "Prepared documents for management"],
    ],
  },
};
const DURATIONS = [90, 150, 120, 180, 60, 210, 105, 135];

export type SeedResult = "seeded" | "reset" | "exists" | "skipped" | "refused";

type DemoEnv = Pick<Env, "DEMO_PASSWORD" | "DEMO_RESET" | "DEMO_NAMES">;

/** True for a weekday. Day 0 (1 Jan 1970) was a Thursday. */
const isWeekday = (dayNumber: number) => {
  const dow = (dayNumber + 4) % 7; // 0 = Sunday
  return dow >= 1 && dow <= 5;
};

const weekdaysBetween = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i).filter(isWeekday);

/**
 * Creates the demo accounts and sample data, once. On later starts it only refreshes the shared password.
 * With DEMO_RESET=1 it wipes the hours and starts the sample data again, but refuses if real people have been added.
 */
export async function seedDemo(db: Db, env: DemoEnv, now: Date = new Date()): Promise<SeedResult> {
  const password = env.DEMO_PASSWORD ?? "";
  if (password.length < 7) {
    console.warn("Demo mode is on but DEMO_PASSWORD is missing or shorter than 7 characters, so no demo accounts were made.");
    return "skipped";
  }
  const hash = await hashPassword(password);
  // Earlier trials used @demo.example. Those accounts are switched off now that the demo uses the company domain.
  await db.query("update users set active = false where email like '%@demo.example'");
  const like = `%@${DEMO_DOMAIN}`;
  const existing = (await db.query<{ n: number }>("select count(*)::int as n from users where email like $1", [like])).rows[0]!.n;
  const reset = env.DEMO_RESET === "1";
  const names = namesFrom(env.DEMO_NAMES);

  if (existing > 0 && !reset) {
    // Changing DEMO_PASSWORD changes the shared password, and clears any lock-out the testers caused.
    await db.query("update users set password_hash = $1, failed_logins = 0, locked_until = null, session_epoch = session_epoch + 1 where email like $2", [hash, like]);
    // A changed DEMO_NAMES shows up on the next start without touching any hours.
    for (const [key, name] of names) await db.query("update users set name = $1 where email = $2", [name, demoEmail(key)]);
    return "exists";
  }

  if (reset) {
    // Never wipe a system that real people have started to use.
    const real = await db.query("select 1 from users where active and email not like $1 and email not like '%@demo.example' and app_role <> 'admin'", [like]);
    if (real.rowCount) {
      console.warn("DEMO_RESET was ignored: this database has real accounts besides the demo ones and an admin.");
      return "refused";
    }
    await db.query("truncate entries, timers, hour_extensions, alerts_sent, cycle_reports, timer_reminders");
    await db.query("update users set department_id = null");
    await db.query("delete from projects");
    await db.query("delete from departments");
    await db.query("delete from users where email like '%@demo.example' or email = any($1)", [RETIRED_KEYS.map(demoEmail)]);
  }

  // ---- departments and projects ----
  const deptId = new Map<DeptKey, string>();
  for (const d of DEPARTMENTS) {
    await db.query("insert into departments (id, name, colour, allocated_hours) values ($1, $2, $3, $4) on conflict (name) do update set allocated_hours = excluded.allocated_hours", [
      `d_${d.key}`, d.name, d.colour, d.hours,
    ]);
    deptId.set(d.key, (await db.query<{ id: string }>("select id from departments where name = $1", [d.name])).rows[0]!.id);
  }
  const projectId = new Map<ProjectKey, string>();
  for (const p of PROJECTS) {
    await db.query("insert into projects (id, name) values ($1, $2) on conflict (name) do nothing", [`p_${p.key}`, p.name]);
    projectId.set(p.key, (await db.query<{ id: string }>("select id from projects where name = $1", [p.name])).rows[0]!.id);
  }

  // ---- people ----
  const userId = new Map<string, string>();
  for (const p of DEMO_PEOPLE) {
    const email = demoEmail(p.key);
    await db.query(
      "insert into users (id, email, name, job_title, department_id, app_role, password_hash) values ($1, $2, $3, $4, $5, $6, $7) on conflict (email) do update set name = excluded.name, job_title = excluded.job_title, department_id = excluded.department_id, app_role = excluded.app_role, password_hash = excluded.password_hash, active = true, failed_logins = 0, locked_until = null",
      [randomUUID(), email, names.get(p.key) ?? p.name, p.title, deptId.get(p.dept), p.role, hash],
    );
    userId.set(p.key, (await db.query<{ id: string }>("select id from users where email = $1", [email])).rows[0]!.id);
  }

  // ---- today is day 8 of a 14 day cycle ----
  const today = localDayNumber(now, TIMEZONE);
  const anchor = today - 7;
  await db.query("update settings set client_name = 'Our Client', budget_hours = 45, cycle_days = 14, cycle_anchor = $1, min_timer_minutes = 15", [ymdOfDayNumber(anchor)]);

  interface Seed {
    who: string; project: ProjectKey; task: string; note: string; day: number; startMin: number; minutes: number;
    method?: "timer" | "manual"; reason?: string; status?: "approved" | "pending" | "rejected"; reviewer?: string; reviewNote?: string; loggedBy?: string;
  }
  const insert = async (e: Seed) => {
    const id = randomUUID();
    const start = new Date(e.day * DAY + e.startMin * 60_000);
    const end = new Date(start.getTime() + e.minutes * 60_000);
    await db.query(
      `insert into entries (id, staff_id, project_id, task, note, started_at, ended_at, minutes, method, manual_reason, logged_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, userId.get(e.who), projectId.get(e.project), e.task, e.note, start, end, e.minutes, e.method ?? "timer", e.reason ?? "", e.loggedBy ? userId.get(e.loggedBy) : null],
    );
    const status = e.status ?? "approved";
    if (status !== "pending") {
      // Entries always start as pending (the database forces it); reviewed ones are then reviewed the normal way.
      await db.query("update entries set status = $1, reviewer_id = $2, review_note = $3, reviewed_at = $4 where id = $5", [
        status, userId.get(e.reviewer ?? "manager"), e.reviewNote ?? "", new Date(end.getTime() + 3 * 3_600_000), id,
      ]);
    }
  };

  /** Fills `target` minutes of approved work for one department across the given days. */
  const fill = async (dept: DeptKey, target: number, days: number[]) => {
    const pool = POOLS[dept];
    let left = target;
    for (let i = 0; left > 0; i++) {
      const minutes = Math.min(left, DURATIONS[i % DURATIONS.length]!);
      const [project, task, note] = pool.work[i % pool.work.length]!;
      await insert({
        who: pool.who[i % pool.who.length]!, project, task, note,
        day: days[i % days.length]!, startMin: 6 * 60 + (i % 5) * 100, minutes,
        method: i % 9 === 8 ? "manual" : "timer", reason: i % 9 === 8 ? "Was in a meeting off-site, no laptop" : "",
        reviewer: i % 2 ? "manager" : "manager2",
      });
      left -= minutes;
    }
  };

  // Last cycle: 52.5 hours, which is 7.5 more than the 45 allocated.
  const previousDays = weekdaysBetween(anchor - 14, anchor - 1);
  await fill("ict", 21 * 60, previousDays);
  await fill("data", 9 * 60, previousDays);
  await fill("mkt", 9.5 * 60, previousDays);
  await fill("fin", 7 * 60, previousDays);
  await fill("ops", 6 * 60, previousDays);

  // This cycle so far: 33 hours approved.
  const currentDays = weekdaysBetween(anchor, today - 1);
  await fill("ict", 13 * 60, currentDays);
  await fill("data", 6 * 60, currentDays);
  await fill("mkt", 6 * 60, currentDays);
  await fill("fin", 4 * 60, currentDays);
  await fill("ops", 4 * 60, currentDays);

  // Waiting for approval (11 hours), one rejected, and one typed in by a manager for someone else.
  const d4 = currentDays[currentDays.length - 1]!;
  const d3 = currentDays[currentDays.length - 2] ?? d4;
  const wait = (e: Omit<Seed, "status">) => insert({ ...e, status: "pending" });
  await wait({ who: "staff", project: "apps", task: "Development", note: "Worked on the sign-in screen of the app", day: d4, startMin: 6 * 60, minutes: 75 });
  await wait({ who: "staff", project: "systems", task: "Meetings", note: "Discussed system changes with management", day: d3, startMin: 11 * 60, minutes: 60, method: "manual", reason: "Was in a meeting, no laptop with me" });
  await wait({ who: "developer3", project: "apps", task: "Development", note: "Added a new report page to the app", day: d4, startMin: 7 * 60, minutes: 150 });
  await wait({ who: "finance", project: "finance", task: "Admin", note: "Captured this week's invoices", day: d4, startMin: 8 * 60, minutes: 90 });
  await wait({ who: "marketing", project: "marketing", task: "Content", note: "Drafted the newsletter for next week", day: d4, startMin: 9 * 60, minutes: 105 });
  await wait({ who: "database", project: "database", task: "Admin", note: "Updated the records after the data check", day: d3, startMin: 12 * 60, minutes: 60, method: "manual", reason: "Forgot to start the timer after lunch" });
  await wait({ who: "staff2", project: "systems", task: "Support", note: "Set up software on a new laptop", day: d3, startMin: 8 * 60, minutes: 120, method: "manual", reason: "Logged by management", loggedBy: "manager" });
  await insert({ who: "operations", project: "finance", task: "Admin", note: "Filed the office supplies receipts", day: d3, startMin: 7 * 60, minutes: 60, status: "rejected", reviewer: "manager", reviewNote: "Logged on the wrong project. Please log it again on Operations and office admin." });

  // Management added hours for launch week.
  await db.query("insert into hour_extensions (id, cycle_start, hours, reason, created_by) values ($1, $2, 5, 'Extra work for the new app release', $3)", [
    randomUUID(), ymdOfDayNumber(anchor), userId.get("manager2"),
  ]);

  return reset ? "reset" : "seeded";
}
