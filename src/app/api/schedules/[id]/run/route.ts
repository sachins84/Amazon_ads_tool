import { type NextRequest } from "next/server";
import { getSchedule } from "@/lib/db/pause-schedules-repo";
import { executeScheduleAction, localParts, isValidTimeZone } from "@/lib/scheduler/pause-scheduler";

interface Params { params: Promise<{ id: string }> }

export const dynamic = "force-dynamic";

/**
 * POST /api/schedules/:id/run?action=pause|resume
 *
 * Manually fires a schedule's pause or resume NOW (trigger='manual'),
 * ignoring the time/weekday gate. Used for testing and ad-hoc control.
 * Still writes a run-audit row and stamps last-run markers. This pushes a
 * real state change to Amazon for every campaign in the schedule.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const actionParam = (req.nextUrl.searchParams.get("action") ?? "").toLowerCase();
  if (actionParam !== "pause" && actionParam !== "resume") {
    return Response.json({ error: "action must be 'pause' or 'resume'" }, { status: 400 });
  }
  const schedule = getSchedule(id);
  if (!schedule) return Response.json({ error: "Schedule not found" }, { status: 404 });

  const tz = isValidTimeZone(schedule.timezone) ? schedule.timezone : "UTC";
  const localDate = localParts(tz, new Date()).date;
  const action = actionParam === "pause" ? "PAUSE" : "RESUME";

  const result = await executeScheduleAction(schedule, action, "manual", localDate);
  return Response.json({ result }, { status: result.ok ? 200 : 207 });
}
