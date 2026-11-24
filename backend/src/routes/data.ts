import { Router } from "express";
import type { AppContext } from "../app.js";
import { requireAuth } from "../auth.js";
import { handler } from "../http.js";
import { canLogTime, cycleIndexAt, cycleStartYmd, dayNumberOfYmd, isAdmin, seesEverything } from "../rules.js";
import { loadSettings } from "../settings.js";

interface EntryRow {
  id: string;
  staff_id: string;
  project_id: string;
  task: string;
  note: string;
  proof: string;
  started_at: Date;
  ended_at: Date;
  minutes: number;
  method: "timer" | "manual";
  manual_reason: string;
  status: "pending" | "approved" | "rejected";
  reviewer_id: string | null;
  review_note: string;
  reviewed_at: Date | null;
  created_at: Date;
  logged_by: string | null;
}

/** How many cycles of entries a screen asks for by default: the current one and the one before. */
const DEFAULT_CYCLES_BACK = 2;
/** About two years of fortnightly cycles. Stops a huge or silly `back` value from loading everything. */
const MAX_CYCLES_BACK = 52;

/**
 * Everything a signed-in person is allowed to see, in the shape the screens already use.
 * The scoping happens here, on the server:
 *  - client: approved entries only, without internal review details
 *  - staff: their own entries in full; other people's approved entries as hours only (no notes or links)
 *  - manager / CEO / admin: everything
 */
export function dataRoutes({ db, env }: AppContext) {
  const r = Router();

  r.get(
    "/",
    requireAuth(db, env.JWT_SECRET),
    handler(async (req, res) => {
      const me = req.user!;
      const role = me.appRole;
      const settings = await loadSettings(db);

      // Entries are fetched a cycle at a time rather than all at once, so the reply stays the same size
      // in a year as it is today. Screens ask for more when someone looks further back (`?back=N`).
      const asked = Number.parseInt(String(req.query.back ?? ""), 10);
      const back = Math.min(Math.max(Number.isFinite(asked) ? asked : DEFAULT_CYCLES_BACK, 1), MAX_CYCLES_BACK);
      const oldestCycle = cycleIndexAt(settings, new Date()) - (back - 1);
      // One day of slack: entries are filtered by instant here, but a cycle starts at local midnight,
      // which is up to a day away from the UTC day boundary.
      const from = new Date((dayNumberOfYmd(cycleStartYmd(settings, oldestCycle)) - 1) * 86_400_000);

      const [departments, users, projects, workTypes, entries, timer, extensions] = await Promise.all([
        db.query<{ id: string; name: string; colour: number; allocated_hours: number | null }>("select id, name, colour, allocated_hours from departments order by colour, name"),
        db.query<{ id: string; name: string; job_title: string; department_id: string | null; app_role: string; active: boolean; email: string; invited: boolean }>(
          "select id, name, job_title, department_id, app_role, active, email, (password_hash is null) as invited from users where app_role <> 'client' order by name",
        ),
        db.query<{ id: string; name: string; active: boolean }>("select id, name, active from projects order by name"),
        db.query<{ name: string }>("select name from work_types order by name"),
        role === "client"
          ? db.query<EntryRow>("select * from entries where status = 'approved' and started_at >= $1 order by started_at", [from])
          : // Anything still waiting is always included, however old, so it can never be lost from the Approvals screen.
            db.query<EntryRow>("select * from entries where started_at >= $1 or status = 'pending' order by started_at", [from]),
        canLogTime(role)
          ? db.query<{ project_id: string; task: string; note: string; proof: string; started_at: Date; acc_ms: number; running: boolean }>(
              "select project_id, task, note, proof, started_at, acc_ms, running from timers where staff_id = $1",
              [me.id],
            )
          : Promise.resolve({ rows: [], rowCount: 0 }),
        db.query<{ id: string; cycle_start: string; hours: number; reason: string; created_by: string; created_at: Date }>(
          "select id, cycle_start, hours, reason, created_by, created_at from hour_extensions order by created_at",
        ),
      ]);

      const seeAll = seesEverything(role);
      const shaped = entries.rows
        .filter((e) => seeAll || role === "client" || e.staff_id === me.id || e.status === "approved")
        .map((e) => {
          const own = e.staff_id === me.id;
          const full = seeAll || own;
          return {
            id: e.id,
            staffId: e.staff_id,
            projectId: e.project_id,
            task: e.task,
            // The client reads the work description; other staff only see the hours.
            note: full || role === "client" ? e.note : "",
            proof: full || role === "client" ? e.proof : "",
            start: e.started_at.toISOString(),
            end: e.ended_at.toISOString(),
            minutes: e.minutes,
            method: e.method,
            reason: full ? e.manual_reason : "",
            status: e.status,
            reviewerId: full ? e.reviewer_id : null,
            reviewNote: full ? e.review_note : "",
            reviewedAt: full ? (e.reviewed_at?.toISOString() ?? null) : null,
            createdAt: e.created_at.toISOString(),
            loggedById: full ? e.logged_by : null,
          };
        });

      const t = timer.rows[0];
      res.json({
        serverNow: Date.now(),
        me,
        data: {
          settings: {
            clientName: settings.clientName,
            budgetHours: settings.budgetHours,
            cycleDays: settings.cycleDays,
            minTimerMinutes: settings.minTimerMinutes,
            // Lets the screens say this is a trial with sample data.
            demo: env.DEMO_DATA === "1",
            anchor: settings.cycleAnchor,
            timezone: settings.timezone,
            sample: false,
          },
          departments: departments.rows.map((d) => ({ id: d.id, name: d.name, c: d.colour, hours: d.allocated_hours })),
          extensions: extensions.rows.map((x) => ({ id: x.id, cycleStart: x.cycle_start, hours: x.hours, reason: x.reason, by: x.created_by, at: x.created_at.toISOString() })),
          staff: users.rows.map((u) => ({
            id: u.id,
            name: u.name,
            role: u.job_title,
            dept: u.department_id ?? "",
            active: u.active,
            appRole: u.app_role,
            // Email addresses are only for admins (and are shown to each person for themselves).
            ...(isAdmin(role) ? { email: u.email, invited: u.invited } : {}),
          })),
          projects: projects.rows.map((p) => ({ id: p.id, name: p.name, active: p.active })),
          tasks: workTypes.rows.map((w) => w.name),
          entries: shaped,
          timers: t
            ? { [me.id]: { projectId: t.project_id, task: t.task, note: t.note, proof: t.proof, startedAt: t.started_at.getTime(), accMs: t.acc_ms, running: t.running } }
            : {},
        },
      });
    }),
  );

  return r;
}
