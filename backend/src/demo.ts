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

type DeptKey = "ops" | "adm" | "mkt";

const DEPARTMENTS: Array<{ key: DeptKey; name: string; colour: number; hours: number }> = [
  { key: "ops", name: "Operations", colour: 0, hours: 25 },
  { key: "adm", name: "Administration", colour: 1, hours: 12 },
  { key: "mkt", name: "Marketing", colour: 2, hours: 8 },
];

const PROJECTS = [
  { key: "web", name: "Website and booking system" },
  { key: "brand", name: "Brand refresh" },
  { key: "social", name: "Social media campaign" },
  { key: "supply", name: "Supplier sourcing" },
] as const;
type ProjectKey = (typeof PROJECTS)[number]["key"];

/** The people the testers sign in as come first. The rest are the colleagues who did the sample work. */
export const DEMO_PEOPLE: Array<{ key: string; name: string; title: string; dept: DeptKey; role: AppRole }> = [
  { key: "admin", name: "Demo Admin", title: "System Administrator", dept: "adm", role: "admin" },
  { key: "manager", name: "Demo Manager", title: "Operations Manager", dept: "adm", role: "manager" },
  { key: "manager2", name: "Demo Manager Two", title: "Marketing Manager", dept: "mkt", role: "manager" },
  { key: "ceo", name: "Demo CEO", title: "Chief Executive", dept: "adm", role: "ceo" },
  { key: "staff", name: "Demo Staff", title: "Operations Coordinator", dept: "ops", role: "staff" },
  { key: "staff2", name: "Demo Staff Two", title: "Graphic Designer", dept: "mkt", role: "staff" },
  { key: "client", name: "Demo Client", title: "Sample Client", dept: "adm", role: "client" },
  { key: "sipho", name: "Sipho Ndlovu", title: "Web Developer", dept: "ops", role: "staff" },
  { key: "kayla", name: "Kayla Adams", title: "Social Media Manager", dept: "mkt", role: "staff" },
  { key: "aisha", name: "Aisha Daniels", title: "Office Administrator", dept: "adm", role: "staff" },
  { key: "johan", name: "Johan van Wyk", title: "Finance Clerk", dept: "adm", role: "staff" },
];

export const demoEmail = (key: string) => `${key}@${DEMO_DOMAIN}`;

const POOLS: Record<DeptKey, { who: string[]; work: Array<[ProjectKey, string, string]> }> = {
  ops: {
    who: ["staff", "sipho"],
    work: [
      ["web", "Development", "Built the booking form and connected it to the database"],
      ["web", "Testing", "Fixed two bugs found during testing"],
      ["supply", "Research", "Shortlisted five suppliers and compared prices"],
      ["web", "Development", "Updated the booking confirmation emails"],
      ["supply", "Meetings", "Called three suppliers to confirm delivery times"],
      ["web", "Testing", "Checked the site on phones and tablets"],
    ],
  },
  adm: {
    who: ["aisha", "johan"],
    work: [
      ["supply", "Admin", "Filed supplier contracts and updated the register"],
      ["web", "Support", "Set up the company domain and email accounts"],
      ["supply", "Admin", "Prepared the monthly progress report"],
      ["web", "Meetings", "Booked the client review meeting and sent the agenda"],
    ],
  },
  mkt: {
    who: ["staff2", "kayla"],
    work: [
      ["brand", "Design", "Logo concepts, three options for review"],
      ["social", "Content", "Wrote eight social media posts for the launch"],
      ["brand", "Design", "Colour palette and type guide"],
      ["social", "Design", "Designed graphics for the posts"],
      ["social", "Content", "Scheduled next week's posts"],
    ],
  },
};
const DURATIONS = [90, 150, 120, 180, 60, 210, 105, 135];

export type SeedResult = "seeded" | "reset" | "exists" | "skipped" | "refused";

