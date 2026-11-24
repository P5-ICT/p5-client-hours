import { PGlite } from "@electric-sql/pglite";
import type { Db } from "../src/db.js";

function wrap(pg: Pick<PGlite, "query" | "exec">, root: PGlite): Db {
  return {
    async query<T>(text: string, params?: unknown[]) {
      const r = await pg.query<T>(text, params as unknown[]);
      return { rows: r.rows, rowCount: Math.max(r.rows.length, r.affectedRows ?? 0) };
    },
    async exec(text) {
      await pg.exec(text);
    },
    tx: (fn) => root.transaction((t) => fn(wrap(t, root))),
    close: () => root.close(),
  };
}

/** Real Postgres running in-process. Used by the tests and by `npm run dev:local`. Not used in production. */
export function createPgliteDb(dataDir?: string): Db {
  const pg = new PGlite(dataDir);
  return wrap(pg, pg);
}
