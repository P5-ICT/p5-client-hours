import { beforeAll, describe, expect, it } from "vitest";
import { checkAlerts } from "../src/jobs/alerts.js";
import { createHarness, insertEntry, type Harness } from "./helpers.js";

let h: Harness;
let staff: Awaited<ReturnType<Harness["user"]>>;
let staff2: Awaited<ReturnType<Harness["user"]>>;
let manager: Awaited<ReturnType<Harness["user"]>>;
let manager2: Awaited<ReturnType<Harness["user"]>>;
let client: Awaited<ReturnType<Harness["user"]>>;
let admin: Awaited<ReturnType<Harness["user"]>>;

beforeAll(async () => {
  h = await createHarness();
  staff = await h.user("staff", "Sam Staff");
  staff2 = await h.user("staff", "Sue Staff");
  manager = await h.user("manager", "Mia Manager");
  manager2 = await h.user("manager", "Max Manager");
  client = await h.user("client", "Cleo Client");
  admin = await h.user("admin", "Ada Admin");
});

const data = (token: string) => h.api.get("/api/data").set(h.as(token));

describe("signing in", () => {
  it("rejects missing and bad tokens", async () => {
    expect((await h.api.get("/api/data")).status).toBe(401);
    expect((await h.api.get("/api/data").set(h.as("garbage"))).status).toBe(401);
  });

  it("logs in with the right password only", async () => {
    const ok = await h.api.post("/api/auth/login").send({ email: staff.email.toUpperCase(), password: "a-long-password-1" });
    expect(ok.status).toBe(200);
    expect(ok.body.user.appRole).toBe("staff");
    const bad = await h.api.post("/api/auth/login").send({ email: staff.email, password: "wrong-password-1" });
    expect(bad.status).toBe(401);
    const unknown = await h.api.post("/api/auth/login").send({ email: "nobody@example.com", password: "wrong-password-1" });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(bad.body.error);
  });

  it("lets an invited person set a password once", async () => {
    const made = await h.api.post("/api/admin/users").set(h.as(admin.token)).send({ name: "New Person", email: "New.Person@example.com", jobTitle: "Designer" });
    expect(made.status).toBe(201);
    const token = new URL(made.body.link).searchParams.get("token")!;
    expect((await h.api.post("/api/auth/login").send({ email: "new.person@example.com", password: "a-long-password-1" })).status).toBe(401);

    expect((await h.api.post("/api/auth/set-password").send({ token, password: "short" })).status).toBe(400);
    const set = await h.api.post("/api/auth/set-password").send({ token, password: "my-new-password-1" });
    expect(set.status).toBe(200);
    expect((await h.api.get("/api/data").set(h.as(set.body.token))).status).toBe(200);
    // The link is single use.
    expect((await h.api.post("/api/auth/set-password").send({ token, password: "another-password-1" })).status).toBe(400);
    expect(h.mailer.sent.some((m) => m.to[0] === "new.person@example.com")).toBe(true);
  });

  it("stops a deactivated person at once, even with a valid token", async () => {
    const temp = await h.user("staff", "Leaver");
    expect((await data(temp.token)).status).toBe(200);
    await h.db.query("update users set active = false where id = $1", [temp.id]);
    expect((await data(temp.token)).status).toBe(401);
  });
});

