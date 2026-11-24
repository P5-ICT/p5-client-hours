import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";
import { createPgDb } from "./db.js";
import { loadEnv } from "./env.js";
import { createMailer } from "./mail.js";
import { migrate } from "./migrate.js";

const env = loadEnv();
const db = createPgDb(env.DATABASE_URL, env.DATABASE_SSL === "1");

const applied = await migrate(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(", ")}`);
await bootstrap(db, env);

const app = createApp({ db, env, mailer: createMailer(env) });
const server = app.listen(env.PORT, () => console.log(`API listening on port ${env.PORT}`));

const stop = () => {
  server.close(() => db.close().finally(() => process.exit(0)));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
