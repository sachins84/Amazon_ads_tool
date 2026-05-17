/**
 * GET /api/version
 *
 * Returns the git commit SHA that's currently running on this server.
 * Use it to check whether a deploy actually picked up the latest code.
 *
 * If the SHA here doesn't match the latest commit on GitHub, the deploy
 * didn't land — even if Jenkins says "success".
 */
import { execSync } from "child_process";

let cached: { sha: string; time: string } | null = null;

function read(): { sha: string; time: string } {
  if (cached) return cached;
  try {
    const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const time = execSync("git log -1 --format=%cI", { encoding: "utf8" }).trim();
    cached = { sha, time };
  } catch {
    cached = { sha: "unknown", time: "unknown" };
  }
  return cached;
}

export async function GET() {
  const { sha, time } = read();
  return Response.json({
    commit: sha,
    committedAt: time,
    serverStartedAt: new Date(START_TIME).toISOString(),
    uptimeSec: Math.round((Date.now() - START_TIME) / 1000),
  });
}

const START_TIME = Date.now();
