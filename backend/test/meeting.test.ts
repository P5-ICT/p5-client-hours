import { beforeAll, describe, expect, it } from "vitest";
import { createHarness, insertEntry, type Harness } from "./helpers.js";

type U = Awaited<ReturnType<Harness["user"]>>;

let h: Harness;
let staff: U;
let staff2: U;
let manager: U;
let manager2: U;
let client: U;
let admin: U;
let cycleStart: string;

beforeAll(async () => {
  h = await createHarness();
  staff = await h.user("staff", "Sam Staff");
  staff2 = await h.user("staff", "Sue Staff");
  manager = await h.user("manager", "Mia Manager");
  manager2 = await h.user("manager", "Max Manager");
  client = await h.user("client", "Cleo Client");
  admin = await h.user("admin", "Ada Admin");
  cycleStart = (await h.db.query<{ cycle_anchor: string }>("select cycle_anchor from settings")).rows[0]!.cycle_anchor;
});

const data = (token: string) => h.api.get("/api/data").set(h.as(token));

describe("management logs hours for other people", () => {
  const body = (staffId?: string, over: Record<string, unknown> = {}) => {
    const end = new Date(Date.now() - 10 * 60_000);
    return { staffId, projectId: h.projectId, task: "Content", note: "Wrote the campaign copy", reason: "", start: new Date(end.getTime() - 60 * 60_000), end, ...over };
  };

  it("lets a manager log for someone, as a pending entry that another manager must approve", async () => {
    const r = await h.api.post("/api/entries").set(h.as(manager.token)).send(body(staff2.id));
    expect(r.status).toBe(201);
    const row = await h.db.query<{ staff_id: string; logged_by: string; status: string; manual_reason: string }>(
      "select staff_id, logged_by, status, manual_reason from entries where id = $1",
      [r.body.id],
    );
    expect(row.rows[0]).toEqual({ staff_id: staff2.id, logged_by: manager.id, status: "pending", manual_reason: "Logged by management" });

    // The person who typed it in cannot approve it. Neither can the person it is for.
    expect((await h.api.post(`/api/entries/${r.body.id}/review`).set(h.as(manager.token)).send({ status: "approved" })).status).toBe(403);
    expect((await h.api.post(`/api/entries/${r.body.id}/review`).set(h.as(staff2.token)).send({ status: "approved" })).status).toBe(403);
    expect((await h.api.post(`/api/entries/${r.body.id}/review`).set(h.as(manager2.token)).send({ status: "approved" })).status).toBe(200);

    // The database refuses it too.
    const other = await h.api.post("/api/entries").set(h.as(manager.token)).send(body(staff.id));
    await expect(
      h.db.query("update entries set status = 'approved', reviewer_id = $1, reviewed_at = now() where id = $2", [manager.id, other.body.id]),
    ).rejects.toThrow();
  });

  it("shows who typed the entry in to management, not to other staff", async () => {
    const r = await h.api.post("/api/entries").set(h.as(admin.token)).send(body(staff2.id, { reason: "Counted from the sign-in sheet" }));
    expect(r.status).toBe(201);
    const seen = (await data(manager.token)).body.data.entries.find((e: { id: string }) => e.id === r.body.id);
    expect(seen.loggedById).toBe(admin.id);
    const other = (await data(staff.token)).body.data.entries.find((e: { id: string }) => e.id === r.body.id);
    expect(other).toBeUndefined(); // pending and not theirs
  });

  it("is refused for staff, unknown people and clients as the target", async () => {
    expect((await h.api.post("/api/entries").set(h.as(staff.token)).send(body(staff2.id))).status).toBe(403);
    expect((await h.api.post("/api/entries").set(h.as(manager.token)).send(body("nobody"))).status).toBe(400);
    expect((await h.api.post("/api/entries").set(h.as(manager.token)).send(body(client.id))).status).toBe(400);
    // Naming yourself is just logging your own time.
    const own = await h.api.post("/api/entries").set(h.as(staff.token)).send(body(staff.id, { reason: "Forgot the timer" }));
    expect(own.status).toBe(201);
  });
});

