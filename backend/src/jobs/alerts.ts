import { fileURLToPath } from "node:url";
import { createPgDb, type Db } from "../db.js";
import { loadEnv } from "../env.js";
import { createMailer, type Mailer } from "../mail.js";
import { cycleTotals } from "../cycle-totals.js";
import { cycleIndexAt, thresholdsReached, type AlertThreshold } from "../rules.js";
import { budgetHoursFor, loadSettings } from "../settings.js";

/**
 * Emails the managers once when the current cycle reaches 80% and 100% of the hours allocated (approved hours only).
 * Runs after every approval and again from a scheduled job, so a missed run catches up.
 */
export async function checkAlerts(db: Db, mailer: Mailer, now: Date = new Date()): Promise<AlertThreshold[]> {
  const s = await loadSettings(db);
  const { cycleStart: start, approvedMinutes: approved } = await cycleTotals(db, s, cycleIndexAt(s, now));
  const budgetHours = await budgetHoursFor(db, s, start);
  const sent: AlertThreshold[] = [];
  for (const threshold of thresholdsReached(approved, budgetHours)) {
    // Claim first: the primary key makes sure only one caller sends.
    const claim = await db.query("insert into alerts_sent (cycle_start, threshold) values ($1, $2) on conflict do nothing", [start, threshold]);
    if (claim.rowCount === 0) continue;

    const { rows: people } = await db.query<{ email: string }>("select email from users where active and app_role in ('manager', 'ceo')");
    const to = people.map((p) => p.email);
    const hours = (approved / 60).toFixed(1);
    const ok =
      to.length > 0 &&
      (await mailer.send({
        to,
        subject: threshold === 100 ? `${s.clientName}: hours used up` : `${s.clientName}: ${threshold}% of hours used`,
        text:
          `${s.clientName} has used ${hours} of the ${budgetHours} hours allocated in the cycle that started on ${start} (${threshold}% threshold).\n` +
          (threshold === 100 ? "Any further approved hours count as extra hours delivered.\n" : "") +
          "\nOpen P5 Client Hours to review the entries.",
      }));
    if (ok) sent.push(threshold);
    // Not sent (no recipients or mail failure): release the claim so the next run tries again.
    else await db.query("delete from alerts_sent where cycle_start = $1 and threshold = $2", [start, threshold]);
  }
  return sent;
}

// Run directly from a Render cron job: `npm run alerts`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // These one-off commands never sign tokens, so they do not need the real JWT_SECRET.
  const env = loadEnv({ ...process.env, JWT_SECRET: process.env.JWT_SECRET ?? "x".repeat(32) });
  const db = createPgDb(env.DATABASE_URL, env.DATABASE_SSL === "1");
  checkAlerts(db, createMailer(env))
    .then((sent) => console.log(sent.length ? `Sent alerts: ${sent.join(", ")}%` : "No alerts to send"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
