import type { Db } from "./db.js";

/** Every approve, reject, delete and settings or people change is written here, so a mistake can be traced. */
export async function audit(db: Db, actorId: string | null, action: string, entity: string, entityId: string | null, detail: Record<string, unknown> = {}) {
  await db.query("insert into audit_log (actor_id, action, entity, entity_id, detail) values ($1, $2, $3, $4, $5)", [
    actorId,
    action,
    entity,
    entityId,
    JSON.stringify(detail),
  ]);
}
