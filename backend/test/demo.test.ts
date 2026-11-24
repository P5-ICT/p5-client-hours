import { describe, expect, it, vi } from "vitest";
import { cycleTotals } from "../src/cycle-totals.js";
import { DEMO_PEOPLE, demoEmail, isDemoEmail, seedDemo } from "../src/demo.js";
import { cycleIndexAt } from "../src/rules.js";
import { loadSettings } from "../src/settings.js";
import { createHarness } from "./helpers.js";

const PASSWORD = "demo-password-1";
const demoEnv = { DEMO_DATA: "1", DEMO_PASSWORD: PASSWORD };

describe("isDemoEmail", () => {
  it("recognises demo accounts and nothing else", () => {
    expect(isDemoEmail("staff@pillar5group.com")).toBe(true);
    expect(isDemoEmail(" MANAGER@Pillar5Group.com ")).toBe(true);
    expect(isDemoEmail("someone@pillar5.co.za")).toBe(false);
    expect(isDemoEmail("a@pillar5group.com.evil.com")).toBe(false);
    expect(isDemoEmail("pillar5group.com@gmail.com")).toBe(false);
  });
});

describe("seeding the demo data", () => {
  it("creates the accounts, the shares and the story the guide describes", async () => {
    const h = await createHarness();
    expect(await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD })).toBe("seeded");

    const users = await h.db.query<{ email: string; app_role: string }>("select email, app_role from users where email like '%@pillar5group.com'");
    expect(users.rowCount).toBe(DEMO_PEOPLE.length);
    for (const role of ["admin", "manager", "ceo", "staff", "client"]) expect(users.rows.some((u) => u.app_role === role)).toBe(true);
    expect(users.rows.filter((u) => u.app_role === "manager")).toHaveLength(2); // two, so approving each other's work can be tried

    const s = await loadSettings(h.db);
    expect(s).toMatchObject({ clientName: "Sample Client (Pty) Ltd", budgetHours: 45, cycleDays: 14 });
    const shares = await h.db.query<{ name: string; allocated_hours: number }>("select name, allocated_hours from departments order by colour");
    expect(shares.rows.map((d) => [d.name, d.allocated_hours])).toEqual([["Operations", 25], ["Administration", 12], ["Marketing", 8]]);

    const now = cycleIndexAt(s, new Date());
    const current = await cycleTotals(h.db, s, now);
    const previous = await cycleTotals(h.db, s, now - 1);
    expect(current.approvedMinutes).toBe(33 * 60); // this cycle so far
    expect(current.pendingMinutes).toBe(11 * 60); // waiting for approval
    expect(previous.approvedMinutes).toBe(52.5 * 60); // last cycle ended 7.5 hours over the 45
    expect((await h.db.query("select 1 from entries where status = 'rejected'")).rowCount).toBe(1);
    expect((await h.db.query("select 1 from hour_extensions where hours = 5")).rowCount).toBe(1);
    expect((await h.db.query("select 1 from entries where logged_by is not null and status = 'pending'")).rowCount).toBe(1);
  });

  it("lets every demo account sign in with the shared password", async () => {
    const h = await createHarness();
    await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD });
    for (const key of ["admin", "manager", "manager2", "ceo", "staff", "staff2", "client"]) {
      const r = await h.api.post("/api/auth/login").send({ email: demoEmail(key), password: PASSWORD });
      expect(r.status, key).toBe(200);
    }
    expect((await h.api.post("/api/auth/login").send({ email: demoEmail("staff"), password: "not-the-password" })).status).toBe(401);
  });

  it("does nothing the second time, apart from refreshing the password", async () => {
    const h = await createHarness();
    await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD });
    const before = (await h.db.query<{ n: number }>("select (select count(*) from entries)::int + (select count(*) from users)::int as n")).rows[0]!.n;
    expect(await seedDemo(h.db, { DEMO_PASSWORD: "a-new-shared-password" })).toBe("exists");
    const after = (await h.db.query<{ n: number }>("select (select count(*) from entries)::int + (select count(*) from users)::int as n")).rows[0]!.n;
    expect(after).toBe(before);
    expect((await h.api.post("/api/auth/login").send({ email: demoEmail("staff"), password: "a-new-shared-password" })).status).toBe(200);
    expect((await h.api.post("/api/auth/login").send({ email: demoEmail("staff"), password: PASSWORD })).status).toBe(401);
  });

  it("clears a lock-out the testers caused when the password is refreshed", async () => {
    const h = await createHarness();
    await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD });
    for (let i = 0; i < 5; i++) await h.api.post("/api/auth/login").send({ email: demoEmail("staff"), password: "wrong-password-1" });
    expect((await h.api.post("/api/auth/login").send({ email: demoEmail("staff"), password: PASSWORD })).status).toBe(429);
    await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD });
    expect((await h.api.post("/api/auth/login").send({ email: demoEmail("staff"), password: PASSWORD })).status).toBe(200);
  });

  it("skips quietly without a usable password", async () => {
    const h = await createHarness();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await seedDemo(h.db, { DEMO_PASSWORD: undefined })).toBe("skipped");
    expect(await seedDemo(h.db, { DEMO_PASSWORD: "short" })).toBe("skipped");
    expect((await h.db.query("select 1 from users where email like '%@pillar5group.com'")).rowCount).toBe(0);
  });
});

