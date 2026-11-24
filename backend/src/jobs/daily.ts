import { fileURLToPath } from "node:url";
import { cycleTotals } from "../cycle-totals.js";
import { createPgDb, type Db } from "../db.js";
import { loadEnv } from "../env.js";
import { createMailer, type Mailer } from "../mail.js";
import { cycleIndexAt, cycleStartYmd, dayNumberOfYmd, localDayNumber, ymdOfDayNumber } from "../rules.js";
import { budgetHoursFor, loadSettings } from "../settings.js";

const hours = (minutes: number) => (minutes / 60).toFixed(1);

/**
 * The cycle summary goes to the managers, not straight to the client: a person decides what
 * leaves the building. The report screen has Copy, Download CSV and Print for sending it on.
 */
export async function sendCycleSummary(db: Db, mailer: Mailer, appUrl: string, now: Date = new Date()): Promise<string | null> {
  const s = await loadSettings(db);
  const current = cycleIndexAt(s, now);
  const finished = current - 1;
  const cycleStart = cycleStartYmd(s, finished);

  // Claim first: the primary key means only one run sends, even if the job overlaps itself.
  const claim = await db.query("insert into cycle_reports (cycle_start) values ($1) on conflict do nothing", [cycleStart]);
  if (!claim.rowCount) return null;

  const t = await cycleTotals(db, s, finished);
  const { rows: people } = await db.query<{ email: string }>("select email from users where active and app_role in ('manager', 'ceo')");
  if (!people.length) {
    await db.query("delete from cycle_reports where cycle_start = $1", [cycleStart]);
    return null;
  }

  const budget = await budgetHoursFor(db, s, cycleStart);
  const used = Number(hours(t.approvedMinutes));
  const extra = used - budget;
  const sent = await mailer.send({
    to: people.map((p) => p.email),
    subject: `${s.clientName}: cycle ending ${ymdOfDayNumber(dayNumberOfYmd(cycleStart) + s.cycleDays - 1)} is ready to report`,
    text:
      `The cycle that started on ${cycleStart} has ended.\n\n` +
      `Hours used (approved): ${hours(t.approvedMinutes)} of ${budget} hours allocated\n` +
      (extra > 0 ? `Extra hours delivered: ${extra.toFixed(1)}\n` : `Hours left: ${(-extra).toFixed(1)}\n`) +
      (t.pendingMinutes > 0 ? `Still awaiting approval: ${hours(t.pendingMinutes)} (not counted above)\n` : "") +
      `${t.people} people, ${t.projects} projects, ${t.entries} approved entries.\n\n` +
      `Check the entries, then open the client report to copy, download or print it for ${s.clientName}:\n` +
      `${appUrl.replace(/\/$/, "")}/client/report\n`,
  });
  if (!sent) {
    await db.query("delete from cycle_reports where cycle_start = $1", [cycleStart]);
    return null;
  }
  return cycleStart;
}

/**
 * A timer left running overnight turns into a wrong entry the next morning. One reminder per
 * person per day, to the person only: this is a nudge, not a report to their manager.
 */
export async function remindStaleTimers(db: Db, mailer: Mailer, appUrl: string, now: Date = new Date(), staleHours = 14): Promise<string[]> {
  const s = await loadSettings(db);
  const today = ymdOfDayNumber(localDayNumber(now, s.timezone));
  const cutoff = new Date(now.getTime() - staleHours * 3_600_000);
  const { rows } = await db.query<{ staff_id: string; name: string; email: string; started_at: Date }>(
    `select t.staff_id, u.name, u.email, t.started_at
       from timers t join users u on u.id = t.staff_id
      where t.running and t.started_at < $1 and u.active`,
    [cutoff],
  );

  const reminded: string[] = [];
  for (const r of rows) {
    const claim = await db.query("insert into timer_reminders (staff_id, on_day) values ($1, $2) on conflict do nothing", [r.staff_id, today]);
    if (!claim.rowCount) continue;
    const ran = Math.floor((now.getTime() - r.started_at.getTime()) / 3_600_000);
    const ok = await mailer.send({
      to: [r.email],
      subject: "Your P5 Client Hours timer is still running",
      text:
        `Hi ${r.name},\n\nYour timer has been running for about ${ran} hours. If you forgot to stop it, ` +
        `open P5 Client Hours and discard it, then type in the hours you actually worked.\n\n${appUrl.replace(/\/$/, "")}/staff/track\n`,
    });
    if (ok) reminded.push(r.staff_id);
    else await db.query("delete from timer_reminders where staff_id = $1 and on_day = $2", [r.staff_id, today]);
  }
  return reminded;
}

// Run from a Render cron job once a day: `npm run daily`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // These one-off commands never sign tokens, so they do not need the real JWT_SECRET.
  const env = loadEnv({ ...process.env, JWT_SECRET: process.env.JWT_SECRET ?? "x".repeat(32) });
  const db = createPgDb(env.DATABASE_URL, env.DATABASE_SSL === "1");
  const mailer = createMailer(env);
  Promise.all([sendCycleSummary(db, mailer, env.APP_URL), remindStaleTimers(db, mailer, env.APP_URL)])
    .then(([cycle, reminded]) => {
      console.log(cycle ? `Sent the cycle summary for ${cycle}` : "No cycle summary to send");
      console.log(reminded.length ? `Reminded ${reminded.length} about a running timer` : "No stale timers");
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
