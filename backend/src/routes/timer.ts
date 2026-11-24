import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import type { AppContext } from "../app.js";
import { requireAuth, requireRole } from "../auth.js";
import { HttpError, handler, parse } from "../http.js";
import { canLogTime, elapsedMs, validateNote, validateProof } from "../rules.js";
import { loadSettings } from "../settings.js";

interface TimerRow {
  staff_id: string;
  project_id: string;
  task: string;
  note: string;
  proof: string;
  started_at: Date;
  acc_ms: number;
  running: boolean;
}

export function timerRoutes({ db, env }: AppContext) {
  const r = Router();
  r.use(requireAuth(db, env.JWT_SECRET), requireRole(canLogTime));

  const startBody = z.object({
    projectId: z.string().min(1),
    task: z.string().min(1),
    note: z.string().max(2000).default(""),
    proof: z.string().max(2000).default(""),
  });

  r.post(
    "/",
    handler(async (req, res) => {
      const b = parse(startBody, req.body);
      const [project, task] = await Promise.all([
        db.query("select 1 from projects where id = $1 and active", [b.projectId]),
        db.query("select 1 from work_types where name = $1", [b.task]),
      ]);
      if (!project.rowCount) throw new HttpError(400, "Pick a project from the list.", "projectId");
      if (!task.rowCount) throw new HttpError(400, "Pick a type of work from the list.", "task");
      const made = await db.query(
        "insert into timers (staff_id, project_id, task, note, proof, started_at, acc_ms, running) values ($1, $2, $3, $4, $5, now(), 0, true) on conflict do nothing",
        [req.user!.id, b.projectId, b.task, b.note, b.proof],
      );
      if (!made.rowCount) throw new HttpError(409, "You already have a timer. Stop or discard it first.");
      res.status(201).json({ ok: true });
    }),
  );

  r.post(
    "/pause",
    handler(async (req, res) => {
      await db.query(
        "update timers set acc_ms = acc_ms + extract(epoch from (now() - started_at)) * 1000, running = false where staff_id = $1 and running",
        [req.user!.id],
      );
      res.json({ ok: true });
    }),
  );

  r.post(
    "/resume",
    handler(async (req, res) => {
      await db.query("update timers set started_at = now(), running = true where staff_id = $1 and not running", [req.user!.id]);
      res.json({ ok: true });
    }),
  );

  r.patch(
    "/",
    handler(async (req, res) => {
      const b = parse(z.object({ note: z.string().max(2000).optional(), proof: z.string().max(2000).optional() }), req.body);
      await db.query("update timers set note = coalesce($1, note), proof = coalesce($2, proof) where staff_id = $3", [b.note ?? null, b.proof ?? null, req.user!.id]);
      res.json({ ok: true });
    }),
  );

  r.delete(
    "/",
    handler(async (req, res) => {
      await db.query("delete from timers where staff_id = $1", [req.user!.id]);
      res.json({ ok: true });
    }),
  );

  /** Turns the running timer into a pending entry. The server clock decides the time, not the browser. */
  r.post(
    "/stop",
    handler(async (req, res) => {
      const b = parse(z.object({ note: z.string().max(2000), proof: z.string().max(2000).default("") }), req.body);
      const note = b.note.trim();
      const proof = b.proof.trim();
      const badNote = validateNote(note);
      if (badNote) throw new HttpError(400, "Write a short note on what you did before you submit.", "t-note");
      const badProof = validateProof(proof);
      if (badProof) throw new HttpError(400, badProof.message, "t-proof");

      const out = await db.tx(async (t) => {
        const { rows } = await t.query<TimerRow>("select * from timers where staff_id = $1 for update", [req.user!.id]);
        const timer = rows[0];
        if (!timer) throw new HttpError(404, "There is no timer to stop.");
        const now = new Date();
        const minutes = Math.round(elapsedMs({ startedAt: timer.started_at, accMs: timer.acc_ms, running: timer.running }, now) / 60000);
        const { minTimerMinutes } = await loadSettings(t);
        if (minutes < minTimerMinutes) {
          throw new HttpError(400, `A timer has to run for at least ${minTimerMinutes} ${minTimerMinutes === 1 ? "minute" : "minutes"} before you submit it. Keep it running, or discard it.`);
        }
        const id = randomUUID();
        const start = new Date(now.getTime() - minutes * 60000);
        await t.query(
          `insert into entries (id, staff_id, project_id, task, note, proof, started_at, ended_at, minutes, method)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'timer')`,
          [id, req.user!.id, timer.project_id, timer.task, note, proof, start, now, minutes],
        );
        await t.query("delete from timers where staff_id = $1", [req.user!.id]);
        return { id, minutes };
      });
      await audit(db, req.user!.id, "submit", "entry", out.id, { method: "timer", minutes: out.minutes });
      res.status(201).json(out);
    }),
  );

  return r;
}
