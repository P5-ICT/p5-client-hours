import { describe, expect, it } from "vitest";
import {
  canApprove,
  cycleIndexAt,
  cycleStartYmd,
  elapsedMs,
  isSafeUrl,
  localDayNumber,
  minutesBetween,
  thresholdsReached,
  validateManualTimes,
  validatePassword,
} from "../src/rules.js";

const cycle = { cycleAnchor: "2026-10-05", cycleDays: 14, timezone: "Africa/Johannesburg" };

describe("who can approve", () => {
  it("is limited to managers and the CEO", () => {
    expect(canApprove("manager")).toBe(true);
    expect(canApprove("ceo")).toBe(true);
    expect(["staff", "client", "admin"].some((r) => canApprove(r as never))).toBe(false);
  });
});

describe("cycles in Africa/Johannesburg", () => {
  it("puts a late-night UTC time into the next local day", () => {
    // 22:30 UTC on 4 Oct is 00:30 SAST on 5 Oct: the first day of the cycle, not the day before.
    expect(cycleIndexAt(cycle, new Date("2026-10-04T22:30:00Z"))).toBe(0);
    expect(cycleIndexAt(cycle, new Date("2026-10-04T21:30:00Z"))).toBe(-1);
  });
  it("rolls over to the next cycle at local midnight", () => {
    expect(cycleIndexAt(cycle, new Date("2026-10-18T21:59:00Z"))).toBe(0); // 23:59 SAST on 18 Oct
    expect(cycleIndexAt(cycle, new Date("2026-10-18T22:00:00Z"))).toBe(1); // 00:00 SAST on 19 Oct
  });
  it("finds the first day of a cycle", () => {
    expect(cycleStartYmd(cycle, 0)).toBe("2026-10-05");
    expect(cycleStartYmd(cycle, 1)).toBe("2026-10-19");
    expect(cycleStartYmd(cycle, -1)).toBe("2026-09-21");
  });
  it("counts calendar days in the given zone", () => {
    const a = localDayNumber(new Date("2026-10-04T22:30:00Z"), "Africa/Johannesburg");
    const b = localDayNumber(new Date("2026-10-04T22:30:00Z"), "UTC");
    expect(a - b).toBe(1);
  });
});

describe("alert thresholds", () => {
  it("fires 80 at 80% and both at 100%", () => {
    expect(thresholdsReached(0, 45)).toEqual([]);
    expect(thresholdsReached(45 * 60 * 0.79, 45)).toEqual([]);
    expect(thresholdsReached(45 * 60 * 0.8, 45)).toEqual([80]);
    expect(thresholdsReached(45 * 60, 45)).toEqual([80, 100]);
    expect(thresholdsReached(52.5 * 60, 45)).toEqual([80, 100]);
  });
});

describe("input rules", () => {
  it("allows only web links as proof", () => {
    expect(isSafeUrl("https://example.com/a")).toBe(true);
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("data:text/html,x")).toBe(false);
  });
  it("rejects bad manual times", () => {
    const now = new Date("2026-10-12T12:00:00Z");
    const t = (s: string) => new Date(s);
    expect(validateManualTimes(t("2026-10-12T09:00:00Z"), t("2026-10-12T10:00:00Z"), now)).toBeNull();
    expect(validateManualTimes(t("2026-10-12T10:00:00Z"), t("2026-10-12T09:00:00Z"), now)?.field).toBe("end");
    expect(validateManualTimes(t("2026-10-12T11:00:00Z"), t("2026-10-12T13:00:00Z"), now)?.message).toMatch(/future/);
    expect(validateManualTimes(new Date("nope"), t("2026-10-12T13:00:00Z"), now)).not.toBeNull();
  });
  it("needs a long enough password", () => {
    expect(validatePassword("short")).not.toBeNull();
    expect(validatePassword("a-long-password-1")).toBeNull();
  });
  it("adds up timer time", () => {
    const startedAt = new Date("2026-10-12T10:00:00Z");
    const now = new Date("2026-10-12T10:30:00Z");
    expect(elapsedMs({ startedAt, accMs: 60_000, running: true }, now)).toBe(31 * 60_000);
    expect(elapsedMs({ startedAt, accMs: 60_000, running: false }, now)).toBe(60_000);
    expect(minutesBetween(startedAt, now)).toBe(30);
  });
});