describe("extending the hours (management only)", () => {
  it("is closed to staff and the client", async () => {
    const b = { cycleStart, hours: 5, reason: "Launch week" };
    expect((await h.api.post("/api/extensions").set(h.as(staff.token)).send(b)).status).toBe(403);
    expect((await h.api.post("/api/extensions").set(h.as(client.token)).send(b)).status).toBe(403);
  });

  it("checks the date, the hours and the reason", async () => {
    const post = (b: object) => h.api.post("/api/extensions").set(h.as(manager.token)).send(b);
    expect((await post({ cycleStart: "2000-01-02", hours: 5, reason: "x" })).status).toBe(400); // not a cycle start
    expect((await post({ cycleStart, hours: 0, reason: "x" })).status).toBe(400);
    expect((await post({ cycleStart, hours: 5, reason: "  " })).status).toBe(400);
    const future = new Date(Date.parse(`${cycleStart}T00:00:00Z`) + 14 * 86_400_000 * 3).toISOString().slice(0, 10);
    expect((await post({ cycleStart: future, hours: 5, reason: "x" })).status).toBe(400); // a cycle that has not started
  });

  it("raises the hours the alerts measure against, and is visible to the client", async () => {
    await h.db.query("truncate entries");
    await h.db.query("delete from alerts_sent");
    h.mailer.sent.length = 0;
    const ext = await h.api.post("/api/extensions").set(h.as(manager.token)).send({ cycleStart, hours: 10, reason: "Launch week" });
    expect(ext.status).toBe(201);

    const approve = async (minutes: number) => {
      const id = await insertEntry(h, staff.id, { minutes });
      await h.api.post(`/api/entries/${id}/review`).set(h.as(manager.token)).send({ status: "approved" });
    };
    await approve(60 * 8); // 8 h of 10 + 10 = 20: no alert (it would be 80% of the old 10)
    expect(h.mailer.sent).toHaveLength(0);
    await approve(60 * 8); // 16 h of 20 = 80%
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]!.subject).toMatch(/80%/);

    const seen = (await data(client.token)).body.data.extensions;
    expect(seen).toEqual([expect.objectContaining({ cycleStart, hours: 10, reason: "Launch week" })]);
  });

  it("can be removed again, and is audited", async () => {
    const list = (await data(manager.token)).body.data.extensions;
    expect((await h.api.delete(`/api/extensions/${list[0].id}`).set(h.as(staff.token))).status).toBe(403);
    expect((await h.api.delete(`/api/extensions/${list[0].id}`).set(h.as(manager.token))).status).toBe(200);
    expect((await data(manager.token)).body.data.extensions).toEqual([]);
    const log = await h.db.query<{ action: string }>("select action from audit_log where action in ('extend-hours', 'remove-extension')");
    expect(log.rows.map((r) => r.action).sort()).toEqual(["extend-hours", "remove-extension"]);
  });
});

describe("minimum timer length", () => {
  const settings = (minTimerMinutes: number) => ({ clientName: "Test Client", budgetHours: 10, cycleDays: 14, minTimerMinutes, anchor: cycleStart });

  it("stops a timer that has not run long enough, until the admin lowers the limit", async () => {
    expect((await h.api.put("/api/admin/settings").set(h.as(admin.token)).send(settings(15))).status).toBe(200);
    expect((await data(staff.token)).body.data.settings.minTimerMinutes).toBe(15);

    await h.api.post("/api/timer").set(h.as(staff.token)).send({ projectId: h.projectId, task: "Admin" });
    await h.db.query("update timers set started_at = now() - interval '10 minutes' where staff_id = $1", [staff.id]);
    const early = await h.api.post("/api/timer/stop").set(h.as(staff.token)).send({ note: "Quick admin task" });
    expect(early.status).toBe(400);
    expect(early.body.error).toMatch(/at least 15 minutes/);

    await h.db.query("update timers set started_at = now() - interval '16 minutes' where staff_id = $1", [staff.id]);
    expect((await h.api.post("/api/timer/stop").set(h.as(staff.token)).send({ note: "Quick admin task" })).status).toBe(201);

    expect((await h.api.put("/api/admin/settings").set(h.as(admin.token)).send(settings(1))).status).toBe(200);
  });
});

describe("hours allocated to each department", () => {
  it("is set by an admin and shown to everyone", async () => {
    await h.db.query("insert into departments (id, name, colour) values ('d_mkt', 'Marketing', 2)");
    expect((await h.api.patch("/api/admin/departments/d_mkt").set(h.as(manager.token)).send({ allocatedHours: 8 })).status).toBe(403);
    expect((await h.api.patch("/api/admin/departments/d_mkt").set(h.as(admin.token)).send({ allocatedHours: 8 })).status).toBe(200);
    expect((await h.api.patch("/api/admin/departments/d_mkt").set(h.as(admin.token)).send({ allocatedHours: -1 })).status).toBe(400);
    expect((await data(client.token)).body.data.departments.find((d: { id: string }) => d.id === "d_mkt").hours).toBe(8);
    expect((await h.api.patch("/api/admin/departments/d_mkt").set(h.as(admin.token)).send({ allocatedHours: null })).status).toBe(200);
    expect((await data(client.token)).body.data.departments.find((d: { id: string }) => d.id === "d_mkt").hours).toBeNull();
  });
});
