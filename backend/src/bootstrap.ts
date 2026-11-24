import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth.js";
import type { Db } from "./db.js";
import type { Env } from "./env.js";

const DEFAULT_WORK_TYPES = ["Development", "Design", "Testing", "Content", "Research", "Meetings", "Support", "Admin"];

/**
 * Makes a fresh database usable: default settings, work types, and the first admin
 * (from ADMIN_EMAIL and ADMIN_PASSWORD). Does nothing on a database that is already set up.
 */
export async function bootstrap(db: Db, env: Pick<Env, "ADMIN_EMAIL" | "ADMIN_PASSWORD" | "ADMIN_NAME">): Promise<void> {
  // Starting values only. The admin sets the real client, hours per cycle and cycle date on the Team and settings screen.
  await db.query(
    "insert into settings (id, client_name, budget_hours, cycle_days, cycle_anchor) values (1, 'New client', 45, 14, to_char(current_date, 'YYYY-MM-DD')) on conflict do nothing",
  );
  for (const name of DEFAULT_WORK_TYPES) await db.query("insert into work_types (name) values ($1) on conflict do nothing", [name]);

  const admins = await db.query("select 1 from users where app_role = 'admin' and active");
  if (admins.rowCount) return;
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    console.warn("No admin exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD and restart to create the first one.");
    return;
  }
  if (env.ADMIN_PASSWORD.length < 10) throw new Error("ADMIN_PASSWORD must be at least 10 characters");
  await db.query("insert into users (id, email, name, app_role, password_hash) values ($1, $2, $3, 'admin', $4) on conflict (email) do update set app_role = 'admin', active = true, password_hash = excluded.password_hash", [
    randomUUID(),
    env.ADMIN_EMAIL.trim().toLowerCase(),
    env.ADMIN_NAME,
    await hashPassword(env.ADMIN_PASSWORD),
  ]);
  console.log(`Created the first admin: ${env.ADMIN_EMAIL}`);
}
