import { beforeAll, describe, expect, it } from "vitest";
import { remindStaleTimers, sendCycleSummary } from "../src/jobs/daily.js";
import { afterFailedLogin, isLocked, lockMinutesLeft } from "../src/rules.js";
import { createHarness, insertEntry, type Harness } from "./helpers.js";

const PASSWORD = "a-long-password-1";
const DAY = 24 * 60;

describe("lockout rules", () => {
  const now = new Date("2026-11-16T10:00:00Z");
  it("starts slowly and gets longer", () => {
    expect(afterFailedLogin(0, now)).toEqual({ failedLogins: 1, lockedUntil: null });
    expect(afterFailedLogin(3, now).lockedUntil).toBeNull(); // 4th wrong password: still no lock
    expect(afterFailedLogin(4, now).lockedUntil).toEqual(new Date("2026-11-16T10:05:00Z")); // 5th: 5 minutes
    expect(afterFailedLogin(7, now).lockedUntil).toEqual(new Date("2026-11-16T10:15:00Z")); // 8th: 15 minutes
    expect(afterFailedLogin(9, now).lockedUntil).toEqual(new Date("2026-11-16T11:00:00Z")); // 10th: an hour
  });
  it("knows when a lock has ended", () => {
    const until = new Date("2026-11-16T10:05:00Z");
    expect(isLocked(until, now)).toBe(true);
    expect(isLocked(until, new Date("2026-11-16T10:05:01Z"))).toBe(false);
    expect(isLocked(null, now)).toBe(false);
    expect(lockMinutesLeft(until, now)).toBe(5);
    expect(lockMinutesLeft(until, new Date("2026-11-16T10:04:30Z"))).toBe(1);
    expect(lockMinutesLeft(null, now)).toBe(0);
  });
});

describe("signing in, locking out and ending sessions", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });

  const login = (email: string, password: string) => h.api.post("/api/auth/login").send({ email, password });

  it("locks an account after five wrong passwords, even for the right password, until the lock ends", async () => {
    const u = await h.user("staff", "Lockout Lee");
    for (let i = 0; i < 4; i++) expect((await login(u.email, "wrong-password-1")).status).toBe(401);
    expect((await login(u.email, "wrong-password-1")).status).toBe(401); // the fifth wrong one sets the lock
    const locked = await login(u.email, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/Try again in \d+ minutes?/);
    // The same message however the password is wrong, so a lock is not a way to learn the password.
    expect((await login(u.email, "wrong-password-1")).status).toBe(429);

    // The lock simply runs out.
    await h.db.query("update users set locked_until = now() - interval '1 minute' where id = $1", [u.id]);
    expect((await login(u.email, PASSWORD)).status).toBe(200);
    const row = await h.db.query<{ failed_logins: number; locked_until: Date | null }>("select failed_logins, locked_until from users where id = $1", [u.id]);
    expect(row.rows[0]).toEqual({ failed_logins: 0, locked_until: null });
    const log = await h.db.query("select 1 from audit_log where action = 'lockout' and actor_id = $1", [u.id]);
    expect(log.rowCount).toBe(1);
  });

  it("starts the count again after a good sign-in", async () => {
    const u = await h.user("staff", "Careful Cam");
    for (let i = 0; i < 3; i++) await login(u.email, "wrong-password-1");
    expect((await login(u.email, PASSWORD)).status).toBe(200);
    const row = await h.db.query<{ failed_logins: number }>("select failed_logins from users where id = $1", [u.id]);
    expect(row.rows[0]!.failed_logins).toBe(0);
  });

  it("does not reveal or lock accounts that do not exist or are not active", async () => {
    const a = await login("nobody@example.com", "wrong-password-1");
    expect(a.status).toBe(401);
    const gone = await h.user("staff", "Gone Gail");
    await h.db.query("update users set active = false where id = $1", [gone.id]);
    for (let i = 0; i < 6; i++) await login(gone.email, "wrong-password-1");
    const row = await h.db.query<{ failed_logins: number }>("select failed_logins from users where id = $1", [gone.id]);
    expect(row.rows[0]!.failed_logins).toBe(0);
  });

  it("changing the password signs out every other device but keeps this one", async () => {
    const u = await h.user("staff", "Changing Chris");
    const phone = (await login(u.email, PASSWORD)).body.token as string;
    const laptop = (await login(u.email, PASSWORD)).body.token as string;
    expect((await h.api.get("/api/data").set(h.as(phone))).status).toBe(200);

    const changed = await h.api.post("/api/auth/change-password").set(h.as(laptop)).send({ current: PASSWORD, next: "a-brand-new-password-2" });
    expect(changed.status).toBe(200);
    expect(typeof changed.body.token).toBe("string");

    const stale = await h.api.get("/api/data").set(h.as(phone));
    expect(stale.status).toBe(401);
    expect(stale.body.error).toMatch(/password was changed/i);
    expect((await h.api.get("/api/data").set(h.as(laptop))).status).toBe(401); // the old token on this device is retired too
    expect((await h.api.get("/api/data").set(h.as(changed.body.token))).status).toBe(200); // the fresh one works
    expect((await login(u.email, "a-brand-new-password-2")).status).toBe(200);
    expect((await login(u.email, PASSWORD)).status).toBe(401);
  });

  it("a reset link signs out old sessions and clears a lock", async () => {
    const u = await h.user("staff", "Resetting Rae");
    const old = (await login(u.email, PASSWORD)).body.token as string;
    for (let i = 0; i < 5; i++) await login(u.email, "wrong-password-1");
    expect((await login(u.email, PASSWORD)).status).toBe(429);

    await h.api.post("/api/auth/forgot").send({ email: u.email });
    const mail = h.mailer.sent.filter((m) => m.to[0] === u.email).pop()!;
    const token = /token=([0-9a-f]+)/.exec(mail.text)![1]!;
    const set = await h.api.post("/api/auth/set-password").send({ token, password: "after-the-reset-password-3" });
    expect(set.status).toBe(200);
    expect((await h.api.get("/api/data").set(h.as(old))).status).toBe(401);
    expect((await h.api.get("/api/data").set(h.as(set.body.token))).status).toBe(200);
    expect((await login(u.email, "after-the-reset-password-3")).status).toBe(200);
  });

  it("makes a reset link last 2 hours and an invite 7 days", async () => {
    const reset = await h.user("staff", "Short Sam");
    await h.api.post("/api/auth/forgot").send({ email: reset.email });
    const r = await h.db.query<{ hours: number }>("select (extract(epoch from (token_expires_at - now())) / 3600)::float8 as hours from users where id = $1", [reset.id]);
    expect(r.rows[0]!.hours).toBeGreaterThan(1.9);
    expect(r.rows[0]!.hours).toBeLessThanOrEqual(2);
    expect(h.mailer.sent.pop()!.text).toMatch(/works for 2 hours/);

    const admin = await h.user("admin", "Ada Admin");
    const made = await h.api.post("/api/admin/users").set(h.as(admin.token)).send({ name: "Invited Ivy", email: "ivy@example.com" });
    const token = new URL(made.body.link).searchParams.get("token")!;
    expect(token.length).toBeGreaterThan(20);
    const inv = await h.db.query<{ hours: number }>("select (extract(epoch from (token_expires_at - now())) / 3600)::float8 as hours from users where email = 'ivy@example.com'");
    expect(inv.rows[0]!.hours).toBeGreaterThan(24 * 7 - 0.1);
  });
});

