"use client";

import { summarize } from "@/lib/cycles";
import { fmtH, fmtRange } from "@/lib/dates";
import { deleteEntry } from "@/lib/actions";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Page } from "../app-shell";
import { ExtendHoursCard } from "./extend-hours";
import { CycleNav, DailyChart, DeptBars, EntryItem, EntryList, Meter, PeopleTable, ProjectTable, StatTiles, useCycle } from "../shared";
import { Card, CardHeader, Empty, Grid2, Muted, PageHead } from "../ui/primitives";

/** "My entries": the signed-in person's entries for the chosen cycle. */
export function MyEntriesView() {
  const { prefs, mutate, showToast } = useStore();
  const { offset, step, summary } = useCycle();
  const list = summary.list.filter((e) => e.staffId === prefs.staffId);
  const total = list.filter((e) => e.status !== "rejected").reduce((a, e) => a + e.minutes, 0);
  return (
    <Page>
      <PageHead title="My entries" action={<CycleNav offset={offset} step={step} />}>
        {fmtH(total)} h logged in this cycle. You can delete an entry while it is awaiting approval.
      </PageHead>
      {list.length ? (
        <EntryList>
          {list.map((e) => (
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
        <Empty>No entries in this cycle.</Empty>
      )}
    </Page>
  );
}

/** Shared by the staff and manager "Overview" tabs. */
export function OverviewView() {
  const { data } = useStore();
  const { offset, index, step, summary: s } = useCycle();
  const last = summarize(data, index - 1);
  return (
    <Page>
      <PageHead title="Overview" action={<CycleNav offset={offset} step={step} />}>
        All departments working for {data.settings.clientName}. Only approved hours count towards the {fmtH(s.budget)} hours allocated.
      </PageHead>

      <StatTiles s={s} />

      <ExtendHoursCard cycleIndex={index} summary={s} />

      <Card>
        <CardHeader>
          <h3 className="font-bold">Hours used</h3>
          <Muted>Resets every {data.settings.cycleDays} days</Muted>
        </CardHeader>
        <Meter s={s} showPending />
        {last.approved > 0 && (
          <p className="text-sm text-muted">
            Previous cycle: {fmtH(last.approved)} h approved of {fmtH(last.budget)} h allocated
            {last.approved > last.budget ? `, which is ${fmtH(last.approved - last.budget)} h extra.` : "."}
          </p>
        )}
      </Card>

      <Grid2>
        <Card>
          <CardHeader>
            <h3 className="font-bold">Hours by department</h3>
            <Muted>Approved</Muted>
          </CardHeader>
          <DeptBars s={s} showAllocation />
        </Card>
        <Card>
          <CardHeader>
            <h3 className="font-bold">Hours per day</h3>
            <Muted>Approved, {fmtRange(s.range)}</Muted>
          </CardHeader>
          <DailyChart s={s} isCurrent={offset === 0} />
        </Card>
      </Grid2>

      <Card>
        <h3 className="font-bold">Hours by project</h3>
        <ProjectTable s={s} />
      </Card>

      <Card>
        <h3 className="font-bold">Who worked</h3>
        <PeopleTable s={s} withPending />
      </Card>
    </Page>
  );
}