describe("timer", () => {
  it("survives between calls, and turns into a pending entry on stop", async () => {
    const start = await h.api.post("/api/timer").set(h.as(staff.token)).send({ projectId: h.projectId, task: "Development" });
    expect(start.status).toBe(201);
    expect((await h.api.post("/api/timer").set(h.as(staff.token)).send({ projectId: h.projectId, task: "Development" })).status).toBe(409);

    // Another device sees the same running timer.
    const seen = await data(staff.token);
    expect(seen.body.data.timers[staff.id].running).toBe(true);
    expect((await data(staff2.token)).body.data.timers).toEqual({});

    // Pretend 30 minutes went by.
    await h.db.query("update timers set started_at = now() - interval '30 minutes' where staff_id = $1", [staff.id]);
    const tooShort = await h.api.post("/api/timer/stop").set(h.as(staff.token)).send({ note: "x" });
    expect(tooShort.status).toBe(400);

    const stop = await h.api.post("/api/timer/stop").set(h.as(staff.token)).send({ note: "Built the payment page" });
    expect(stop.status).toBe(201);
    expect(stop.body.minutes).toBe(30);
    const after = await data(staff.token);
    expect(after.body.data.timers).toEqual({});
    const entry = after.body.data.entries.find((e: { id: string }) => e.id === stop.body.id);
    expect(entry).toMatchObject({ status: "pending", method: "timer", minutes: 30, staffId: staff.id });
  });

  it("keeps paused time out of the total", async () => {
    await h.api.post("/api/timer").set(h.as(staff2.token)).send({ projectId: h.projectId, task: "Design" });
    await h.db.query("update timers set started_at = now() - interval '20 minutes' where staff_id = $1", [staff2.id]);
    await h.api.post("/api/timer/pause").set(h.as(staff2.token));
    await h.db.query("update timers set started_at = now() - interval '3 hours' where staff_id = $1", [staff2.id]); // time spent paused
    const stop = await h.api.post("/api/timer/stop").set(h.as(staff2.token)).send({ note: "Design review" });
    expect(stop.body.minutes).toBe(20);
  });

  it("is not open to the client", async () => {
    expect((await h.api.post("/api/timer").set(h.as(client.token)).send({ projectId: h.projectId, task: "Development" })).status).toBe(403);
  });

  it("rejects an unsafe proof link", async () => {
    await h.api.post("/api/timer").set(h.as(staff.token)).send({ projectId: h.projectId, task: "Development" });
    await h.db.query("update timers set started_at = now() - interval '5 minutes' where staff_id = $1", [staff.id]);
    const r = await h.api.post("/api/timer/stop").set(h.as(staff.token)).send({ note: "Fixed bugs", proof: "javascript:alert(1)" });
    expect(r.status).toBe(400);
    await h.api.delete("/api/timer").set(h.as(staff.token));
  });
});

describe("typed-in hours", () => {
  const manual = (over: Record<string, unknown> = {}) => {
    const end = new Date(Date.now() - 10 * 60_000);
    return { projectId: h.projectId, task: "Meetings", note: "Client workshop", reason: "Off-site, no laptop", start: new Date(end.getTime() - 45 * 60_000), end, ...over };
  };

  it("accepts a valid entry as pending", async () => {
    const r = await h.api.post("/api/entries").set(h.as(staff.token)).send(manual());
    expect(r.status).toBe(201);
    expect(r.body.minutes).toBe(45);
  });

  it("needs a reason and a note", async () => {
    expect((await h.api.post("/api/entries").set(h.as(staff.token)).send(manual({ reason: " " }))).status).toBe(400);
    expect((await h.api.post("/api/entries").set(h.as(staff.token)).send(manual({ note: "hi" }))).status).toBe(400);
  });

  it("rejects the future, a backwards range, and a closed cycle", async () => {
    const future = new Date(Date.now() + 3 * 3600_000);
    expect((await h.api.post("/api/entries").set(h.as(staff.token)).send(manual({ start: new Date(), end: future }))).status).toBe(400);
    const e = new Date(Date.now() - 60_000);
    expect((await h.api.post("/api/entries").set(h.as(staff.token)).send(manual({ start: e, end: new Date(e.getTime() - 3600_000) }))).status).toBe(400);
    const old = new Date(Date.now() - 40 * 86400_000);
    expect((await h.api.post("/api/entries").set(h.as(staff.token)).send(manual({ start: old, end: new Date(old.getTime() + 3600_000) }))).status).toBe(400);
  });

  it("is not open to the client", async () => {
    expect((await h.api.post("/api/entries").set(h.as(client.token)).send(manual())).status).toBe(403);
  });
});

