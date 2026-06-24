import { type NextRequest } from "next/server";
import { listSchedules, createSchedule, type ScheduleCampaign } from "@/lib/db/pause-schedules-repo";
import { isValidTimeZone } from "@/lib/scheduler/pause-scheduler";
import type { Program } from "@/lib/rules/types";

export const dynamic = "force-dynamic";

/** GET /api/schedules?accountId=… → { schedules } */
export async function GET(req: NextRequest) {
  const accountId = req.nextUrl.searchParams.get("accountId") ?? undefined;
  return Response.json({ schedules: listSchedules({ accountId }) });
}

/** POST /api/schedules — create a pause/unpause schedule. */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const err = validate(body);
  if (err) return Response.json({ error: err }, { status: 400 });
  try {
    const schedule = createSchedule({
      accountId:   String(body.accountId),
      name:        String(body.name).trim(),
      enabled:     body.enabled === true,
      timezone:    String(body.timezone),
      pauseAt:     normTime(body.pauseAt),
      resumeAt:    normTime(body.resumeAt),
      daysOfWeek:  normDays(body.daysOfWeek),
      campaigns:   normCampaigns(body.campaigns),
    });
    return Response.json({ schedule }, { status: 201 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
}

// ─── Validation helpers (shared shape with PUT) ──────────────────────────────

export function validate(body: Record<string, unknown>): string | null {
  if (!body.accountId) return "accountId required";
  if (!body.name || !String(body.name).trim()) return "name required";
  if (!body.timezone || !isValidTimeZone(String(body.timezone))) return "valid IANA timezone required";
  const pause = normTime(body.pauseAt), resume = normTime(body.resumeAt);
  if (!pause && !resume) return "set at least one of pause time / resume time";
  const days = normDays(body.daysOfWeek);
  if (days.length === 0) return "select at least one weekday";
  if (!Array.isArray(body.campaigns) || body.campaigns.length === 0) return "add at least one campaign";
  return null;
}

/** Accept "HH:MM"; return null for empty/invalid. */
export function normTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function normDays(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
}

export function normCampaigns(v: unknown): ScheduleCampaign[] {
  if (!Array.isArray(v)) return [];
  const valid: Program[] = ["SP", "SB", "SD"];
  return v
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c) => ({
      campaignId: String(c.campaignId),
      program: (valid.includes(c.program as Program) ? c.program : "SP") as Program,
      name: c.name != null ? String(c.name) : null,
    }))
    .filter((c) => c.campaignId);
}
