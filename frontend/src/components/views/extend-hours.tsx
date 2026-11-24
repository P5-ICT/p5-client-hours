"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { extensionsFor } from "@/lib/cycles";
import { fmtDay, fmtH, ymd } from "@/lib/dates";
import { useStore } from "@/lib/store";
import type { Summary } from "@/lib/types";
import { staffById } from "../shared";
import { Icon } from "../ui/icon";
import { Button, Buttons, Card, CardHeader, Field, FormError, Muted, Row2, focusField } from "../ui/primitives";

/** Management can add hours to a cycle when a project needs more. Staff and the client never see the form. */
export function ExtendHoursCard({ cycleIndex, summary }: { cycleIndex: number; summary: Summary }) {
  const { data, me, mutate, showToast } = useStore();
  const [error, setError] = useState<{ message: string; field: string } | null>(null);
  const allowed = me.appRole === "manager" || me.appRole === "ceo" || me.appRole === "admin";
  if (!allowed) return null;

  const cycleStart = ymd(summary.range.start);
  const added = extensionsFor(data, cycleIndex);
  const addedHours = added.reduce((a, x) => a + x.hours, 0);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const hours = parseFloat(String(f.get("hours") ?? ""));
    const reason = String(f.get("reason") ?? "").trim();
    const fail = (message: string, field: string) => {
      setError({ message, field });
      focusField(field);
    };
    if (!(hours > 0)) return fail("Enter how many hours to add.", "x-hours");
    if (!reason) return fail("Say why the extra hours are needed. The client can see this.", "x-reason");
    const r = await mutate(null, () => api.addExtension({ cycleStart, hours, reason }), { toast: false });
    if (!r.ok) return fail(r.error.message, r.error.field === "hours" ? "x-hours" : "x-reason");
    setError(null);
    form.reset();
    showToast(`${fmtH(hours * 60)} hours added to this cycle`);
  };

  return (
    <Card aria-labelledby="ext-h">
      <CardHeader>
        <h3 id="ext-h" className="font-bold">
          Hours for this cycle
        </h3>
        <Muted>Management only</Muted>
      </CardHeader>
      <p className="text-[0.9375rem]">
        <strong className="num">{fmtH(summary.budget)} h</strong> available: {fmtH(data.settings.budgetHours * 60)} h usual
        {addedHours > 0 ? ` plus ${fmtH(addedHours * 60)} h added by management` : ""}.
      </p>

      {added.length > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0">
          {added.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2 text-sm">
              <span>
                <strong className="num">+{fmtH(x.hours * 60)} h</strong> · {x.reason}
                <span className="block text-xs text-muted">
                  {staffById(data, x.by)?.name ?? "Removed person"} · {fmtDay(new Date(x.at))}
                </span>
              </span>
              <Button
                variant="ghost"
                className="min-h-11 px-3 text-sm"
                onClick={() => void mutate(null, () => api.removeExtension(x.id)).then((r) => r.ok && showToast("Extra hours removed"))}
              >
                <Icon name="trash" />
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form noValidate onSubmit={submit} className="grid gap-3 border-t border-line pt-3">
        <Row2>
          <Field label="Hours to add" htmlFor="x-hours">
            <input id="x-hours" name="hours" type="number" min={0.5} step={0.5} inputMode="decimal" />
          </Field>
          <Field label="Why are they needed?" htmlFor="x-reason">
            <input id="x-reason" name="reason" type="text" autoComplete="off" placeholder="For example: launch week for the new site" />
          </Field>
        </Row2>
        <FormError message={error?.message} />
        <Buttons>
          <Button type="submit">
            <Icon name="plus" />
            Add hours to this cycle
          </Button>
        </Buttons>
      </form>
    </Card>
  );
}