describe("approvals", () => {
  it("only managers and the CEO can approve", async () => {
    const id = await insertEntry(h, staff.id);
    const review = (token: string) => h.api.post(`/api/entries/${id}/review`).set(h.as(token)).send({ status: "approved" });
    expect((await review(staff2.token)).status).toBe(403);
    expect((await review(client.token)).status).toBe(403);
    expect((await review(admin.token)).status).toBe(403);
    expect((await review(manager.token)).status).toBe(200);
    // Already final.
    expect((await review(manager2.token)).status).toBe(409);
  });

  it("never lets someone approve their own hours", async () => {
    const id = await insertEntry(h, manager.id);
    const r = await h.api.post(`/api/entries/${id}/review`).set(h.as(manager.token)).send({ status: "approved" });
    expect(r.status).toBe(403);
    expect((await h.api.post(`/api/entries/${id}/review`).set(h.as(manager2.token)).send({ status: "approved" })).status).toBe(200);
  });

  it("also blocks self-approval at the database level", async () => {
    const id = await insertEntry(h, manager.id);
    await expect(
      h.db.query("update entries set status = 'approved', reviewer_id = $1 where id = $2", [manager.id, id]),
    ).rejects.toThrow();
  });

  it("needs a reason to reject, and rejection is final", async () => {
    const id = await insertEntry(h, staff.id);
    expect((await h.api.post(`/api/entries/${id}/review`).set(h.as(manager.token)).send({ status: "rejected" })).status).toBe(400);
    const rej = await h.api.post(`/api/entries/${id}/review`).set(h.as(manager.token)).send({ status: "rejected", note: "Wrong project" });
    expect(rej.status).toBe(200);
    expect((await h.api.post(`/api/entries/${id}/review`).set(h.as(manager.token)).send({ status: "approved" })).status).toBe(409);
  });

  it("approve-all skips the reviewer's own entries", async () => {
    await h.db.query("delete from entries where status = 'pending'");
    await insertEntry(h, staff.id);
    await insertEntry(h, staff2.id);
    await insertEntry(h, manager.id);
    await insertEntry(h, staff.id, { method: "manual" });
    const r = await h.api.post("/api/entries/approve-timer-entries").set(h.as(manager.token));
    expect(r.body.count).toBe(2);
    const left = await h.db.query<{ staff_id: string; method: string }>("select staff_id, method from entries where status = 'pending' order by method");
    expect(left.rows.map((x) => `${x.staff_id === manager.id ? "manager" : "staff"}:${x.method}`)).toEqual(["staff:manual", "manager:timer"]);
    expect((await h.api.post("/api/entries/approve-timer-entries").set(h.as(staff.token))).status).toBe(403);
  });
});

