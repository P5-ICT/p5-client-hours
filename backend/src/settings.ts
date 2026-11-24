import type { Db } from "./db.js";
import type { CycleSettings } from "./rules.js";

export interface SettingsRow extends CycleSettings {
  clientName: string;
  budgetHours: number;
  /** A timer must have run at least this long before it can be submitted. */
  minTimerMinutes: number;
}

/** The settings row is created by the first admin start-up, so it is always there once the app is running. */
export async function loadSettings(db: Db): Promise<SettingsRow> {
  const { rows } = await db.query<{ client_name: string; budget_hours: number; cycle_days: number; cycle_anchor: string; timezone: string; min_timer_minutes: number }>(
    "select client_name, budget_hours, cycle_days, cycle_anchor, timezone, min_timer_minutes from settings where id = 1",
  );
  const r = rows[0];
  if (!r) throw new Error("Settings have not been created. Run the bootstrap (start the server once).");
  return { clientName: r.client_name, budgetHours: r.budget_hours, cycleDays: r.cycle_days, cycleAnchor: r.cycle_anchor, timezone: r.timezone, minTimerMinutes: r.min_timer_minutes };
}

/** Hours available in the cycle that starts on `cycleStart`: the usual hours plus anything management added. */
export async function budgetHoursFor(db: Db, settings: SettingsRow, cycleStart: string): Promise<number> {
  const { rows } = await db.query<{ total: number | null }>("select sum(hours) as total from hour_extensions where cycle_start = $1", [cycleStart]);
  return settings.budgetHours + Number(rows[0]?.total ?? 0);
}
