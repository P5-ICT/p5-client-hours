import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import type { AppContext } from "../app.js";
import { requireAuth, requireRole } from "../auth.js";
import { checkAlerts } from "../jobs/alerts.js";
import { HttpError, handler, parse } from "../http.js";
import { canApprove, canLogForOthers, canLogTime, cycleIndexAt, cycleStartYmd, localDayNumber, dayNumberOfYmd, minutesBetween, validateManualTimes, validateNote, validateProof } from "../rules.js";
import { loadSettings } from "../settings.js";

export function entryRoutes(ctx: AppContext) {
  const { db, env, mailer } = ctx;
  const r = Router();
  r.use(requireAuth(db, env.JWT_SECRET));

  const manualBody = z.object({
    /** Management only: the person the time was worked by. Leave out to log your own. */
    staffId: z.string().optional(),
    projectId: z.string().min(1),
    task: z.string().min(1),
    note: z.string().max(2000),
    proof: z.string().max(2000).default(""),
    start: z.coerce.date(),
    end: z.coerce.date(),
    reason: z.string().max(500),
  });

  /** Typed-in hours (the timer was not used). Always pending, and always needs a reason. */
  r.post(
    "/",
    requireRole(canLogTime),
    handler(async (req, res) => {
      const b = parse(manualBody, req.body);
      const note = b.note.trim();
      let reason = b.reason.trim();
      const proof = b.proof.trim();

      // Management can capture hours for other people and teams. The entry still waits for approval,
      // and the person who typed it in cannot be the one who approves it.
      let staffId = req.user!.id;
      let loggedBy: string | null = null;
      if (b.staffId && b.staffId !== req.user!.id) {
        if (!canLogForOthers(req.user!.appRole)) throw new HttpError(403, "Only management can log time for other people.");
        const who = await db.query("select 1 from users where id = $1 and active and app_role <> 'client'", [b.staffId]);
        if (!who.rowCount) throw new HttpError(400, "Pick a person from the list.", "staffId");
        staffId = b.staffId;
        loggedBy = req.user!.id;
        if (!reason) reason = "Logged by management";
      }
      const timeError = validateManualTimes(b.start, b.end, new Date());
      if (timeError) throw new HttpError(400, timeError.message, timeError.field);
      if (validateNote(note)) throw new HttpError(400, "Write a short note on what you did.", "note");
      if (!reason) throw new HttpError(400, "Add the reason the timer was not used.", "reason");
      const badProof = validateProof(proof);
      if (badProof) throw new HttpError(400, badProof.message, "proof");

      const s = await loadSettings(db);
      // Typed-in time must fall in the current cycle, so a closed cycle's total cannot be changed afterwards.
      const first = dayNumberOfYmd(cycleStartYmd(s, cycleIndexAt(s, new Date())));
      if (localDayNumber(b.start, s.timezone) < first) throw new HttpError(400, "You can only log time in the current cycle.", "start");

      const [project, task] = await Promise.all([
        db.query("select 1 from projects where id = $1 and active", [b.projectId]),
        db.query("select 1 from work_types where name = $1", [b.task]),
      ]);
      if (!project.rowCount) throw new HttpError(400, "Pick a project from the list.", "projectId");
      if (!task.rowCount) throw new HttpError(400, "Pick a type of work from the list.", "task");

      const id = randomUUID();
      const minutes = minutesBetween(b.start, b.end);
      await db.query(
        `insert into entries (id, staff_id, project_id, task, note, proof, started_at, ended_at, minutes, method, manual_reason, logged_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', $10, $11)`,
        [id, staffId, b.projectId, b.task, note, proof, b.start, b.end, minutes, reason, loggedBy],
      );
      await audit(db, req.user!.id, "submit", "entry", id, { method: "manual", minutes, ...(loggedBy ? { onBehalfOf: staffId } : {}) });
      res.status(201).json({ id, minutes });
    }),
  );

  /** Staff can delete their own entry only while it is awaiting approval. */
  r.delete(
    "/:id",
    requireRole(canLogTime),
    handler(async (req, res) => {
      const id = String(req.params.id);
      const del = await db.query("delete from entries where id = $1 and staff_id = $2 and status = 'pending'", [id, req.user!.id]);
      if (!del.rowCount) throw new HttpError(404, "Only your own entries that are awaiting approval can be deleted.");
      await audit(db, req.user!.id, "delete", "entry", id);
      res.json({ ok: true });
    }),
  );

  const reviewBody = z.object({ status: z.enum(["approved", "rejected"]), note: z.string().max(1000).default("") });

  r.post(
    "/:id/review",
    requireRole(canApprove),
    handler(async (req, res) => {
      const id = String(req.params.id);
      const b = parse(reviewBody, req.body);
      const note = b.note.trim();
      if (b.status === "rejected" && !note) throw new HttpError(400, "Give a reason for rejecting this entry.", "note");
      const { rows } = await db.query<{ staff_id: string; status: string; logged_by: string | null }>("select staff_id, status, logged_by from entries where id = $1", [id]);
      const entry = rows[0];
      if (!entry) throw new HttpError(404, "That entry does not exist.");
      if (entry.staff_id === req.user!.id) throw new HttpError(403, "You cannot review your own hours.");
      if (entry.logged_by === req.user!.id) throw new HttpError(403, "You typed these hours in, so another manager has to review them.");
      if (entry.status !== "pending") throw new HttpError(409, "This entry was already reviewed.");
      const upd = await db.query(
        "update entries set status = $1, reviewer_id = $2, review_note = $3, reviewed_at = now() where id = $4 and status = 'pending'",
        [b.status, req.user!.id, note, id],
      );
      if (!upd.rowCount) throw new HttpError(409, "This entry was already reviewed.");
      await audit(db, req.user!.id, b.status === "approved" ? "approve" : "reject", "entry", id, { note });
      if (b.status === "approved") await checkAlerts(db, mailer).catch((e) => console.error("alert check failed", e));
      res.json({ ok: true });
    }),
  );

  /** Approves every pending timer entry except the reviewer's own. */
  r.post(
    "/approve-timer-entries",
    requireRole(canApprove),
    handler(async (req, res) => {
      const done = await db.query<{ id: string }>(
        `update entries set status = 'approved', reviewer_id = $1, review_note = '', reviewed_at = now()
         where status = 'pending' and method = 'timer' and staff_id <> $1 returning id`,
        [req.user!.id],
      );
      await audit(db, req.user!.id, "approve-all-timer", "entry", null, { count: done.rowCount, ids: done.rows.map((x) => x.id) });
      if (done.rowCount) await checkAlerts(db, mailer).catch((e) => console.error("alert check failed", e));
      res.json({ count: done.rowCount });
    }),
  );

  return r;
}
