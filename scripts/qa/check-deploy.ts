#!/usr/bin/env -S npx tsx
/**
 * Post-deploy smoke: did the server actually pick up the latest code?
 *
 * Compares the local HEAD commit (or $EXPECTED_SHA) to what /api/version
 * reports on the running server. Fails the build when they diverge.
 *
 * Used by the Jenkinsfile right after the deploy step.
 */
import { execSync } from "child_process";

const BASE     = process.env.API_BASE ?? "http://localhost:3000";
const EXPECTED = (process.env.EXPECTED_SHA ?? execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()).slice(0, 7);

async function run() {
  console.log(`▶ QA: deploy SHA check   (base=${BASE}, expected=${EXPECTED})\n`);

  const res = await fetch(`${BASE}/api/version`);
  if (!res.ok) {
    console.error(`✗ /api/version returned HTTP ${res.status}`);
    process.exit(1);
  }
  const data = await res.json() as { commit: string; uptimeSec?: number; serverStartedAt?: string };
  const live = (data.commit ?? "").slice(0, 7);

  console.log(`  expected: ${EXPECTED}`);
  console.log(`  live:     ${live}`);
  console.log(`  uptime:   ${data.uptimeSec ?? "?"}s  (started ${data.serverStartedAt})`);
  console.log();

  if (live === EXPECTED) {
    console.log(`✓ PASSED: server is running the expected commit.`);
    return;
  }

  console.error(`✗ FAILED: server commit ${live} does not match expected ${EXPECTED}.`);
  console.error(`  Likely causes:`);
  console.error(`   - pm2 reload (not restart) — kept old in-memory build`);
  console.error(`   - skipped 'rm -rf .next && npm run build' step`);
  console.error(`   - git pull pulled but Jenkins ran on a previous checkout`);
  console.error(`  Run scripts/deploy.sh manually on the prod box.`);
  process.exit(1);
}

run().catch((e) => { console.error("QA deploy-check crashed:", e); process.exit(1); });

export {};
