import { randomUUID } from "node:crypto";
import request from "supertest";
import { createPgliteDb } from "../scripts/pglite-adapter.js";
import { createApp } from "../src/app.js";
import { hashPassword, signSession } from "../src/auth.js";
import { bootstrap } from "../src/bootstrap.js";
import type { Db } from "../src/db.js";
import { loadEnv, type Env } from "../src/env.js";
import type { Mail, Mailer } from "../src/mail.js";
import { migrate } from "../src/migrate.js";
import type { AppRole } from "../src/rules.js";

export const createTestDb = (): Db => createPgliteDb();

export const testEnv = (overrides: Record<string, string> = {}): Env =>
  loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: "unused",
    JWT_SECRET: "test-secret-test-secret-test-secret-123",
    CORS_ORIGIN: "http://localhost:3000",
    APP_URL: "http://localhost:3000",
    ...overrides,
  } as NodeJS.ProcessEnv);

export class FakeMailer implements Mailer {
  sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
    return true;
  }
}

export interface Harness {
  db: Db;
  env: Env;
  mailer: FakeMailer;
  api: ReturnType<typeof request>;
  /** Creates an active user with a password and returns their id and a session token. */
  user(role: AppRole, name?: string): Promise<{ id: string; token: string; email: string }>;
  /** Shortcut: an Authorization header. */
  as(token: string): { Authorization: string };
  projectId: string;
}

export async function createHarness(envOverrides: Record<string, string> = {}): Promise<Harness> {
  const db = createTestDb();
  const env = testEnv(envOverrides);
  await migrate(db);
  await bootstrap(db, { ADMIN_EMAIL: undefined, ADMIN_PASSWORD: undefined, ADMIN_NAME: "Admin" });
  // Anchor two days back so "now" is always inside the first cycle, whatever time the tests run.
  await db.query("update settings set cycle_anchor = to_char(current_date - 2, 'YYYY-MM-DD'), client_name = 'Test Client', budget_hours = 10");
  const projectId = "p_test";
  await db.query("insert into projects (id, name) values ($1, 'Website')", [projectId]);
  const mailer = new FakeMailer();
  const api = request(createApp({ db, env, mailer }));
  const hash = await hashPassword("a-long-password-1");
  let n = 0;
  return {
    db,
    env,
    mailer,
    api,
    projectId,
    as: (token) => ({ Authorization: `Bearer ${token}` }),
    async user(role, name = `${role} ${++n}`) {
      const id = randomUUID();
      const email = `${role}${n}-${id.slice(0, 4)}@example.com`;
      await db.query("insert into users (id, email, name, app_role, password_hash) values ($1, $2, $3, $4, $5)", [id, email, name, role, hash]);
      return { id, email, token: signSession(env.JWT_SECRET, id, 0) };
    },
  };
}

/** Inserts an entry directly and returns its id. Starts as pending (the database forces that). */
export async function insertEntry(h: Harness, staffId: string, o: { minutes?: number; method?: "timer" | "manual"; minutesAgo?: number } = {}): Promise<string> {
  const id = randomUUID();
  const minutes = o.minutes ?? 60;
  const end = new Date(Date.now() - (o.minutesAgo ?? 5) * 60_000);
  const start = new Date(end.getTime() - minutes * 60_000);
  await h.db.query(
    `insert into entries (id, staff_id, project_id, task, note, started_at, ended_at, minutes, method, manual_reason)
     values ($1, $2, $3, 'Development', 'Built the page', $4, $5, $6, $7, $8)`,
    [id, staffId, h.projectId, start, end, minutes, o.method ?? "timer", o.method === "manual" ? "Meeting off-site" : ""],
  );
  return id;
}
