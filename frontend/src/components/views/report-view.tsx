"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { csvForRange } from "@/lib/csv";
import { cycleIndexOf, extensionsFor } from "@/lib/cycles";
import { fmtDay, fmtH } from "@/lib/dates";
import { downloadText, downloadXlsx } from "@/lib/download";
import { reportFileName, reportSheets } from "@/lib/excel";
import { buildExecutiveReport, reportToText, type ExecutiveReport } from "@/lib/executive";
import { PERIOD_LABELS, cycleIndexOfPeriod, periodLabel, periodRange, periodSubtitle, previousPeriod, summarizePeriod, type Period, type PeriodKind } from "@/lib/periods";
import { useStore } from "@/lib/store";
import { Page } from "../app-shell";
import { DeptBars, Meter, ProjectTable, deptById, projById, staffById } from "../shared";
import { Icon } from "../ui/icon";
import { Button, Card, CardHeader, Empty, Eyebrow, IconButton, TableWrap, cn } from "../ui/primitives";

/** The page does not print or download from inside an iframe (e.g. a preview pane). */
const inFrame = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

const KINDS: PeriodKind[] = ["cycle", "week", "month"];

function PeriodPicker({ period, onChange, label }: { period: Period; onChange: (p: Period) => void; label: string }) {
  const current = period.offset === 0;
  return (
    <div className="flex flex-wrap items-center gap-3 print:hidden">
      <div role="group" aria-label="Report period" className="inline-flex rounded-full bg-surface-2 p-[3px]">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={period.kind === k}
            onClick={() => onChange({ kind: k, offset: 0 })}
            className={cn(
              "min-h-[38px] cursor-pointer rounded-full px-4 text-sm font-semibold transition-colors duration-200",
              period.kind === k ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
            )}
          >
            {PERIOD_LABELS[k]}
          </button>
        ))}
      </div>
      <div role="group" aria-label={`Choose a ${PERIOD_LABELS[period.kind].toLowerCase()}`} className="flex items-center gap-2 rounded-full border border-line bg-surface p-[3px]">
        <IconButton aria-label="Earlier" onClick={() => onChange({ ...period, offset: period.offset - 1 })}>
          <Icon name="left" />
        </IconButton>
        <div className="min-w-0 px-1.5 text-center">
          <strong className="block text-[0.9375rem] whitespace-nowrap">{label}</strong>
          <span className="block text-xs text-muted">{periodSubtitle(period)}</span>
        </div>
        <IconButton aria-label="Later" disabled={current} onClick={() => onChange({ ...period, offset: Math.min(0, period.offset + 1) })}>
          <Icon name="right" />
        </IconButton>
      </div>
    </div>
  );
}

