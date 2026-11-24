"use client";

import { useEffect, useState, type FormEvent } from "react";
import { deleteEntry, discardTimer, editTimer, elapsedMs, isOverBudget, parseManualEntry, pauseTimer, resumeTimer, startTimer, stopTimer, type FieldError } from "@/lib/actions";
import { api } from "@/lib/api";
import { cycleIndexOf, cycleRange, summarize } from "@/lib/cycles";
import { clock, fmtDur, fmtH, fmtRange, ymd } from "@/lib/dates";
import { useStore } from "@/lib/store";
import { Page } from "../app-shell";
import { EntryItem, EntryList, Meter, Stat, deptById, staffById } from "../shared";
import { Icon } from "../ui/icon";
import { Button, Buttons, Card, CardHeader, Empty, Field, FormError, Grid2, Muted, PageHead, Row2, cn, focusField } from "../ui/primitives";

export function TrackView() {
  const { data, prefs } = useStore();
  const me = staffById(data, prefs.staffId) ?? data.staff[0];
  if (!me) {
    return (
      <Page>
        <Empty>Add staff in Team and settings first.</Empty>
      </Page>
    );
  }
  // Keyed by person so a half-written draft does not leak to the next person picked.
  return <TrackForm key={me.id} staffId={me.id} />;
}

