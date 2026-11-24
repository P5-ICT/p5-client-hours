"use client";

import { useState, type FormEvent } from "react";
import { approveTimerEntries, parseSettings, reviewEntry, type FieldError } from "@/lib/actions";
import { ApiError, api, type InviteResult } from "@/lib/api";
import { canAddPeopleRole, canApproveRole, isAdminRole } from "@/lib/auth";
import { fmtH } from "@/lib/dates";
import { useStore } from "@/lib/store";
import type { AppRole } from "@/lib/types";
import { Page } from "../app-shell";
import { CycleNav, DeptCell, EntryItem, EntryList, useCycle } from "../shared";
import { Icon } from "../ui/icon";
import { Button, Buttons, Card, CardHeader, Empty, Field, FormError, Grid2, Muted, PageHead, Pill, Row2, TableWrap, focusField } from "../ui/primitives";

export function ApprovalsView() {
  const { data, me, mutate, showToast } = useStore();
  const canApprove = canApproveRole(me.appRole);
  const list = data.entries
    .filter((e) => e.status === "pending")
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  // Nobody approves their own hours, so those are shown but cannot be actioned by the author.
  const mine = (e: { staffId: string; loggedById?: string | null }) => e.staffId === me.id || e.loggedById === me.id;
  const ownCount = list.filter(mine).length;
  const timerCount = list.filter((e) => e.method === "timer" && !mine(e)).length;

  return (
    <Page>
      <PageHead
        title="Approvals"
        action={
          canApprove &&
          timerCount > 0 && (
            <Button
              variant="ok"
              onClick={async () => {
                const r = await mutate(
                  (d) => approveTimerEntries(d, me.id).data,
                  () => api.approveTimerEntries(),
                );
                if (r.ok) showToast(`${r.value.count} entries approved`);
              }}
            >
              <Icon name="check" />
              Approve all {timerCount} timer entries
            </Button>
          )
        }
      >
        {canApprove
          ? "Check each entry before it counts towards the client's hours. Typed-in entries show the reason the timer was not used."
          : "You can see what is waiting. Only managers and the CEO can approve hours."}
        {canApprove && ownCount > 0 && ` ${ownCount} ${ownCount === 1 ? "entry is" : "entries are"} yours, or typed in by you, so another manager approves ${ownCount === 1 ? "it" : "them"}.`}
      </PageHead>
      {list.length ? (
        <EntryList>
          {list.map((e) => (
            <EntryItem
              key={e.id}
              entry={e}
              showPerson
              review={
                canApprove && !mine(e)
                  ? {
                      onApprove: async (id) => {
                        const r = await mutate((d) => reviewEntry(d, id, "approved", "", me.id), () => api.review(id, "approved", ""));
                        if (r.ok) showToast("Entry approved");
                      },
                      onReject: async (id, reason) => {
                        const r = await mutate((d) => reviewEntry(d, id, "rejected", reason, me.id), () => api.review(id, "rejected", reason));
                        if (r.ok) showToast("Entry rejected");
                      },
                    }
                  : undefined
              }
            />
          ))}
        </EntryList>
      ) : (
        <Empty>Nothing waiting. All entries are reviewed.</Empty>
      )}
    </Page>
  );
}