describe("loading entries a cycle at a time", () => {
  let h: Harness;
  let manager: Awaited<ReturnType<Harness["user"]>>;
  let staff: Awaited<ReturnType<Harness["user"]>>;
  let client: Awaited<ReturnType<Harness["user"]>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await createHarness();
    manager = await h.user("manager", "Mia Manager");
    staff = await h.user("staff", "Sam Staff");
    client = await h.user("client", "Cleo Client");
    // The harness cycle is 14 days and today is in cycle 0, so these fall in cycles 0, -1, -2 and -3.
    for (const [name, daysAgo] of [["now", 0], ["last", 5], ["two", 20], ["three", 35]] as const) {
      ids[name] = await insertEntry(h, staff.id, { minutes: 30, minutesAgo: daysAgo * DAY + 60 });
      await h.api.post(`/api/entries/${ids[name]}/review`).set(h.as(manager.token)).send({ status: "approved" });
    }
    // An old entry nobody has looked at yet.
    ids.stuck = await insertEntry(h, staff.id, { minutes: 30, minutesAgo: 50 * DAY });
  });

  const entryIds = async (token: string, back?: number) => {
    const r = await h.api.get(back ? `/api/data?back=${back}` : "/api/data").set(h.as(token));
    expect(r.status).toBe(200);
    return (r.body.data.entries as Array<{ id: string }>).map((e) => e.id);
  };

  it("returns the current cycle and the one before by default", async () => {
    const got = await entryIds(manager.token);
    expect(got).toEqual(expect.arrayContaining([ids.now, ids.last]));
    expect(got).not.toContain(ids.two);
    expect(got).not.toContain(ids.three);
  });

  it("returns more when asked, and never more than the limit", async () => {
    expect(await entryIds(manager.token, 1)).not.toContain(ids.last);
    expect(await entryIds(manager.token, 3)).toEqual(expect.arrayContaining([ids.now, ids.last, ids.two]));
    expect(await entryIds(manager.token, 3)).not.toContain(ids.three);
    expect(await entryIds(manager.token, 4)).toContain(ids.three);
    const silly = await h.api.get("/api/data?back=999999").set(h.as(manager.token));
    expect(silly.status).toBe(200);
    expect((await h.api.get("/api/data?back=banana").set(h.as(manager.token))).status).toBe(200);
  });

  it("always includes work waiting for approval, however old, so it cannot be lost from Approvals", async () => {
    expect(await entryIds(manager.token, 1)).toContain(ids.stuck);
    expect(await entryIds(staff.token, 1)).toContain(ids.stuck); // it is the staff member's own
  });

  it("gives the client approved entries inside the window only", async () => {
    const got = await entryIds(client.token);
    expect(got).toEqual(expect.arrayContaining([ids.now, ids.last]));
    expect(got).not.toContain(ids.stuck);
    expect(got).not.toContain(ids.two);
  });
});

