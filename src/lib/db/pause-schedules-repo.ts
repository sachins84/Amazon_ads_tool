/**
 * CRUD + execution bookkeeping for the campaign pause/unpause scheduler.
 *
 * A pause_schedule is a named list of campaigns (per account) that the
 * minute-tick cron pauses and/or resumes at user-defined local times on
 * chosen weekdays. See src/lib/scheduler/pause-scheduler.ts for the executor.
 */
import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";
import type { Program } from "@/lib/rules/types";

export type ScheduleAction = "PAUSE" | "RESUME";
export type ScheduleTrigger = "cron" | "manual";

export interface ScheduleCampaign {
  campaignId: string;
  program: Program;
  name: string | null;
}

export interface PauseSchedule {
  id: string;
  accountId: string;
  name: string;
  enabled: boolean;
  timezone: string;
  pauseAt: string | null;   // "HH:MM" local
  resumeAt: string | null;  // "HH:MM" local
  daysOfWeek: number[];     // 0=Sun .. 6=Sat
  lastPauseAt: string | null;
  lastResumeAt: string | null;
  lastPauseLocalDate: string | null;
  lastResumeLocalDate: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  campaigns: ScheduleCampaign[];
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  accountId: string;
  action: ScheduleAction;
  trigger: ScheduleTrigger;
  firedAt: string;
  campaignsTotal: number;
  okCount: number;
  failCount: number;
  message: string | null;
}

export interface ScheduleInput {
  accountId: string;
  name: string;
  enabled?: boolean;
  timezone: string;
  pauseAt: string | null;
  resumeAt: string | null;
  daysOfWeek: number[];
  campaigns: ScheduleCampaign[];
}

// ─── Row types + mappers ─────────────────────────────────────────────────────

interface ScheduleRow {
  id: string; account_id: string; name: string; enabled: number;
  timezone: string; pause_at: string | null; resume_at: string | null;
  days_of_week: string;
  last_pause_at: string | null; last_resume_at: string | null;
  last_pause_local_date: string | null; last_resume_local_date: string | null;
  last_error: string | null;
  created_at: string; updated_at: string;
}

function parseDays(csv: string): number[] {
  return csv.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}
function serializeDays(days: number[]): string {
  return [...new Set(days)].filter((n) => n >= 0 && n <= 6).sort((a, b) => a - b).join(",");
}

function rowToSchedule(r: ScheduleRow, campaigns: ScheduleCampaign[]): PauseSchedule {
  return {
    id: r.id, accountId: r.account_id, name: r.name, enabled: r.enabled === 1,
    timezone: r.timezone, pauseAt: r.pause_at, resumeAt: r.resume_at,
    daysOfWeek: parseDays(r.days_of_week),
    lastPauseAt: r.last_pause_at, lastResumeAt: r.last_resume_at,
    lastPauseLocalDate: r.last_pause_local_date, lastResumeLocalDate: r.last_resume_local_date,
    lastError: r.last_error,
    createdAt: r.created_at, updatedAt: r.updated_at,
    campaigns,
  };
}

function loadCampaigns(scheduleId: string): ScheduleCampaign[] {
  const rows = getDb()
    .prepare("SELECT campaign_id, program, name FROM pause_schedule_campaigns WHERE schedule_id = ? ORDER BY name")
    .all(scheduleId) as { campaign_id: string; program: string; name: string | null }[];
  return rows.map((r) => ({ campaignId: r.campaign_id, program: r.program as Program, name: r.name }));
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export function listSchedules(filter: { accountId?: string } = {}): PauseSchedule[] {
  const rows = filter.accountId
    ? getDb().prepare("SELECT * FROM pause_schedules WHERE account_id = ? ORDER BY created_at DESC").all(filter.accountId) as ScheduleRow[]
    : getDb().prepare("SELECT * FROM pause_schedules ORDER BY created_at DESC").all() as ScheduleRow[];
  return rows.map((r) => rowToSchedule(r, loadCampaigns(r.id)));
}

export function getSchedule(id: string): PauseSchedule | null {
  const row = getDb().prepare("SELECT * FROM pause_schedules WHERE id = ?").get(id) as ScheduleRow | undefined;
  return row ? rowToSchedule(row, loadCampaigns(id)) : null;
}

/** Enabled schedules (with campaigns) — the set the cron tick evaluates. */
export function listEnabledSchedules(): PauseSchedule[] {
  const rows = getDb().prepare("SELECT * FROM pause_schedules WHERE enabled = 1").all() as ScheduleRow[];
  return rows.map((r) => rowToSchedule(r, loadCampaigns(r.id)));
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export function setScheduleCampaigns(scheduleId: string, campaigns: ScheduleCampaign[]): void {
  const db = getDb();
  const tx = db.transaction((items: ScheduleCampaign[]) => {
    db.prepare("DELETE FROM pause_schedule_campaigns WHERE schedule_id = ?").run(scheduleId);
    const ins = db.prepare("INSERT INTO pause_schedule_campaigns (schedule_id, campaign_id, program, name) VALUES (?,?,?,?)");
    for (const c of items) ins.run(scheduleId, c.campaignId, c.program, c.name ?? null);
  });
  tx(campaigns);
}

export function createSchedule(input: ScheduleInput): PauseSchedule {
  const id = uuidv4();
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO pause_schedules (id, account_id, name, enabled, timezone, pause_at, resume_at, days_of_week)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      id, input.accountId, input.name, input.enabled ? 1 : 0,
      input.timezone, input.pauseAt, input.resumeAt, serializeDays(input.daysOfWeek),
    );
    const ins = db.prepare("INSERT INTO pause_schedule_campaigns (schedule_id, campaign_id, program, name) VALUES (?,?,?,?)");
    for (const c of input.campaigns) ins.run(id, c.campaignId, c.program, c.name ?? null);
  });
  tx();
  return getSchedule(id)!;
}

