import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import type { AppContext } from "../app.js";
import { requireAuth, requireRole } from "../auth.js";
import { HttpError, handler, parse } from "../http.js";
import { canExtendHours, cycleIndexAt, cycleStartYmd, dayNumberOfYmd } from "../rules.js";
import { loadSettings } from "../settings.js";

/**
 * Extra hours for a cycle when a project needs more than the usual. Management only.
 * Extensions are added or removed, never edited, and every change is in the audit log.
 */
export function extensionRoutes({ db, env }: AppContext) {
  const r = Router();
  r.use(requireAuth(db, env.JWT_SECRET), requireRole(canExtendHours));

  const body = z.object({
    cycleStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hours: z.number().positive("Add more than 0 hours.").max(1000),
    reason: z.string().trim().min(1, "Say why the extra hours are needed.").max(500),
  });

  r.post(
    "/",
    handler(async (req, res) => {
      const b = parse(body, req.body);
      const s = await loadSettings(db);
      const offset = dayNumberOfYmd(b.cycleStart) - dayNumberOfYmd(s.cycleAnchor);
      if (((offset % s.cycleDays) + s.cycleDays) % s.cycleDays !== 0) throw new HttpError(400, "That is not the first day of a cycle.", "cycleStart");
      const current = dayNumberOfYmd(cycleStartYmd(s, cycleIndexAt(s, new Date())));
      if (dayNumberOfYmd(b.cycleStart) > current) throw new HttpError(400, "You can only add hours to the current cycle or an earlier one.", "cycleStart");
      const id = randomUUID();
      await db.query("insert into hour_extensions (id, cycle_start, hours, reason, created_by) values ($1, $2, $3, $4, $5)", [id, b.cycleStart, b.hours, b.reason, req.user!.id]);
      await audit(db, req.user!.id, "extend-hours", "cycle", b.cycleStart, { hours: b.hours, reason: b.reason });
      res.status(201).json({ id });
    }),
  );

  /** Removes an extension added by mistake. */
  r.delete(
    "/:id",
    handler(async (req, res) => {
      const id = String(req.params.id);
      const gone = await db.query<{ cycle_start: string; hours: number }>("delete from hour_extensions where id = $1 returning cycle_start, hours", [id]);
      if (!gone.rowCount) throw new HttpError(404, "That extension does not exist.");
      await audit(db, req.user!.id, "remove-extension", "cycle", gone.rows[0]!.cycle_start, { hours: gone.rows[0]!.hours });
      res.json({ ok: true });
    }),
  );

  return r;
}