describe("the daily jobs", () => {
  let h: Harness;
  let manager: Awaited<ReturnType<Harness["user"]>>;
  let manager2: Awaited<ReturnType<Harness["user"]>>;
  let staff: Awaited<ReturnType<Harness["user"]>>;

  beforeAll(async () => {
    h = await createHarness();
    manager = await h.user("manager", "Mia Manager");
    manager2 = await h.user("manager", "Max Manager");
    staff = await h.user("staff", "Sam Staff");
  });

  it("emails the managers once when a cycle ends, in the hours-allocated wording", async () => {
    // 6 hours approved in the cycle before this one, against the harness's 10 hours.
    const id = await insertEntry(h, staff.id, { minutes: 6 * 60, minutesAgo: 4 * DAY });
    await h.api.post(`/api/entries/${id}/review`).set(h.as(manager.token)).send({ status: "approved" });
    h.mailer.sent.length = 0;

    const cycle = await sendCycleSummary(h.db, h.mailer, "https://hours.example.com");
    expect(cycle).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.mailer.sent).toHaveLength(1);
    const mail = h.mailer.sent[0]!;
    expect(mail.to).toEqual(expect.arrayContaining([manager.email, manager2.email]));
    expect(mail.to).not.toContain(staff.email);
    expect(mail.text).toContain("6.0 of 10 hours allocated");
    expect(mail.text).toContain("https://hours.example.com/client/report");
    expect(mail.text.toLowerCase()).not.toContain("paid");

    // The job can run again and again without sending a second time.
    expect(await sendCycleSummary(h.db, h.mailer, "https://hours.example.com")).toBeNull();
    expect(h.mailer.sent).toHaveLength(1);
  });

  it("counts hours management added to that cycle", async () => {
    const h2 = await createHarness();
    const m = await h2.user("manager", "Mo Manager");
    const s = await h2.user("staff", "Sue Staff");
    const id = await insertEntry(h2, s.id, { minutes: 12 * 60, minutesAgo: 4 * DAY });
    await h2.api.post(`/api/entries/${id}/review`).set(h2.as(m.token)).send({ status: "approved" });
    const prevStart = (await h2.db.query<{ d: string }>("select to_char((cycle_anchor::date - 14), 'YYYY-MM-DD') as d from settings")).rows[0]!.d;
    await h2.db.query("insert into hour_extensions (id, cycle_start, hours, reason, created_by) values ('x1', $1, 5, 'Launch week', $2)", [prevStart, m.id]);
    h2.mailer.sent.length = 0;
    await sendCycleSummary(h2.db, h2.mailer, "https://hours.example.com");
    // 12 hours used of 10 + 5 = 15 allocated, so no extra hours.
    expect(h2.mailer.sent[0]!.text).toContain("12.0 of 15 hours allocated");
    expect(h2.mailer.sent[0]!.text).toContain("Hours left: 3.0");
  });

  it("sends nothing when there is no one to send to", async () => {
    const h3 = await createHarness();
    const s = await h3.user("staff", "Only Staff");
    const x = await h3.user("manager", "Temp Manager");
    const id = await insertEntry(h3, s.id, { minutes: 60, minutesAgo: 4 * DAY });
    await h3.api.post(`/api/entries/${id}/review`).set(h3.as(x.token)).send({ status: "approved" });
    await h3.db.query("update users set active = false where id = $1", [x.id]);
    h3.mailer.sent.length = 0;
    expect(await sendCycleSummary(h3.db, h3.mailer, "https://hours.example.com")).toBeNull();
    // The claim is given back, so it is retried once a manager exists again.
    expect((await h3.db.query("select 1 from cycle_reports")).rowCount).toBe(0);
  });

  it("reminds a person once a day about a timer left running, and only them", async () => {
    await h.api.post("/api/timer").set(h.as(staff.token)).send({ projectId: h.projectId, task: "Admin" });
    h.mailer.sent.length = 0;
    // A fresh timer is fine.
    expect(await remindStaleTimers(h.db, h.mailer, "https://hours.example.com")).toEqual([]);

    await h.db.query("update timers set started_at = now() - interval '20 hours' where staff_id = $1", [staff.id]);
    expect(await remindStaleTimers(h.db, h.mailer, "https://hours.example.com")).toEqual([staff.id]);
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0]!.to).toEqual([staff.email]);
    expect(h.mailer.sent[0]!.text).toContain("https://hours.example.com/staff/track");

    // Not again the same day.
    expect(await remindStaleTimers(h.db, h.mailer, "https://hours.example.com")).toEqual([]);
    expect(h.mailer.sent).toHaveLength(1);
    // A paused timer is not "left running".
    await h.db.query("delete from timer_reminders");
    await h.db.query("update timers set running = false where staff_id = $1", [staff.id]);
    expect(await remindStaleTimers(h.db, h.mailer, "https://hours.example.com")).toEqual([]);
  });
});