type DemoEnv = Pick<Env, "DEMO_PASSWORD" | "DEMO_RESET">;

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

  if (existing > 0 && !reset) {
    // Changing DEMO_PASSWORD changes the shared password, and clears any lock-out the testers caused.
    await db.query("update users set password_hash = $1, failed_logins = 0, locked_until = null, session_epoch = session_epoch + 1 where email like $2", [hash, like]);
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
      "insert into users (id, email, name, job_title, department_id, app_role, password_hash) values ($1, $2, $3, $4, $5, $6, $7) on conflict (email) do update set password_hash = excluded.password_hash, active = true, failed_logins = 0, locked_until = null",
      [randomUUID(), email, p.name, p.title, deptId.get(p.dept), p.role, hash],
    );
    userId.set(p.key, (await db.query<{ id: string }>("select id from users where email = $1", [email])).rows[0]!.id);
  }

  // ---- today is day 8 of a 14 day cycle ----
  const today = localDayNumber(now, TIMEZONE);
  const anchor = today - 7;
  await db.query("update settings set client_name = 'Sample Client (Pty) Ltd', budget_hours = 45, cycle_days = 14, cycle_anchor = $1, min_timer_minutes = 1", [ymdOfDayNumber(anchor)]);

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
  await fill("ops", 27 * 60, previousDays);
  await fill("adm", 12.5 * 60, previousDays);
  await fill("mkt", 13 * 60, previousDays);

  // This cycle so far: 33 hours approved, in the department shares.
  const currentDays = weekdaysBetween(anchor, today - 1);
  await fill("ops", 17 * 60, currentDays);
  await fill("adm", 9.5 * 60, currentDays);
  await fill("mkt", 6.5 * 60, currentDays);

  // Waiting for approval (11 hours), one rejected, and one typed in by a manager for someone else.
  const d4 = currentDays[currentDays.length - 1]!;
  const d3 = currentDays[currentDays.length - 2] ?? d4;
  const wait = (e: Omit<Seed, "status">) => insert({ ...e, status: "pending" });
  await wait({ who: "staff", project: "supply", task: "Research", note: "Compared prices from three suppliers", day: d4, startMin: 6 * 60, minutes: 75 });
  await wait({ who: "staff", project: "web", task: "Meetings", note: "Client workshop on the booking flow", day: d3, startMin: 11 * 60, minutes: 60, method: "manual", reason: "Meeting was off-site, no laptop with me" });
  await wait({ who: "sipho", project: "web", task: "Development", note: "Added the payment confirmation page", day: d4, startMin: 7 * 60, minutes: 150 });
  await wait({ who: "aisha", project: "supply", task: "Admin", note: "Updated the supplier contact list", day: d4, startMin: 8 * 60, minutes: 90 });
  await wait({ who: "kayla", project: "social", task: "Content", note: "Drafted the newsletter for the launch week", day: d4, startMin: 9 * 60, minutes: 105 });
  await wait({ who: "johan", project: "supply", task: "Admin", note: "Reconciled the supplier invoices", day: d3, startMin: 12 * 60, minutes: 60, method: "manual", reason: "Forgot to start the timer after lunch" });
  await wait({ who: "staff2", project: "brand", task: "Design", note: "Printed the draft brand pack for the review", day: d3, startMin: 8 * 60, minutes: 120, method: "manual", reason: "Logged by management", loggedBy: "manager" });
  await insert({ who: "johan", project: "web", task: "Admin", note: "Filed the hosting invoice", day: d3, startMin: 7 * 60, minutes: 60, status: "rejected", reviewer: "manager", reviewNote: "Logged on the wrong project. Please log it again on Supplier sourcing." });

  // Management added hours for launch week.
  await db.query("insert into hour_extensions (id, cycle_start, hours, reason, created_by) values ($1, $2, 5, 'Launch week for the new booking site', $3)", [
    randomUUID(), ymdOfDayNumber(anchor), userId.get("manager2"),
  ]);

  return reset ? "reset" : "seeded";
}
