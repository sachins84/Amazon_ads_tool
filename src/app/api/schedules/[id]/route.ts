import { type NextRequest } from "next/server";
import { getSchedule, updateSchedule, deleteSchedule, listRuns } from "@/lib/db/pause-schedules-repo";
import { isValidTimeZone } from "@/lib/scheduler/pause-scheduler";
import { normTime, normDays, normCampaigns } from "../route";

interface Params { params: Promise<{ id: string }> }

export const dynamic = "force-dynamic";

/** GET /api/schedules/:id → { schedule, runs } */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const schedule = getSchedule(id);
  if (!schedule) return Response.json({ error: "Schedule not found" }, { status: 404 });
  return Response.json({ schedule, runs: listRuns(id) });
}

/**
 * PUT /api/schedules/:id — partial update. Any of name, enabled, timezone,
 * pauseAt, resumeAt, daysOfWeek, campaigns. Validates only the fields present.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;

  const patch: Parameters<typeof updateSchedule>[1] = {};
  if (body.name !== undefined) {
    if (!String(body.name).trim()) return Response.json({ error: "name cannot be empty" }, { status: 400 });
    patch.name = String(body.name).trim();
  }
  if (body.enabled !== undefined)  patch.enabled = body.enabled === true;
  if (body.timezone !== undefined) {
    if (!isValidTimeZone(String(body.timezone))) return Response.json({ error: "valid IANA timezone required" }, { status: 400 });
    patch.timezone = String(body.timezone);
  }
  if (body.pauseAt !== undefined)    patch.pauseAt = normTime(body.pauseAt);
  if (body.resumeAt !== undefined)   patch.resumeAt = normTime(body.resumeAt);
  if (body.daysOfWeek !== undefined) patch.daysOfWeek = normDays(body.daysOfWeek);
  if (body.campaigns !== undefined)  patch.campaigns = normCampaigns(body.campaigns);

  const updated = updateSchedule(id, patch);
  if (!updated) return Response.json({ error: "Schedule not found" }, { status: 404 });
  return Response.json({ schedule: updated });
}

/** DELETE /api/schedules/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const deleted = deleteSchedule(id);
  if (!deleted) return Response.json({ error: "Schedule not found" }, { status: 404 });
  return Response.json({ success: true });
}
