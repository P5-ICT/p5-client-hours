/**
 * Runs the API with no Postgres install: the database is PGlite, saved in backend/.data.
 * For trying the app on your own computer. Production uses real Postgres (src/server.ts).
 */
import { mkdirSync } from "node:fs";
import { createApp } from "../src/app.js";
import { bootstrap } from "../src/bootstrap.js";
import { loadEnv } from "../src/env.js";
import { createMailer } from "../src/mail.js";
import { migrate } from "../src/migrate.js";
import { createPgliteDb } from "./pglite-adapter.js";

const env = loadEnv({
  JWT_SECRET: "local-development-secret-not-for-production",
  DATABASE_URL: "pglite",
  ADMIN_EMAIL: "admin@example.com",
  ADMIN_PASSWORD: "local-admin-password",
  ADMIN_NAME: "Local Admin",
  ...process.env,
} as NodeJS.ProcessEnv);

const dataDir = process.env.PGLITE_DIR ?? ".data/pg";
mkdirSync(dataDir, { recursive: true });
const db = createPgliteDb(dataDir);
await migrate(db);
await bootstrap(db, env);

createApp({ db, env, mailer: createMailer(env) }).listen(env.PORT, () => {
  console.log(`Local API on http://localhost:${env.PORT}  (sign in as ${env.ADMIN_EMAIL})`);
});