describe("reviewed entries are final", () => {
  it("cannot be deleted by staff or changed in the database", async () => {
    const id = await insertEntry(h, staff.id);
    await h.api.post(`/api/entries/${id}/review`).set(h.as(manager.token)).send({ status: "approved" });
    expect((await h.api.delete(`/api/entries/${id}`).set(h.as(staff.token))).status).toBe(404);
    await expect(h.db.query("update entries set minutes = 999, ended_at = ended_at + interval '939 minutes' where id = $1", [id])).rejects.toThrow();
    await expect(h.db.query("update entries set note = 'edited after approval' where id = $1", [id])).rejects.toThrow();
    await expect(h.db.query("delete from entries where id = $1", [id])).rejects.toThrow();
  });

  it("lets staff delete only their own pending entries", async () => {
    const mine = await insertEntry(h, staff.id);
    const theirs = await insertEntry(h, staff2.id);
    expect((await h.api.delete(`/api/entries/${theirs}`).set(h.as(staff.token))).status).toBe(404);
    expect((await h.api.delete(`/api/entries/${mine}`).set(h.as(staff.token))).status).toBe(200);
  });

  it("cannot be created as approved, whatever the caller asks", async () => {
    const id = await insertEntry(h, staff.id);
    const row = await h.db.query<{ status: string }>("select status from entries where id = $1", [id]);
    expect(row.rows[0]!.status).toBe("pending");
    // Even an insert that asks for 'approved' with a reviewer is forced back to pending.
    await h.db.query(
      `insert into entries (id, staff_id, project_id, task, note, started_at, ended_at, minutes, method, status, reviewer_id)
       values ('sneaky', $1, $2, 'Admin', 'Sneaky entry', now() - interval '1 hour', now(), 60, 'timer', 'approved', $3)`,
      [staff.id, h.projectId, manager.id],
    );
    const sneaky = await h.db.query<{ status: string; reviewer_id: string | null }>("select status, reviewer_id from entries where id = 'sneaky'");
    expect(sneaky.rows[0]).toEqual({ status: "pending", reviewer_id: null });
  });
});

describe("who sees what", () => {
  let pendingId: string;
  let approvedId: string;

  beforeAll(async () => {
    await h.db.query("delete from entries where status = 'pending'");
    pendingId = await insertEntry(h, staff2.id, { method: "manual" });
    approvedId = await insertEntry(h, staff2.id);
    await h.api.post(`/api/entries/${approvedId}/review`).set(h.as(manager.token)).send({ status: "approved" });
  });

  const ids = (body: { data: { entries: Array<{ id: string }> } }) => body.data.entries.map((e) => e.id);

  it("shows the client approved hours only, without internal details", async () => {
    const r = await data(client.token);
    expect(r.status).toBe(200);
    expect(ids(r.body)).toContain(approvedId);
    expect(ids(r.body)).not.toContain(pendingId);
    expect(r.body.data.entries.every((e: { status: string }) => e.status === "approved")).toBe(true);
    const e = r.body.data.entries.find((x: { id: string }) => x.id === approvedId);
    expect(e).toMatchObject({ reason: "", reviewNote: "", reviewerId: null });
    expect(e.note).toBe("Built the page");
    expect(r.body.data.timers).toEqual({});
    expect(r.body.data.staff.every((s: { email?: string }) => s.email === undefined)).toBe(true);
  });

  it("shows staff their own entries in full, and others' approved hours without notes", async () => {
    const r = await data(staff.token);
    expect(ids(r.body)).not.toContain(pendingId); // someone else's pending entry
    const other = r.body.data.entries.find((x: { id: string }) => x.id === approvedId);
    expect(other).toMatchObject({ note: "", proof: "", reason: "", reviewNote: "" });
    expect(other.minutes).toBe(60);
    const own = r.body.data.entries.filter((x: { staffId: string }) => x.staffId === staff.id);
    expect(own.every((x: { note: string }) => x.note.length > 0)).toBe(true);
  });

  it("shows managers everything", async () => {
    const r = await data(manager.token);
    expect(ids(r.body)).toEqual(expect.arrayContaining([pendingId, approvedId]));
  });

  it("shows email addresses to admins only", async () => {
    expect((await data(admin.token)).body.data.staff.some((s: { email?: string }) => !!s.email)).toBe(true);
    expect((await data(manager.token)).body.data.staff.some((s: { email?: string }) => !!s.email)).toBe(false);
  });
});

