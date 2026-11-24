import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_DOMAIN, seedDemo } from "../src/demo.js";
import { createHarness, type Harness } from "./helpers.js";

type U = Awaited<ReturnType<Harness["user"]>>;

describe("managers adding people", () => {
  let h: Harness;
  let manager: U;
  let ceo: U;
  let staff: U;
  let client: U;
  let admin: U;

  beforeAll(async () => {
    h = await createHarness();
    manager = await h.user("manager", "Mia Manager");
    ceo = await h.user("ceo", "Cole CEO");
    staff = await h.user("staff", "Sam Staff");
    client = await h.user("client", "Cleo Client");
    admin = await h.user("admin", "Ada Admin");
  });

  const add = (token: string, over: Record<string, unknown> = {}) =>
    h.api.post("/api/people").set(h.as(token)).send({ name: "New Person", email: `new${Math.random().toString(36).slice(2, 8)}@example.com`, jobTitle: "Designer", ...over });

  it("lets a manager or the CEO add a staff member, who gets an invite", async () => {
    h.mailer.sent.length = 0;
    const r = await add(manager.token, { email: "thandi.new@example.com" });
    expect(r.status).toBe(201);
    expect(r.body.link).toMatch(/set-password\?token=/);
    expect(h.mailer.sent.at(-1)!.to).toEqual(["thandi.new@example.com"]);
    const row = await h.db.query<{ app_role: string; password_hash: string | null }>("select app_role, password_hash from users where email = 'thandi.new@example.com'");
    expect(row.rows[0]).toEqual({ app_role: "staff", password_hash: null }); // cannot sign in until they choose a password
    expect((await add(ceo.token)).status).toBe(201);
  });

  it("lets a manager add a client contact", async () => {
    const r = await add(manager.token, { appRole: "client" });
    expect(r.status).toBe(201);
  });

  it("never lets a manager hand out more access than staff or client", async () => {
    for (const appRole of ["manager", "ceo", "admin"]) {
      const r = await add(manager.token, { appRole });
      expect(r.status, appRole).toBe(400);
    }
    expect((await add(ceo.token, { appRole: "admin" })).status).toBe(400);
  });

  it("is closed to staff and the client", async () => {
    expect((await add(staff.token)).status).toBe(403);
    expect((await add(client.token)).status).toBe(403);
    expect((await h.api.post("/api/people").send({ name: "x", email: "x@example.com" })).status).toBe(401);
  });

  it("rejects bad details and duplicates, and records who added whom", async () => {
    expect((await add(manager.token, { email: "not-an-email" })).status).toBe(400);
    expect((await add(manager.token, { name: " " })).status).toBe(400);
    expect((await add(manager.token, { email: "thandi.new@example.com" })).status).toBe(409);
    const log = await h.db.query<{ actor_id: string }>("select actor_id from audit_log where action = 'create' and entity = 'user' order by id limit 1");
    expect(log.rows[0]!.actor_id).toBe(manager.id);
  });

  it("leaves the administrator able to add any kind of account", async () => {
    for (const appRole of ["staff", "manager", "ceo", "client", "admin"]) {
      const r = await h.api.post("/api/admin/users").set(h.as(admin.token)).send({ name: `Role ${appRole}`, email: `${appRole}.by.admin@example.com`, appRole });
      expect(r.status, appRole).toBe(201);
    }
  });

  it("does not let a manager use the admin routes", async () => {
    expect((await h.api.post("/api/admin/users").set(h.as(manager.token)).send({ name: "Sneaky", email: "sneaky@example.com", appRole: "admin" })).status).toBe(403);
    expect((await h.api.put("/api/admin/settings").set(h.as(manager.token)).send({})).status).toBe(403);
  });
});

describe("adding people in the trial", () => {
  it("only allows demo.example addresses, so the trial cannot email real people", async () => {
    const env = { DEMO_DATA: "1", DEMO_PASSWORD: "demo-password-1" };
    const h = await createHarness(env);
    await seedDemo(h.db, env);
    const login = async (key: string) => (await h.api.post("/api/auth/login").send({ email: `${key}@${DEMO_DOMAIN}`, password: "demo-password-1" })).body.token as string;
    const [manager, admin] = [await login("manager"), await login("admin")];
    h.mailer.sent.length = 0;

    for (const t of [manager, admin]) {
      const refused = t === manager
        ? await h.api.post("/api/people").set(h.as(t)).send({ name: "Real Person", email: "real.person@pillar5.co.za" })
        : await h.api.post("/api/admin/users").set(h.as(t)).send({ name: "Real Person", email: "real.person@pillar5.co.za" });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toMatch(/demo\.example/);
    }
    expect(h.mailer.sent).toHaveLength(0);

    expect((await h.api.post("/api/people").set(h.as(manager)).send({ name: "Tester", email: "tester@demo.example" })).status).toBe(201);

    const imp = await h.api.post("/api/admin/import").set(h.as(admin)).send({ staff: [{ name: "Real", email: "real@pillar5.co.za" }, { name: "Test", email: "test2@demo.example" }] });
    expect(imp.body.people).toBe(1);
    expect(imp.body.skipped[0].reason).toMatch(/trial/);

    // A real administrator is not limited.
    const real = await h.user("admin", "The Real Admin");
    expect((await h.api.post("/api/admin/users").set(h.as(real.token)).send({ name: "Colleague", email: "colleague@pillar5.co.za" })).status).toBe(201);
  });
});
