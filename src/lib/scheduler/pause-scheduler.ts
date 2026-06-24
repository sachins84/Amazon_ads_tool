/**
 * Pause/unpause scheduler executor.
 *
 * A single minute-tick cron (registered in instrumentation-node.ts) calls
 * runScheduleTick(). For each enabled schedule it computes — in the schedule's
 * own timezone — whether a pause or resume action is due right now, and if so
 * fires it through the shared campaign-state write path (setCampaignState).
 *
 * Firing rule (per action): the current local weekday is selected AND the
 * current local time is within a short grace window after the target time AND
 * the action hasn't already fired for the current local date. The grace window
 * (default 15 min) tolerates a slightly delayed tick without firing
 * retroactively hours later — so enabling a schedule at 14:00 whose pause time
 * is 09:00 will NOT immediately pause; it waits for the next 09:00.
 */
import { getAccount } from "@/lib/db/accounts";
import { setCampaignState } from "@/lib/rules/applier";
import {
  listEnabledSchedules, recordRun, stampScheduleAction,
  type PauseSchedule, type ScheduleAction, type ScheduleTrigger,
} from "@/lib/db/pause-schedules-repo";
import type { Program } from "@/lib/rules/types";

const GRACE_MIN = Math.max(1, Math.min(60, parseInt(process.env.SCHEDULER_GRACE_MIN || "15", 10) || 15));

// ─── Timezone helpers ─────────────────────────────────────────────────────────

interface LocalParts { date: string; hhmm: string; dow: number }

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; }
  catch { return false; }
}

/** Current local date (YYYY-MM-DD), time (HH:MM, 24h) and weekday (0=Sun) in tz. */
export function localParts(tz: string, now: Date): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(now)) map[p.type] = p.value;
  const hour = map.hour === "24" ? "00" : map.hour; // some runtimes emit "24" at midnight
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    hhmm: `${hour}:${map.minute}`,
    dow: dowMap[map.weekday] ?? 0,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Is `now` within [target, target + grace] minutes on the same local day? */
function dueWithinGrace(target: string, nowHhmm: string): boolean {
  const t = toMinutes(target), n = toMinutes(nowHhmm);
  return n >= t && n - t <= GRACE_MIN;
}

// ─── Due computation ───────────────────────────────────────────────────────

export interface DueAction { schedule: PauseSchedule; action: ScheduleAction; localDate: string }

/** Pure: which actions are due for these schedules at `now`. Exported for tests. */
export function computeDueActions(schedules: PauseSchedule[], now: Date): DueAction[] {
  const due: DueAction[] = [];
  for (const s of schedules) {
    const tz = isValidTimeZone(s.timezone) ? s.timezone : "UTC";
    const { date, hhmm, dow } = localParts(tz, now);
    if (!s.daysOfWeek.includes(dow)) continue;
    if (s.pauseAt && dueWithinGrace(s.pauseAt, hhmm) && s.lastPauseLocalDate !== date) {
      due.push({ schedule: s, action: "PAUSE", localDate: date });
    }
    if (s.resumeAt && dueWithinGrace(s.resumeAt, hhmm) && s.lastResumeLocalDate !== date) {
      due.push({ schedule: s, action: "RESUME", localDate: date });
    }
  }
  return due;
}

// ─── Execution ─────────────────────────────────────────────────────────────

export interface ExecResult { ok: boolean; okCount: number; failCount: number; total: number; message: string }

/**
 * Apply one action (PAUSE/RESUME) for one schedule: groups campaigns by program,
 * pushes the state change per program, writes an audit row, and stamps the
 * last-run markers. localDate is the schedule's local date used to prevent the
 * tick from re-firing the same action again today.
 */
export async function executeScheduleAction(
  schedule: PauseSchedule,
  action: ScheduleAction,
  trigger: ScheduleTrigger,
  localDate: string,
): Promise<ExecResult> {
  const state = action === "PAUSE" ? "PAUSED" : "ENABLED";
  const acct = getAccount(schedule.accountId);

  const finish = (ok: boolean, okCount: number, failCount: number, total: number, message: string): ExecResult => {
    recordRun({ scheduleId: schedule.id, accountId: schedule.accountId, action, trigger, campaignsTotal: total, okCount, failCount, message });
    stampScheduleAction(schedule.id, action, { at: new Date().toISOString(), localDate, error: ok ? null : message });
    return { ok, okCount, failCount, total, message };
  };

  if (!acct) return finish(false, 0, 0, schedule.campaigns.length, `account ${schedule.accountId} not found`);
  if (schedule.campaigns.length === 0) return finish(true, 0, 0, 0, "no campaigns in schedule");

  // Group campaign IDs by program — each program has its own update endpoint.
  const byProgram = new Map<Program, string[]>();
  for (const c of schedule.campaigns) {
    const arr = byProgram.get(c.program) ?? [];
    arr.push(c.campaignId);
    byProgram.set(c.program, arr);
  }

  let okCount = 0, failCount = 0;
  const messages: string[] = [];
  for (const [program, ids] of byProgram) {
    const res = await setCampaignState(acct.adsProfileId, schedule.accountId, program, ids, state);
    if (res.ok) {
      okCount += ids.length;
    } else {
      failCount += ids.length;
      messages.push(`${program}: ${res.message}`);
    }
  }

  const ok = failCount === 0;
  const message = ok ? `${action.toLowerCase()}d ${okCount} campaign(s)` : messages.join(" | ");
  return finish(ok, okCount, failCount, schedule.campaigns.length, message);
}

// ─── Tick ────────────────────────────────────────────────────────────────

let running = false;

/** Cron entry point — evaluate all enabled schedules and fire due actions. */
export async function runScheduleTick(trigger: ScheduleTrigger = "cron"): Promise<{ fired: number }> {
  if (running) {
    console.warn("[scheduler] previous tick still running, skipping");
    return { fired: 0 };
  }
  running = true;
  try {
    const now = new Date();
    const due = computeDueActions(listEnabledSchedules(), now);
    for (const d of due) {
      try {
        const r = await executeScheduleAction(d.schedule, d.action, trigger, d.localDate);
        console.log(`[scheduler] ${d.action} "${d.schedule.name}" (${d.schedule.accountId}) — ${r.message}`);
      } catch (err) {
        console.error(`[scheduler] ${d.action} "${d.schedule.name}" failed`, err);
      }
    }
    return { fired: due.length };
  } finally {
    running = false;
  }
}