function ExecutiveSummary({ report, onCopy }: { report: ExecutiveReport; onCopy: () => void }) {
  return (
    <Card aria-labelledby="exec-h">
      <CardHeader>
        <div>
          <h3 id="exec-h" className="font-bold">
            Summary of the work
          </h3>
          <p className="text-sm text-muted">Written from the approved entries. Nothing is added by hand.</p>
        </div>
        <Button onClick={onCopy} className="print:hidden">
          <Icon name="copy" />
          Copy as text
        </Button>
      </CardHeader>
      <div className="grid gap-4">
        {report.sections.map((sec) => (
          <section key={sec.heading} className="grid gap-1.5">
            <h4 className="text-[0.9375rem] font-bold">{sec.heading}</h4>
            {sec.paragraphs?.map((t) => (
              <p key={t} className="text-[0.9375rem]">
                {t}
              </p>
            ))}
            {sec.table && (
              <TableWrap>
                <thead>
                  <tr>
                    {sec.table.head.map((h, i) => (
                      <th key={h} className={i > 0 ? "text-right" : undefined}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sec.table.rows.map((r, ri) => (
                    <tr key={ri}>
                      {r.map((c, i) => (
                        <td key={i} className={i > 0 ? "num text-right" : undefined}>
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
            {sec.bullets && (
              <ul className="m-0 grid list-disc gap-1 pl-5 text-[0.9375rem]">
                {sec.bullets.map((b) => (
                  <li key={b} className="[overflow-wrap:anywhere]">
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}

/**
 * The hours report. The client opens it from their own account (approved work only, because that is all the server sends them);
 * management opens the same report to pull a week, a month or a cycle before invoicing.
 */
export function ReportView({ audience }: { audience: "client" | "management" }) {
  const { data, showToast, loadHistory } = useStore();
  const [period, setPeriod] = useState<Period>({ kind: "cycle", offset: 0 });
  const [csvFallback, setCsvFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The summary compares with the period before, so load back to the start of that one.
  const cyclesNeeded = useMemo(() => {
    const earliest = periodRange(data, previousPeriod(period)).start;
    return cycleIndexOf(data.settings, new Date()) - cycleIndexOf(data.settings, earliest) + 1;
  }, [data, period]);
  useEffect(() => {
    void loadHistory(cyclesNeeded);
  }, [cyclesNeeded, loadHistory]);

  const s = useMemo(() => summarizePeriod(data, period), [data, period]);
  const report = useMemo(() => buildExecutiveReport(data, period, new Date(), { internal: audience === "management" }), [data, period, audience]);
  const label = periodLabel(period.kind, s.range);
  const cycleIndex = cycleIndexOfPeriod(data, period);
  const extensions = cycleIndex === null ? [] : extensionsFor(data, cycleIndex);
  const hasBudget = cycleIndex !== null && s.budget > 0;
  const over = hasBudget && s.approved > s.budget;
  const log = s.list.filter((e) => e.status === "approved");

  const copyText = async (text: string, done: string, fallback?: boolean) => {
    try {
      await navigator.clipboard.writeText(text);
      setCsvFallback(null);
      showToast(done);
    } catch {
      if (fallback) {
        setCsvFallback(text);
        requestAnimationFrame(() => {
          const f = document.getElementById("csv-fb") as HTMLTextAreaElement | null;
          f?.focus();
          f?.select();
        });
      } else showToast("Copy did not work in this browser. Select the text and copy it by hand.");
    }
  };

  const downloadExcel = async () => {
    setBusy(true);
    try {
      await downloadXlsx(reportSheets(data, period), reportFileName(data, period, "xlsx"));
    } catch {
      showToast("The Excel file could not be made. Try the CSV instead.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <span className="grid flex-none place-items-center rounded-lg border border-line bg-white px-2.5 py-1">
            <Image src="/pillar5-logo.png" alt="Pillar 5, Above Average" width={319} height={236} className="block h-[84px] w-auto max-w-none" />
          </span>
          <div>
            <Eyebrow>{audience === "client" ? "Hours report" : "Reports"}</Eyebrow>
            <h2 className="text-xl font-bold">{data.settings.clientName}</h2>
            <p className="max-w-[62ch] text-muted">
              Work done by Pillar 5 Group, {label}. Every entry counted here was approved by a manager.
            </p>
          </div>
        </div>
      </div>

      <PeriodPicker period={period} onChange={setPeriod} label={label} />

      <div className={cn("grid gap-1.5 rounded-card px-5 py-[18px]", over ? "bg-extra-soft" : "bg-accent-soft")}>
        <strong className="text-lg">{report.headline}</strong>
        <span className="text-sm">
          {Object.keys(s.byStaff).length} people from {Object.keys(s.byDept).length} departments worked on {Object.keys(s.byProject).length} projects in this{" "}
          {PERIOD_LABELS[period.kind].toLowerCase()}.
        </span>
      </div>

      {hasBudget && (
        <Card>
          <h3 className="font-bold">Hours used</h3>
          <Meter s={s} showPending={false} />
          {extensions.length > 0 && (
            <ul className="m-0 grid list-disc gap-0.5 pl-5 text-sm text-muted">
              {extensions.map((x) => (
                <li key={x.id}>
                  {fmtH(x.hours * 60)} h added by management: {x.reason}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ExecutiveSummary report={report} onCopy={() => void copyText(reportToText(report), "Summary copied")} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card>
          <h3 className="font-bold">Hours by department</h3>
          <DeptBars s={s} showAllocation={hasBudget} />
        </Card>
        <Card>
          <h3 className="font-bold">Hours by project</h3>
          <ProjectTable s={s} />
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h3 className="font-bold">Work log</h3>
          <div className="flex flex-wrap items-center gap-2.5 print:hidden">
            {!inFrame() && (
              <>
                <Button variant="primary" disabled={busy} onClick={() => void downloadExcel()}>
                  <Icon name="download" />
                  {busy ? "Preparing…" : "Download Excel"}
                </Button>
                <Button onClick={() => downloadText(csvForRange(data, s.range), reportFileName(data, period, "csv"))}>
                  <Icon name="download" />
                  Download CSV
                </Button>
                <Button onClick={() => window.print()}>
                  <Icon name="print" />
                  Print or save PDF
                </Button>
              </>
            )}
            <Button onClick={() => void copyText(csvForRange(data, s.range), "Work log copied as CSV", true)}>
              <Icon name="copy" />
              Copy as CSV
            </Button>
          </div>
        </CardHeader>

        {csvFallback && (
          <>
            <label htmlFor="csv-fb" className="text-sm font-semibold">
              Copy failed. Select this text and copy it.
            </label>
            <textarea id="csv-fb" readOnly value={csvFallback} className="num min-h-[140px] w-full text-xs" />
          </>
        )}

        {log.length ? (
          <TableWrap>
            <thead>
              <tr>
                <th>Date</th>
                <th>Person</th>
                <th>Department</th>
                <th>Project</th>
                <th>Work done</th>
                <th className="text-right">Hours</th>
              </tr>
            </thead>
            <tbody>
              {log.map((e) => {
                const p = staffById(data, e.staffId);
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{fmtDay(new Date(e.start))}</td>
                    <td className="whitespace-nowrap">
                      {p?.name ?? ""}
                      <br />
                      <span className="text-muted">{p?.role ?? ""}</span>
                    </td>
                    <td className="whitespace-nowrap">{(p && deptById(data, p.dept)?.name) ?? ""}</td>
                    <td>{projById(data, e.projectId)?.name ?? ""}</td>
                    <td className="max-w-[360px] min-w-[220px]">
                      {e.task}: {e.note}
                    </td>
                    <td className="num text-right">{fmtH(e.minutes)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Total approved</td>
                <td className="num text-right">{fmtH(s.approved)}</td>
              </tr>
            </tfoot>
          </TableWrap>
        ) : (
          <Empty>No approved work in this {PERIOD_LABELS[period.kind].toLowerCase()} yet.</Empty>
        )}
      </Card>
    </Page>
  );
}
