import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { audit } from "../audit.js";
import type { AppContext } from "../app.js";
import { requireAuth, requireRole } from "../auth.js";
import { HttpError, handler, parse } from "../http.js";
import { isDemoEmail } from "../demo.js";
import { issueSetPasswordLink } from "../invites.js";
import { APP_ROLES, isAdmin } from "../rules.js";

const roleEnum = z.enum(APP_ROLES as [string, ...string[]]);
const email = z.string().trim().toLowerCase().email();
const shortId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;


export function adminRoutes({ db, env, mailer }: AppContext) {
  const r = Router();
  r.use(requireAuth(db, env.JWT_SECRET), requireRole(isAdmin));

  const settingsBody = z.object({
    clientName: z.string().trim().min(1, "Add the client name.").max(200),
    budgetHours: z.number().positive("Hours per cycle must be more than 0."),
    cycleDays: z.number().int().min(1).max(62),
    minTimerMinutes: z.number().int().min(1).max(240).default(1),
    anchor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first day of a cycle."),
  });

  r.put(
    "/settings",
    handler(async (req, res) => {
      const b = parse(settingsBody, req.body);
      const before = await db.query("select client_name, budget_hours, cycle_days, cycle_anchor, min_timer_minutes from settings where id = 1");
      await db.query(
        "update settings set client_name = $1, budget_hours = $2, cycle_days = $3, cycle_anchor = $4, min_timer_minutes = $5 where id = 1",
        [b.clientName, b.budgetHours, b.cycleDays, b.anchor, b.minTimerMinutes],
      );
      await audit(db, req.user!.id, "update", "settings", "1", { before: before.rows[0], after: b });
      res.json({ ok: true });
    }),
  );

  // ---------- People ----------

  const userBody = z.object({
    name: z.string().trim().min(1, "Add the person's name.").max(200),
    email,
    jobTitle: z.string().trim().max(200).default(""),
    departmentId: z.string().nullable().default(null),
    appRole: roleEnum.default("staff"),
  });

  r.post(
    "/users",
    handler(async (req, res) => {
      const b = parse(userBody, req.body);
      const id = randomUUID();
      await db.query("insert into users (id, email, name, job_title, department_id, app_role) values ($1, $2, $3, $4, $5, $6)", [
        id,
        b.email,
        b.name,
        b.jobTitle,
        b.departmentId,
        b.appRole,
      ]);
      await audit(db, req.user!.id, "create", "user", id, { email: b.email, appRole: b.appRole });
      const invite = await issueSetPasswordLink(db, mailer, env.APP_URL, { id, email: b.email, name: b.name }, "invite");
      res.status(201).json({ id, ...invite });
    }),
  );

  const patchBody = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    jobTitle: z.string().trim().max(200).optional(),
    departmentId: z.string().nullable().optional(),
    appRole: roleEnum.optional(),
    active: z.boolean().optional(),
  });

  /** In trial mode, a demo admin can play with the demo accounts but must not deactivate or reset a real person. */
  const guardDemo = async (actorEmail: string, targetId: string) => {
    if (env.DEMO_DATA !== "1" || !isDemoEmail(actorEmail)) return;
    const t = await db.query<{ email: string }>("select email from users where id = $1", [targetId]);
    const email = t.rows[0]?.email;
    if (email && !isDemoEmail(email)) throw new HttpError(403, "Demo accounts cannot change real accounts.");
  };

  r.patch(
    "/users/:id",
    handler(async (req, res) => {
      const id = String(req.params.id);
      await guardDemo(req.user!.email, id);
      const b = parse(patchBody, req.body);
      await db.tx(async (t) => {
        const { rows } = await t.query<{ app_role: string; active: boolean }>("select app_role, active from users where id = $1 for update", [id]);
        const current = rows[0];
        if (!current) throw new HttpError(404, "That person does not exist.");
        const losesAdmin = current.app_role === "admin" && current.active && ((b.appRole && b.appRole !== "admin") || b.active === false);
        if (losesAdmin) {
          if (id === req.user!.id) throw new HttpError(400, "You cannot remove your own admin access.");
          const others = await t.query("select 1 from users where app_role = 'admin' and active and id <> $1", [id]);
          if (!others.rowCount) throw new HttpError(400, "There must always be at least one active admin.");
        }
        await t.query(
          `update users set name = coalesce($1, name), job_title = coalesce($2, job_title),
             department_id = case when $3::boolean then $4 else department_id end,
             app_role = coalesce($5, app_role), active = coalesce($6, active) where id = $7`,
          [b.name ?? null, b.jobTitle ?? null, b.departmentId !== undefined, b.departmentId ?? null, b.appRole ?? null, b.active ?? null, id],
        );
      });
      await audit(db, req.user!.id, "update", "user", id, b);
      res.json({ ok: true });
    }),
  );

  /** A fresh set-password link, for a person who lost their invite or forgot their password. */
  r.post(
    "/users/:id/invite",
    handler(async (req, res) => {
      const id = String(req.params.id);
      await guardDemo(req.user!.email, id);
      const { rows } = await db.query<{ id: string; email: string; name: string; password_hash: string | null }>(
        "select id, email, name, password_hash from users where id = $1 and active",
        [id],
      );
      const u = rows[0];
      if (!u) throw new HttpError(404, "That person does not exist or is not active.");
      const invite = await issueSetPasswordLink(db, mailer, env.APP_URL, u, u.password_hash ? "reset" : "invite");
      await audit(db, req.user!.id, "invite", "user", id);
      res.json(invite);
    }),
  );

  // ---------- Departments, projects, work types ----------

  r.post(
    "/departments",
    handler(async (req, res) => {
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
      const id = shortId("d");
      const count = await db.query<{ n: number }>("select count(*)::int as n from departments");
      await db.query("insert into departments (id, name, colour) values ($1, $2, $3)", [id, name, count.rows[0]!.n]);
      await audit(db, req.user!.id, "create", "department", id, { name });
      res.status(201).json({ id });
    }),
  );

  /** Rename a department, or set the hours it is allocated within the client's total (null clears it). */
  r.patch(
    "/departments/:id",
    handler(async (req, res) => {
      const id = String(req.params.id);
      const b = parse(z.object({ name: z.string().trim().min(1).max(100).optional(), allocatedHours: z.number().min(0).max(10_000).nullable().optional() }), req.body);
      const upd = await db.query(
        "update departments set name = coalesce($1, name), allocated_hours = case when $2::boolean then $3 else allocated_hours end where id = $4",
        [b.name ?? null, b.allocatedHours !== undefined, b.allocatedHours ?? null, id],
      );
      if (!upd.rowCount) throw new HttpError(404, "That department does not exist.");
      await audit(db, req.user!.id, "update", "department", id, b);
      res.json({ ok: true });
    }),
  );

  r.post(
    "/projects",
    handler(async (req, res) => {
      const { name } = parse(z.object({ name: z.string().trim().min(1).max(200) }), req.body);
      const id = shortId("p");
      await db.query("insert into projects (id, name) values ($1, $2)", [id, name]);
      await audit(db, req.user!.id, "create", "project", id, { name });
      res.status(201).json({ id });
    }),
  );

  r.patch(
    "/projects/:id",
    handler(async (req, res) => {
      const id = String(req.params.id);
      const b = parse(z.object({ name: z.string().trim().min(1).max(200).optional(), active: z.boolean().optional() }), req.body);
      const upd = await db.query("update projects set name = coalesce($1, name), active = coalesce($2, active) where id = $3", [b.name ?? null, b.active ?? null, id]);
      if (!upd.rowCount) throw new HttpError(404, "That project does not exist.");
      await audit(db, req.user!.id, "update", "project", id, b);
      res.json({ ok: true });
    }),
  );

  // ---------- One-off import (the JSON from docs/AIRTABLE-PROMPT.md, now with an email per person) ----------

  const named = z.union([z.string(), z.object({ name: z.string() })]).transform((x) => (typeof x === "string" ? x : x.name).trim());
  const importBody = z.object({
    clientName: z.string().trim().min(1).optional(),
    departments: z.array(named).default([]),
    staff: z
      .array(z.object({ name: z.string().trim().min(1), email: z.string().trim().toLowerCase().optional(), role: z.string().trim().default(""), department: z.string().trim().optional(), appRole: roleEnum.optional() }))
      .min(1, "The JSON needs a staff list with at least one person.")
      .max(300),
    projects: z.array(named).default([]),
  });

  r.post(
    "/import",
    handler(async (req, res) => {
      const b = parse(importBody, req.body);
      const out = await db.tx(async (t) => {
        const deptIds = new Map<string, string>();
        const existing = await t.query<{ id: string; name: string }>("select id, name from departments");
        existing.rows.forEach((d) => deptIds.set(d.name.toLowerCase(), d.id));
        const deptFor = async (name: string | undefined) => {
          const n = (name || "").trim();
          if (!n) return null;
          const key = n.toLowerCase();
          let id = deptIds.get(key);
          if (!id) {
            id = shortId("d");
            await t.query("insert into departments (id, name, colour) values ($1, $2, $3)", [id, n, deptIds.size]);
            deptIds.set(key, id);
          }
          return id;
        };
        for (const d of b.departments) await deptFor(d);

        const created: Array<{ id: string; email: string; name: string }> = [];
        const skipped: Array<{ name: string; reason: string }> = [];
        for (const p of b.staff) {
          const parsedEmail = email.safeParse(p.email ?? "");
          if (!parsedEmail.success) {
            skipped.push({ name: p.name, reason: "No valid email address" });
            continue;
          }
          const exists = await t.query("select 1 from users where email = $1", [parsedEmail.data]);
          if (exists.rowCount) {
            skipped.push({ name: p.name, reason: "Already has an account" });
            continue;
          }
          const id = randomUUID();
          await t.query("insert into users (id, email, name, job_title, department_id, app_role) values ($1, $2, $3, $4, $5, $6)", [
            id,
            parsedEmail.data,
            p.name,
            p.role,
            await deptFor(p.department),
            p.appRole ?? "staff",
          ]);
          created.push({ id, email: parsedEmail.data, name: p.name });
        }

        let projects = 0;
        for (const name of b.projects.filter(Boolean)) {
          const made = await t.query("insert into projects (id, name) values ($1, $2) on conflict (name) do nothing", [shortId("p"), name]);
          projects += made.rowCount;
        }
        if (b.clientName) await t.query("update settings set client_name = $1 where id = 1", [b.clientName]);
        return { created, skipped, projects };
      });

      // Invites go out after the data is saved, so a mail problem cannot undo the import.
      const invites = [];
      for (const u of out.created) invites.push({ ...u, ...(await issueSetPasswordLink(db, mailer, env.APP_URL, u, "invite")) });
      await audit(db, req.user!.id, "import", "team", null, { people: out.created.length, skipped: out.skipped.length, projects: out.projects });
      res.status(201).json({ people: out.created.length, projects: out.projects, skipped: out.skipped, invites });
    }),
  );

  return r;
}