describe("resetting the demo", () => {
  it("wipes what testers added and starts the sample story again", async () => {
    const h = await createHarness();
    await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD });
    const staff = (await h.api.post("/api/auth/login").send({ email: demoEmail("staff"), password: PASSWORD })).body.token as string;
    await h.api.post("/api/timer").set(h.as(staff)).send({ projectId: (await h.db.query<{ id: string }>("select id from projects limit 1")).rows[0]!.id, task: "Admin" });
    await h.db.query("insert into projects (id, name) values ('p_junk', 'A tester project')");

    expect(await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD, DEMO_RESET: "1" })).toBe("reset");
    expect((await h.db.query("select 1 from timers")).rowCount).toBe(0);
    expect((await h.db.query("select 1 from projects where name = 'A tester project'")).rowCount).toBe(0);
    const s = await loadSettings(h.db);
    expect((await cycleTotals(h.db, s, cycleIndexAt(s, new Date()))).approvedMinutes).toBe(33 * 60);
    expect((await h.db.query("select 1 from hour_extensions")).rowCount).toBe(1); // not doubled
  });

  it("refuses to wipe a system where real people have been added", async () => {
    const h = await createHarness();
    await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD });
    await h.user("staff", "A Real Colleague"); // an account outside the demo domain
    const entries = (await h.db.query<{ n: number }>("select count(*)::int as n from entries")).rows[0]!.n;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD, DEMO_RESET: "1" })).toBe("refused");
    expect((await h.db.query<{ n: number }>("select count(*)::int as n from entries")).rows[0]!.n).toBe(entries);
  });

  it("is happy with the real admin, who is not a demo account", async () => {
    const h = await createHarness();
    await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD });
    await h.user("admin", "The Real Admin");
    expect(await seedDemo(h.db, { DEMO_PASSWORD: PASSWORD, DEMO_RESET: "1" })).toBe("reset");
  });
});

describe("safeguards while the trial is on", () => {
  it("marks the data as a trial for the screens", async () => {
    const h = await createHarness(demoEnv);
    await seedDemo(h.db, demoEnv);
    const token = (await h.api.post("/api/auth/login").send({ email: demoEmail("manager"), password: PASSWORD })).body.token as string;
    expect((await h.api.get("/api/data").set(h.as(token))).body.data.settings.demo).toBe(true);

    const normal = await createHarness();
    const u = await normal.user("staff");
    expect((await normal.api.get("/api/data").set(normal.as(u.token))).body.data.settings.demo).toBe(false);
  });

  it("stops one tester changing the shared password for everyone", async () => {
    const h = await createHarness(demoEnv);
    await seedDemo(h.db, demoEnv);
    const token = (await h.api.post("/api/auth/login").send({ email: demoEmail("staff"), password: PASSWORD })).body.token as string;
    const r = await h.api.post("/api/auth/change-password").set(h.as(token)).send({ current: PASSWORD, next: "a-different-password-9" });
    expect(r.status).toBe(403);
    expect((await h.api.post("/api/auth/login").send({ email: demoEmail("staff"), password: PASSWORD })).status).toBe(200);
  });

  it("stops a demo admin deactivating or resetting a real person, but not demo accounts", async () => {
    const h = await createHarness(demoEnv);
    await seedDemo(h.db, demoEnv);
    const real = await h.user("admin", "The Real Admin");
    const demoAdmin = (await h.api.post("/api/auth/login").send({ email: demoEmail("admin"), password: PASSWORD })).body.token as string;

    expect((await h.api.patch(`/api/admin/users/${real.id}`).set(h.as(demoAdmin)).send({ active: false })).status).toBe(403);
    expect((await h.api.post(`/api/admin/users/${real.id}/invite`).set(h.as(demoAdmin))).status).toBe(403);
    expect((await h.api.get("/api/data").set(h.as(real.token))).status).toBe(200); // still active

    const other = (await h.db.query<{ id: string }>("select id from users where email = $1", [demoEmail("staff2")])).rows[0]!.id;
    expect((await h.api.patch(`/api/admin/users/${other}`).set(h.as(demoAdmin)).send({ jobTitle: "Tester" })).status).toBe(200);
    // The real admin keeps full control.
    expect((await h.api.patch(`/api/admin/users/${other}`).set(h.as(real.token)).send({ jobTitle: "Tester again" })).status).toBe(200);
  });

  it("keeps the approval rules working on the sample data", async () => {
    const h = await createHarness(demoEnv);
    await seedDemo(h.db, demoEnv);
    const login = async (key: string) => (await h.api.post("/api/auth/login").send({ email: demoEmail(key), password: PASSWORD })).body.token as string;
    const [manager, manager2, client] = [await login("manager"), await login("manager2"), await login("client")];
    const typedIn = (await h.db.query<{ id: string }>("select id from entries where logged_by is not null")).rows[0]!.id;

    expect((await h.api.post(`/api/entries/${typedIn}/review`).set(h.as(manager)).send({ status: "approved" })).status).toBe(403); // they typed it in
    const seen = (await h.api.get("/api/data").set(h.as(client))).body.data.entries as Array<{ status: string }>;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((e) => e.status === "approved")).toBe(true);
    expect((await h.api.post(`/api/entries/${typedIn}/review`).set(h.as(manager2)).send({ status: "approved" })).status).toBe(200);
  });
});
