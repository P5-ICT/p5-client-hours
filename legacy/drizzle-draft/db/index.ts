import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  }
  // Render's managed Postgres terminates TLS with its own certificate chain, so verification is
  // relaxed for that host only; a local database connects without TLS at all.
  const needsSsl = /\brender\.com\b/.test(connectionString) || /sslmode=require/.test(connectionString);
  return new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

// `next dev` re-evaluates modules on every change, which would leak a pool per reload.
const globalForDb = globalThis as unknown as { __p5Pool?: Pool };
const pool = globalForDb.__p5Pool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__p5Pool = pool;

export const db = drizzle(pool, { schema });
export { pool, schema };
export type Db = typeof db;