describe("admin", () => {
  it("is closed to everyone else", async () => {
    const body = { clientName: "X", budgetHours: 10, cycleDays: 14, anchor: "2026-10-05" };
    for (const t of [staff, manager, client]) expect((await h.api.put("/api/admin/settings").set(h.as(t.token)).send(body)).status).toBe(403);
    expect((await h.api.put("/api/admin/settings").set(h.as(admin.token)).send(body)).status).toBe(200);
    expect((await h.api.put("/api/admin/settings").set(h.as(admin.token)).send({ ...body, budgetHours: 0 })).status).toBe(400);
    await h.db.query("update settings set client_name = 'Test Client', cycle_anchor = to_char(current_date - 2, 'YYYY-MM-DD'), budget_hours = 10");
  });

  it("keeps at least one active admin", async () => {
    const solo = await h.api.patch(`/api/admin/users/${admin.id}`).set(h.as(admin.token)).send({ active: false });
    expect(solo.status).toBe(400);
    const other = await h.user("admin", "Second Admin");
    expect((await h.api.patch(`/api/admin/users/${other.id}`).set(h.as(admin.token)).send({ active: false })).status).toBe(200);
  });

  it("imports people, skipping those without an email or already registered", async () => {
    const r = await h.api
      .post("/api/admin/import")
      .set(h.as(admin.token))
      .send({
        clientName: "Imported Client",
        departments: [{ name: "ICT" }, "Marketing"],
        staff: [
          { name: "Ann", email: "ann@example.com", role: "Developer", department: "ICT" },
          { name: "No Email", role: "Designer", department: "Marketing" },
          { name: "Ann Again", email: "ANN@example.com", department: "ICT" },
        ],
        projects: [{ name: "Portal" }, "Website"],
      });
    expect(r.status).toBe(201);
    expect(r.body.people).toBe(1);
    expect(r.body.projects).toBe(1); // "Website" already exists
    expect(r.body.skipped.map((s: { name: string }) => s.name).sort()).toEqual(["Ann Again", "No Email"]);
    expect(r.body.invites[0].link).toMatch(/set-password\?token=/);
    const depts = await h.db.query("select 1 from departments");
    expect(depts.rowCount).toBe(2);
    await h.db.query("update settings set client_name = 'Test Client'");
  });

  it("writes an audit trail", async () => {
    const log = await h.db.query<{ action: string }>("select action from audit_log");
    const actions = new Set(log.rows.map((x) => x.action));
    for (const a of ["approve", "reject", "approve-all-timer", "submit", "delete", "update", "import"]) expect(actions).toContain(a);
  });
});

describe("alerts to managers", () => {
  it("emails once at 80% and once at 100% of approved hours", async () => {
    // Budget is 10 h. Start clean.
    await h.db.query("truncate entries");
    await h.db.query("delete from alerts_sent");
    h.mailer.sent.length = 0;

    const approve = async (minutes: number) => {
      const id = await insertEntry(h, staff.id, { minutes });
      await h.api.post(`/api/entries/${id}/review`).set(h.as(manager.token)).send({ status: "approved" });
    };

    await approve(60 * 5);
    expect(h.mailer.sent).toHaveLength(0);

    await approve(60 * 3); // 8 h of 10 = 80%
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]!.subject).toMatch(/80%/);
    expect(h.mailer.sent[0]!.to).toEqual(expect.arrayContaining([manager.email, manager2.email]));
    expect(h.mailer.sent[0]!.to).not.toContain(staff.email);

    await approve(30); // still under 100%, no repeat
    expect(h.mailer.sent).toHaveLength(1);

    await approve(60 * 2); // 10.5 h
    expect(h.mailer.sent).toHaveLength(2);
    expect(h.mailer.sent[1]!.subject).toMatch(/used up/);

    // Running the scheduled job again sends nothing new.
    expect(await checkAlerts(h.db, h.mailer)).toEqual([]);
    expect(h.mailer.sent).toHaveLength(2);
  });

  it("ignores pending hours", async () => {
    await h.db.query("truncate entries");
    await h.db.query("delete from alerts_sent");
    h.mailer.sent.length = 0;
    await insertEntry(h, staff.id, { minutes: 60 * 9 });
    expect(await checkAlerts(h.db, h.mailer)).toEqual([]);
  });
});