export function AllEntriesView() {
  const { data } = useStore();
  const { offset, step, summary } = useCycle();
  const [dept, setDept] = useState("all");
  const [status, setStatus] = useState("all");
  const list = summary.list.filter((e) => {
    const p = data.staff.find((x) => x.id === e.staffId);
    return (dept === "all" || p?.dept === dept) && (status === "all" || e.status === status);
  });
  const total = list.reduce((a, e) => a + e.minutes, 0);
  return (
    <Page>
      <PageHead title="All entries" action={<CycleNav offset={offset} step={step} />}>
        {list.length} entries, {fmtH(total)} h in this view.
      </PageHead>
      <div className="max-w-[560px]">
        <Row2>
          <Field label="Department" htmlFor="f-dept">
            <select id="f-dept" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="all">All departments</option>
              {data.departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="f-status">
            <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">All</option>
              <option value="approved">Approved</option>
              <option value="pending">Awaiting approval</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>
        </Row2>
      </div>
      {list.length ? (
        <EntryList>
          {list.map((e) => (
            <EntryItem key={e.id} entry={e} showPerson />
          ))}
        </EntryList>
      ) : (
        <Empty>No entries match these filters.</Empty>
      )}
    </Page>
  );
}

const ACCESS_LABELS: Record<AppRole, string> = {
  staff: "Staff",
  manager: "Manager (approves hours)",
  ceo: "CEO (sees everything, approves hours)",
  admin: "Admin (manages people and settings)",
  client: "Client (sees approved hours only)",
};

interface IssuedLink extends InviteResult {
  name: string;
}

/** How the client's hours are split between departments (for example marketing gets 8 of the 45). Leave a box empty for no split. */
function DepartmentHours() {
  const { data, mutate, showToast } = useStore();
  const [error, setError] = useState<string | null>(null);
  const total = data.settings.budgetHours;
  const split = data.departments.reduce((a, d) => a + (d.hours ?? 0), 0);

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const changes: Array<{ id: string; hours: number | null }> = [];
    for (const d of data.departments) {
      const raw = String(f.get(`dept-${d.id}`) ?? "").trim();
      const hours = raw === "" ? null : parseFloat(raw);
      if (hours !== null && !(hours >= 0)) {
        setError(`Hours for ${d.name} must be 0 or more.`);
        return focusField(`dh-${d.id}`);
      }
      if (hours !== (d.hours ?? null)) changes.push({ id: d.id, hours });
    }
    if (!changes.length) return showToast("Nothing changed");
    for (const c of changes) {
      const r = await mutate(null, () => api.patchDepartment(c.id, { allocatedHours: c.hours }), { toast: false });
      if (!r.ok) {
        setError(r.error.message);
        return;
      }
    }
    setError(null);
    showToast("Department hours saved");
  };

  return (
    <Card aria-labelledby="dh-h">
      <CardHeader>
        <h3 id="dh-h" className="font-bold">
          Hours for each department
        </h3>
        <Muted>
          {fmtH(split * 60)} of {fmtH(total * 60)} h split
        </Muted>
      </CardHeader>
      <p className="text-sm text-muted">
        Share the {fmtH(total * 60)} hours between departments. Reports then show what each department used against its share. Leave a box empty for no share.
      </p>
      <form noValidate onSubmit={save} className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {data.departments.map((d) => (
            <Field key={d.id} label={d.name} htmlFor={`dh-${d.id}`}>
              <input id={`dh-${d.id}`} name={`dept-${d.id}`} type="number" min={0} step={0.5} inputMode="decimal" defaultValue={d.hours ?? ""} />
            </Field>
          ))}
        </div>
        {split > total && <p className="text-sm text-bad">The shares add up to more than the {fmtH(total * 60)} hours for the cycle.</p>}
        <FormError message={error} />
        <Buttons>
          <Button variant="primary" type="submit">
            <Icon name="check" />
            Save department hours
          </Button>
        </Buttons>
      </form>
    </Card>
  );
}

