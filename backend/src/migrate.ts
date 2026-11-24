import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPgDb, type Db } from "./db.js";
import { loadEnv } from "./env.js";

const dir = fileURLToPath(new URL("./migrations/", import.meta.url));

/** Applies every .sql file in order, once. Safe to run on every start. */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(dir + file, "utf8");
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query("insert into schema_migrations (name) values ($1)", [file]);
    });
    applied.push(file);
  }
  return applied;
}

// Run directly: `npm run migrate`.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // These one-off commands never sign tokens, so they do not need the real JWT_SECRET.
  const env = loadEnv({ ...process.env, JWT_SECRET: process.env.JWT_SECRET ?? "x".repeat(32) });
  const db = createPgDb(env.DATABASE_URL, env.DATABASE_SSL === "1");
  migrate(db)
    .then((a) => console.log(a.length ? `Applied: ${a.join(", ")}` : "Database is up to date"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