export function updateSchedule(
  id: string,
  patch: Partial<Omit<ScheduleInput, "accountId">>,
): PauseSchedule | null {
  const existing = getDb().prepare("SELECT id FROM pause_schedules WHERE id = ?").get(id) as { id: string } | undefined;
  if (!existing) return null;

  const fields: string[] = ["updated_at = datetime('now')"];
  const params: Record<string, unknown> = { id };
  if (patch.name       !== undefined) { fields.push("name = @name");                params.name = patch.name; }
  if (patch.enabled    !== undefined) { fields.push("enabled = @enabled");          params.enabled = patch.enabled ? 1 : 0; }
  if (patch.timezone   !== undefined) { fields.push("timezone = @timezone");        params.timezone = patch.timezone; }
  if (patch.pauseAt    !== undefined) { fields.push("pause_at = @pauseAt");          params.pauseAt = patch.pauseAt; }
  if (patch.resumeAt   !== undefined) { fields.push("resume_at = @resumeAt");        params.resumeAt = patch.resumeAt; }
  if (patch.daysOfWeek !== undefined) { fields.push("days_of_week = @daysOfWeek");   params.daysOfWeek = serializeDays(patch.daysOfWeek); }

  getDb().prepare(`UPDATE pause_schedules SET ${fields.join(", ")} WHERE id = @id`).run(params);
  if (patch.campaigns !== undefined) setScheduleCampaigns(id, patch.campaigns);
  return getSchedule(id);
}

export function deleteSchedule(id: string): boolean {
  return getDb().prepare("DELETE FROM pause_schedules WHERE id = ?").run(id).changes > 0;
}

/**
 * Stamp the last-run markers after an action fires. localDate is the schedule's
 * local YYYY-MM-DD (used by the tick to know the action already ran today);
 * error is the message when the run failed (null clears it).
 */
export function stampScheduleAction(
  id: string,
  action: ScheduleAction,
  opts: { at: string; localDate: string; error: string | null },
): void {
  const col = action === "PAUSE"
    ? { ts: "last_pause_at", date: "last_pause_local_date" }
    : { ts: "last_resume_at", date: "last_resume_local_date" };
  getDb().prepare(
    `UPDATE pause_schedules SET ${col.ts} = @at, ${col.date} = @localDate, last_error = @error, updated_at = datetime('now') WHERE id = @id`,
  ).run({ id, at: opts.at, localDate: opts.localDate, error: opts.error });
}

// ─── Run audit log ─────────────────────────────────────────────────────────

export function recordRun(run: Omit<ScheduleRun, "id" | "firedAt"> & { firedAt?: string }): ScheduleRun {
  const id = uuidv4();
  getDb().prepare(`
    INSERT INTO pause_schedule_runs (id, schedule_id, account_id, action, trigger, campaigns_total, ok_count, fail_count, message)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(id, run.scheduleId, run.accountId, run.action, run.trigger, run.campaignsTotal, run.okCount, run.failCount, run.message);
  const row = getDb().prepare("SELECT * FROM pause_schedule_runs WHERE id = ?").get(id) as {
    id: string; schedule_id: string; account_id: string; action: string; trigger: string;
    fired_at: string; campaigns_total: number; ok_count: number; fail_count: number; message: string | null;
  };
  return {
    id: row.id, scheduleId: row.schedule_id, accountId: row.account_id,
    action: row.action as ScheduleAction, trigger: row.trigger as ScheduleTrigger,
    firedAt: row.fired_at, campaignsTotal: row.campaigns_total,
    okCount: row.ok_count, failCount: row.fail_count, message: row.message,
  };
}

export function listRuns(scheduleId: string, limit = 20): ScheduleRun[] {
  const rows = getDb()
    .prepare("SELECT * FROM pause_schedule_runs WHERE schedule_id = ? ORDER BY fired_at DESC LIMIT ?")
    .all(scheduleId, limit) as {
      id: string; schedule_id: string; account_id: string; action: string; trigger: string;
      fired_at: string; campaigns_total: number; ok_count: number; fail_count: number; message: string | null;
    }[];
  return rows.map((row) => ({
    id: row.id, scheduleId: row.schedule_id, accountId: row.account_id,
    action: row.action as ScheduleAction, trigger: row.trigger as ScheduleTrigger,
    firedAt: row.fired_at, campaignsTotal: row.campaigns_total,
    okCount: row.ok_count, failCount: row.fail_count, message: row.message,
  }));
}