export function SetupView() {
  const { data, me, mutate, showToast } = useStore();
  const admin = isAdminRole(me.appRole);
  // Managers and the CEO add the people on their team (staff and clients). Only an administrator can create the other kinds.
  const canAdd = canAddPeopleRole(me.appRole);
  const st = data.settings;
  const [settingsError, setSettingsError] = useState<FieldError | null>(null);
  const [importError, setImportError] = useState<FieldError | null>(null);
  const [personError, setPersonError] = useState<FieldError | null>(null);
  const [teamJson, setTeamJson] = useState("");
  const [links, setLinks] = useState<IssuedLink[]>([]);
  const [skipped, setSkipped] = useState<Array<{ name: string; reason: string }>>([]);

  const fail = (e: FieldError, set: (e: FieldError) => void) => {
    set(e);
    focusField(e.field);
  };
  const apiFail = (e: ApiError, fallbackField: string, set: (e: FieldError) => void) => fail({ message: e.message, field: fallbackField }, set);

  // When email is not set up (or fails), the admin has to pass the link on by hand.
  const remember = (name: string, r: InviteResult) => {
    if (!r.emailed) setLinks((l) => [{ name, ...r }, ...l]);
  };

  const submitSettings = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    const r = parseSettings({ clientName: get("client"), budgetHours: get("hours"), cycleDays: get("days"), minTimerMinutes: get("min"), anchor: get("anchor") });
    if (!r.ok) return fail(r.error, setSettingsError);
    const sent = await mutate(null, () => api.saveSettings(r.values), { toast: false });
    if (!sent.ok) return apiFail(sent.error, "s-client", setSettingsError);
    setSettingsError(null);
    showToast("Settings saved");
  };

  const submitPerson = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const get = (k: string) => String(f.get(k) ?? "").trim();
    if (!get("name")) return fail({ message: "Add the person's name.", field: "p-name" }, setPersonError);
    if (!get("email")) return fail({ message: "Add their email address. They sign in with it.", field: "p-email" }, setPersonError);
    const name = get("name");
    const sent = await mutate(
      null,
      () => {
        const person = { name, email: get("email"), jobTitle: get("title"), departmentId: get("dept") || null };
        const access = (get("access") || "staff") as AppRole;
        return admin ? api.addUser({ ...person, appRole: access }) : api.addPerson({ ...person, appRole: access === "client" ? "client" : "staff" });
      },
      { toast: false },
    );
    if (!sent.ok) return apiFail(sent.error, "p-email", setPersonError);
    remember(name, sent.value);
    setPersonError(null);
    form.reset();
    showToast(sent.value.emailed ? `Invite sent to ${name}` : `${name} added. Send them the link below.`);
  };

  const runImport = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(teamJson.trim());
    } catch {
      return fail({ message: "This is not valid JSON. Copy the full block, including the curly brackets.", field: "imp" }, setImportError);
    }
    const sent = await mutate(null, () => api.importTeam(parsed), { toast: false });
    if (!sent.ok) return apiFail(sent.error, "imp", setImportError);
    sent.value.invites.forEach((i) => remember(i.name, i));
    setSkipped(sent.value.skipped);
    setImportError(null);
    setTeamJson("");
    showToast(`Imported ${sent.value.people} people and ${sent.value.projects} projects`);
  };

  const sendLink = async (id: string, name: string) => {
    const r = await mutate(null, () => api.inviteUser(id));
    if (!r.ok) return;
    remember(name, r.value);
    showToast(r.value.emailed ? `Link emailed to ${name}` : `New link for ${name} is below`);
  };

  const setActive = async (id: string, name: string, active: boolean) => {
    const r = await mutate(null, () => api.patchUser(id, { active }));
    if (r.ok) showToast(active ? `${name} can sign in again` : `${name} can no longer sign in`);
  };

  const addProject = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const name = String(new FormData(form).get("project") ?? "").trim();
    if (!name) return focusField("pr-name");
    const r = await mutate(null, () => api.addProject(name));
    if (r.ok) {
      form.reset();
      showToast("Project added");
    }
  };

  const addDepartment = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const name = String(new FormData(form).get("department") ?? "").trim();
    if (!name) return focusField("dp-name");
    const r = await mutate(null, () => api.addDepartment(name));
    if (r.ok) {
      form.reset();
      showToast("Department added");
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Link copied");
    } catch {
      showToast("Select the link and copy it by hand");
    }
  };

  return (
    <Page>
      <PageHead title="Team and settings">
        {admin
          ? "Set the hours per cycle, and add the people who use Client Hours."
          : "Add the people on your team here. They get an email to choose their password. Only an administrator can change the hours and settings."}
      </PageHead>

      <Grid2>
        <Card>
          <h3 className="font-bold">Client and hours</h3>
          {/* Keyed on the saved values so the form shows fresh defaults after a save. */}
          <form key={`${st.clientName}|${st.budgetHours}|${st.cycleDays}|${st.minTimerMinutes}|${st.anchor}`} noValidate onSubmit={submitSettings} className="grid gap-3">
            <fieldset disabled={!admin} className="m-0 grid min-w-0 gap-3 border-0 p-0">
              <Field label="Client name" htmlFor="s-client">
                <input id="s-client" name="client" type="text" required defaultValue={st.clientName} />
              </Field>
              <Row2>
                <Field label="Hours per cycle" htmlFor="s-hours">
                  <input id="s-hours" name="hours" type="number" min={1} step={0.5} required defaultValue={st.budgetHours} />
                </Field>
                <Field label="Cycle length (days)" htmlFor="s-days">
                  <input id="s-days" name="days" type="number" min={1} max={62} required defaultValue={st.cycleDays} />
                </Field>
              </Row2>
              <Field
                label="Shortest timer that can be submitted (minutes)"
                htmlFor="s-min"
                hint="A timer has to run this long before staff can stop and submit it. Use 1 for no limit."
              >
                <input id="s-min" name="min" type="number" min={1} max={240} required defaultValue={st.minTimerMinutes ?? 1} />
              </Field>
              <Field
                label="First day of a cycle"
                htmlFor="s-anchor"
                hint="Cycles repeat from this date. Hours reset at the start of each cycle."
              >
                <input id="s-anchor" name="anchor" type="date" required defaultValue={st.anchor} />
              </Field>
            </fieldset>
            <FormError message={settingsError?.message} />
            {admin && (
              <Buttons>
                <Button variant="primary" type="submit">
                  <Icon name="check" />
                  Save settings
                </Button>
              </Buttons>
            )}
          </form>
        </Card>

        {canAdd && (
          <Card>
            <h3 className="font-bold">Add a person</h3>
            <p className="text-sm text-muted">They get an email with a link to choose their password.</p>
            <form noValidate onSubmit={submitPerson} className="grid gap-3">
              <Row2>
                <Field label="Name" htmlFor="p-name">
                  <input id="p-name" name="name" type="text" autoComplete="off" required />
                </Field>
                <Field label="Email" htmlFor="p-email">
                  <input id="p-email" name="email" type="email" autoComplete="off" inputMode="email" required />
                </Field>
              </Row2>
              <Row2>
                <Field label="Job title" htmlFor="p-title">
                  <input id="p-title" name="title" type="text" autoComplete="off" />
                </Field>
                <Field label="Department" htmlFor="p-dept">
                  <select id="p-dept" name="dept" defaultValue="">
                    <option value="">None</option>
                    {data.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </Row2>
              <Field label="Access" htmlFor="p-access">
                <select id="p-access" name="access" defaultValue="staff">
                  {(Object.keys(ACCESS_LABELS) as AppRole[])
                    .filter((r) => admin || r === "staff" || r === "client")
                    .map((r) => (
                    <option key={r} value={r}>
                      {ACCESS_LABELS[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <FormError message={personError?.message} />
              <Buttons>
                <Button variant="primary" type="submit">
                  <Icon name="plus" />
                  Add and invite
                </Button>
              </Buttons>
            </form>
            {admin && (
              <form noValidate onSubmit={addDepartment} className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <Field label="New department" htmlFor="dp-name">
                  <input id="dp-name" name="department" type="text" autoComplete="off" />
                </Field>
                <Button type="submit">Add department</Button>
              </form>
            )}
          </Card>
        )}
      </Grid2>

      {links.length > 0 && (
        <Card role="region" aria-label="Links to send">
          <CardHeader>
            <h3 className="font-bold">Links to send by hand</h3>
            <Button variant="ghost" onClick={() => setLinks([])}>
              Clear
            </Button>
          </CardHeader>
          <p className="text-sm text-muted">Email is not set up, or it failed. Send each person their own link. It works for 7 days and only once.</p>
          <ul className="m-0 grid list-none gap-3 p-0">
            {links.map((l) => (
              <li key={l.link} className="grid gap-1.5">
                <label htmlFor={`link-${l.link.slice(-8)}`} className="text-sm font-semibold">
                  {l.name}
                </label>
                <div className="flex gap-2">
                  <input id={`link-${l.link.slice(-8)}`} readOnly value={l.link} className="num min-w-0 flex-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button onClick={() => void copy(l.link)}>Copy</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {admin && <DepartmentHours />}

      {admin && (
        <Card>
          <h3 className="font-bold">Load the team from a list</h3>
          <p className="text-sm text-muted">
            Paste the team JSON (from Airtable), with an <code>email</code> for each person. People who already have an account are left alone. Nothing is deleted.
          </p>
          <Field label="Team JSON" htmlFor="imp" error={importError?.message}>
            <textarea
              id="imp"
              className="num min-h-[140px] w-full text-xs"
              value={teamJson}
              aria-invalid={!!importError}
              onChange={(e) => setTeamJson(e.target.value)}
              placeholder='{"departments":[{"name":"ICT"}],"staff":[{"name":"...","email":"...","role":"...","department":"ICT"}],"projects":[{"name":"..."}]}'
            />
          </Field>
          <Buttons>
            <Button variant="primary" onClick={() => void runImport()}>
              <Icon name="download" />
              Import team
            </Button>
          </Buttons>
          {skipped.length > 0 && (
            <div role="status" className="text-sm">
              <strong>Not imported:</strong>
              <ul className="m-0 list-disc pl-5">
                {skipped.map((s, i) => (
                  <li key={i}>
                    {s.name}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader>
          <h3 className="font-bold">Team</h3>
          <Muted>{data.staff.filter((p) => p.active !== false).length} active people</Muted>
        </CardHeader>
        <TableWrap>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Department</th>
              {admin && <th>Access</th>}
              {admin && <th>Status</th>}
              {admin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.staff.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap">
                  {p.name}
                  {admin && p.email && <span className="block text-xs text-muted">{p.email}</span>}
                </td>
                <td>{p.role}</td>
                <DeptCell id={p.dept} />
                {admin && <td>{p.appRole ? ACCESS_LABELS[p.appRole].split(" (")[0] : ""}</td>}
                {admin && (
                  <td>{p.active === false ? <Pill tone="rejected">Inactive</Pill> : p.invited ? <Pill tone="pending">Invited</Pill> : <Pill tone="approved">Active</Pill>}</td>
                )}
                {admin && (
                  <td>
                    <div className="flex flex-wrap gap-1.5">
                      {p.active !== false && (
                        <Button className="min-h-11 px-3 text-sm" onClick={() => void sendLink(p.id, p.name)}>
                          {p.invited ? "Resend invite" : "Reset password"}
                        </Button>
                      )}
                      {p.id !== me.id && (
                        <Button variant={p.active === false ? "default" : "ghost"} className="min-h-11 px-3 text-sm" onClick={() => void setActive(p.id, p.name, p.active === false)}>
                          {p.active === false ? "Reactivate" : "Deactivate"}
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <h3 className="font-bold">Projects</h3>
        <ul className="m-0 grid list-none gap-1 p-0 text-sm">
          {data.projects.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <span className={p.active === false ? "text-muted line-through" : ""}>{p.name}</span>
              {admin && (
                <Button
                  variant="ghost"
                  className="min-h-11 px-3 text-sm"
                  onClick={() => void mutate(null, () => api.patchProject(p.id, { active: p.active === false }))}
                >
                  {p.active === false ? "Restore" : "Archive"}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {admin && (
          <form noValidate onSubmit={addProject} className="flex flex-wrap items-end gap-2">
            <Field label="New project" htmlFor="pr-name">
              <input id="pr-name" name="project" type="text" autoComplete="off" />
            </Field>
            <Button type="submit">Add project</Button>
          </form>
        )}
      </Card>
    </Page>
  );
}