function useTick(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

function TrackForm({ staffId }: { staffId: string }) {
  const { data, me: account, update, mutate, saveTimerText, showToast } = useStore();
  // Management can type hours in for other people and teams.
  const canLogForOthers = account.appRole === "manager" || account.appRole === "ceo" || account.appRole === "admin";
  const minRun = data.settings.minTimerMinutes ?? 1;
  const me = staffById(data, staffId)!;
  const dept = deptById(data, me.dept);
  const activeProjects = data.projects.filter((p) => p.active !== false);
  const timer = data.timers[staffId];
  const active = !!timer;
  const running = !!timer?.running;
  useTick(running);

  const [draft, setDraft] = useState({ projectId: activeProjects[0]?.id ?? "", task: data.tasks[0] ?? "", note: "", proof: "" });
  const [noteError, setNoteError] = useState<FieldError | null>(null);
  const [proofError, setProofError] = useState<FieldError | null>(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualError, setManualError] = useState<FieldError | null>(null);

  const src = timer ?? draft;
  const setNote = (note: string) => {
    if (timer) {
      update((d) => editTimer(d, staffId, { note }));
      saveTimerText({ note });
    } else setDraft((s) => ({ ...s, note }));
    if (noteError && note.trim().length >= 5) setNoteError(null);
  };
  const setProof = (proof: string) => {
    if (timer) {
      update((d) => editTimer(d, staffId, { proof }));
      saveTimerText({ proof });
    } else setDraft((s) => ({ ...s, proof }));
  };

  const idx = cycleIndexOf(data.settings, new Date());
  const s = summarize(data, idx);
  const r = cycleRange(data.settings, idx);
  const mine = s.list.filter((e) => e.staffId === staffId);
  const myApproved = mine.filter((e) => e.status === "approved").reduce((a, e) => a + e.minutes, 0);
  const myPending = mine.filter((e) => e.status === "pending").reduce((a, e) => a + e.minutes, 0);
  const today = ymd(new Date());

  const fail = (e: FieldError, set: (e: FieldError) => void) => {
    set(e);
    focusField(e.field);
  };

  const start = async () => {
    const r = await mutate((d) => startTimer(d, staffId, draft), () => api.startTimer(draft));
    if (!r.ok) return;
    setDraft((s) => ({ ...s, note: "", proof: "" }));
    showToast("Timer started");
  };

  const stop = async () => {
    const result = stopTimer(data, staffId, { note: timer?.note ?? "", proof: timer?.proof ?? "" });
    if (!result.ok) {
      setNoteError(null);
      setProofError(null);
      return fail(result.error, result.error.field === "t-proof" ? setProofError : setNoteError);
    }
    const sent = await mutate(() => result.data, () => api.stopTimer({ note: timer?.note ?? "", proof: timer?.proof ?? "" }), { toast: false });
    if (!sent.ok) {
      const e = sent.error;
      return fail({ message: e.message, field: e.field === "t-proof" ? "t-proof" : "t-note" }, e.field === "t-proof" ? setProofError : setNoteError);
    }
    setNoteError(null);
    setProofError(null);
    setDiscardArmed(false);
    showToast(`${fmtDur(sent.value.minutes)} submitted for approval${isOverBudget(result.data, new Date()) ? ". This cycle is now above the hours allocated." : ""}`);
  };

  const submitManual = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const get = (k: string) => String(f.get(k) ?? "");
    const forId = canLogForOthers ? get("who") || staffId : staffId;
    const onBehalf = forId !== staffId;
    const parsed = parseManualEntry(
      {
        date: get("date"),
        start: get("start"),
        end: get("end"),
        projectId: get("projectId"),
        task: get("task"),
        note: get("note"),
        reason: get("reason") || (onBehalf ? "Logged by management" : ""),
      },
      new Date(),
    );
    if (!parsed.ok) return fail(parsed.error, setManualError);
    const sent = await mutate(
      null,
      () =>
        api.addManualEntry({
          staffId: onBehalf ? forId : undefined,
          projectId: get("projectId"),
          task: get("task"),
          note: parsed.note,
          start: parsed.start.toISOString(),
          end: parsed.end.toISOString(),
          reason: parsed.reason,
        }),
      { toast: false },
    );
    if (!sent.ok) {
      const fieldIds: Record<string, string> = { start: "m-date", end: "m-end", note: "m-note", reason: "m-reason", proof: "m-note", projectId: "m-proj", task: "m-task" };
      return fail({ message: sent.error.message, field: fieldIds[sent.error.field ?? ""] }, setManualError);
    }
    showToast(
      onBehalf
        ? `${fmtDur(sent.value.minutes)} logged for ${staffById(data, forId)?.name ?? "them"}. Another manager needs to approve it.`
        : `${fmtDur(sent.value.minutes)} submitted for approval${isOverBudget(data, parsed.start) ? ". This cycle is now above the hours allocated." : ""}`,
    );
    form.reset();
    setManualError(null);
    setManualOpen(false);
  };

  return (
    <Page>
      <PageHead title="Track time">
        {me.name} · {me.role} · {dept?.name ?? ""}
      </PageHead>

      <Grid2>
        <Card aria-labelledby="tmr-h">
          <CardHeader>
            <h3 id="tmr-h" className="font-bold">Timer</h3>
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span
                className={cn("size-2.5 rounded-full", running ? "pulse-on bg-ok" : active ? "bg-warn" : "bg-muted")}
              />
              {running ? "Running" : active ? "Paused" : "Not started"}
            </span>
          </CardHeader>

          <div className="num text-[clamp(2.75rem,10vw,4rem)] leading-none font-semibold tracking-tight" aria-live="off">
            {clock(timer ? elapsedMs(timer) : 0)}
          </div>

          {minRun > 1 && (
            <p className="text-sm text-muted">
              A timer has to run for at least {minRun} minutes before you can submit it.
              {active && elapsedMs(timer!) < minRun * 60000 ? ` ${fmtDur(Math.ceil((minRun * 60000 - elapsedMs(timer!)) / 60000))} to go.` : ""}
            </p>
          )}

          <Row2>
            <Field label="Project" htmlFor="t-proj">
              <select
                id="t-proj"
                disabled={active}
                value={src.projectId}
                onChange={(e) => setDraft((s) => ({ ...s, projectId: e.target.value }))}
              >
                {activeProjects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Type of work" htmlFor="t-task">
              <select
                id="t-task"
                disabled={active}
                value={src.task}
                onChange={(e) => setDraft((s) => ({ ...s, task: e.target.value }))}
              >
                {data.tasks.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </Row2>

          <Field
            label="What did you work on?"
            htmlFor="t-note"
            hint="The client sees this note in the report. Keep it short and clear."
            hintId="t-note-h"
            error={noteError?.message}
            errorId="t-note-err"
          >
            <textarea
              id="t-note"
              aria-describedby="t-note-h t-note-err"
              aria-invalid={!!noteError?.field}
              placeholder="For example: built the payment page and fixed two bugs"
              value={src.note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          <Field label="Proof link (optional)" htmlFor="t-proof" error={proofError?.message}>
            <input
              id="t-proof"
              type="url"
              aria-invalid={!!proofError}
              inputMode="url"
              placeholder="Link to a file, design, commit or ticket"
              value={src.proof}
              onChange={(e) => setProof(e.target.value)}
            />
          </Field>

          <Buttons>
            {!active ? (
              <Button variant="primary" onClick={() => void start()}>
                <Icon name="play" />
                Start timer
              </Button>
            ) : (
              <>
                {running ? (
                  <Button onClick={() => void mutate((d) => pauseTimer(d, staffId), api.pauseTimer)}>
                    <Icon name="pause" />
                    Pause
                  </Button>
                ) : (
                  <Button onClick={() => void mutate((d) => resumeTimer(d, staffId), api.resumeTimer)}>
                    <Icon name="play" />
                    Resume
                  </Button>
                )}
                <Button variant="primary" onClick={() => void stop()}>
                  <Icon name="stop" />
                  Stop and submit
                </Button>
                {discardArmed ? (
                  <>
                    <Button
                      variant="bad"
                      onClick={() => {
                        void mutate((d) => discardTimer(d, staffId), api.discardTimer);
                        setDiscardArmed(false);
                        setNoteError(null);
                        showToast("Timer discarded");
                      }}
                    >
                      Yes, discard
                    </Button>
                    <Button variant="ghost" onClick={() => setDiscardArmed(false)}>
                      Keep timer
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setDiscardArmed(true)}>
                    Discard
                  </Button>
                )}
              </>
            )}
          </Buttons>

          <details
            className="group border-t border-line pt-3.5"
            open={manualOpen}
            onToggle={(e) => setManualOpen(e.currentTarget.open)}
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
              <span className="inline-grid size-[22px] place-items-center rounded-md bg-surface-2 font-bold">{manualOpen ? "−" : "+"}</span>
              Forgot to start the timer? Type in your hours
            </summary>
            <p className="mt-2 text-sm text-muted">Typed-in time is marked for the manager to check more closely, so add a reason.</p>
            <form
              noValidate
              onSubmit={submitManual}
              onBlur={(e) => {
                const t = e.target as unknown as HTMLInputElement;
                if (t.required && !t.value.trim()) t.setAttribute("aria-invalid", "true");
                else t.removeAttribute("aria-invalid");
              }}
              className="mt-2 grid gap-3"
            >
              {canLogForOthers && (
                <Field label="Who worked these hours?" htmlFor="m-who" hint="Pick someone else to log time for them. Another manager then approves it.">
                  <select id="m-who" name="who" defaultValue={staffId}>
                    {data.staff
                      .filter((p) => p.active !== false)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id === staffId ? `${p.name} (you)` : `${p.name}, ${deptById(data, p.dept)?.name ?? "no department"}`}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              <Row2 three>
                <Field label="Date" htmlFor="m-date">
                  <input id="m-date" name="date" type="date" required min={ymd(r.start)} max={today} defaultValue={today} />
                </Field>
                <Field label="Start" htmlFor="m-start">
                  <input id="m-start" name="start" type="time" required defaultValue="09:00" />
                </Field>
                <Field label="End" htmlFor="m-end">
                  <input id="m-end" name="end" type="time" required defaultValue="10:00" />
                </Field>
              </Row2>
              <Row2>
                <Field label="Project" htmlFor="m-proj">
                  <select id="m-proj" name="projectId" defaultValue={draft.projectId}>
                    {activeProjects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Type of work" htmlFor="m-task">
                  <select id="m-task" name="task" defaultValue={draft.task}>
                    {data.tasks.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
              </Row2>
              <Field label="What did you work on?" htmlFor="m-note">
                <textarea id="m-note" name="note" required />
              </Field>
              <Field label="Why was the timer not used?" htmlFor="m-reason" hint={canLogForOthers ? "Leave empty when you are logging for someone else." : undefined}>
                <input id="m-reason" name="reason" type="text" required placeholder="For example: meeting was off-site" />
              </Field>
              <FormError message={manualError?.message} />
              <Buttons>
                <Button variant="primary" type="submit">
                  <Icon name="plus" />
                  Submit hours
                </Button>
              </Buttons>
            </form>
          </details>
        </Card>

        <Card aria-labelledby="glance-h">
          <CardHeader>
            <h3 id="glance-h" className="font-bold">This cycle</h3>
            <Muted>{fmtRange(r)}</Muted>
          </CardHeader>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="You logged" value={fmtH(myApproved + myPending)} sub={`${fmtH(myApproved)} h approved`} />
            {s.remaining < 0 ? (
              <Stat label="Client extra hours" value={fmtH(-s.remaining)} sub={`above the ${fmtH(s.budget)} h allocated`} tone="extra" />
            ) : (
              <Stat label="Client hours left" value={fmtH(s.remaining)} sub={`of ${fmtH(s.budget)} h allocated`} />
            )}
          </div>
          <Meter s={s} showPending />
          <h3 className="font-bold">Your latest entries</h3>
          {mine.length ? (
            <EntryList>
              {mine.slice(0, 3).map((e) => (
                <EntryItem
                  key={e.id}
                  entry={e}
                  canDelete
                  onDelete={(id) => {
                    void mutate((d) => deleteEntry(d, id), () => api.deleteEntry(id)).then((r) => r.ok && showToast("Entry deleted"));
                  }}
                />
              ))}
            </EntryList>
          ) : (
            <Empty>You have not logged time in this cycle yet. Start the timer when you begin a task.</Empty>
          )}
        </Card>
      </Grid2>
    </Page>
  );
}
