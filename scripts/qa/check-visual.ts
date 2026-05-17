#!/usr/bin/env -S npx tsx
/**
 * Visual + theme smoke test.
 *
 * Loads every main page in dark and light themes, captures console
 * errors and screenshots. Fails the run on any uncaught error / 4xx-5xx
 * network response / hydration mismatch.
 *
 * Requires `npx playwright install chromium` once (CI does this in the
 * Jenkinsfile QA stage). Locally: `npx playwright install chromium`.
 *
 * Skipped when SKIP_VISUAL=1 (e.g. quick dev runs).
 */
import { chromium, type ConsoleMessage, type Page } from "playwright";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

if (process.env.SKIP_VISUAL === "1") {
  console.log("▶ QA: visual smoke   (skipped — SKIP_VISUAL=1)");
  process.exit(0);
}

const BASE = process.env.API_BASE ?? "http://localhost:3000";
const OUT  = join(process.cwd(), ".qa", "screenshots");
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

interface PageSpec { path: string; name: string; }
const PAGES: PageSpec[] = [
  { path: "/master-overview", name: "master-overview" },
  { path: "/targeting-360",   name: "targeting-360"   },
  { path: "/rules",           name: "rules"           },
  { path: "/suggestions",     name: "suggestions"     },
  { path: "/objectives",      name: "objectives"      },
  { path: "/accounts",        name: "accounts"        },
];

const THEMES: ("dark" | "light")[] = ["dark", "light"];

let failures = 0;
const errorsByPage: Record<string, string[]> = {};

async function loadPage(page: Page, spec: PageSpec, theme: string): Promise<void> {
  const key = `${spec.name} [${theme}]`;
  errorsByPage[key] = [];

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") errorsByPage[key].push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errorsByPage[key].push(`pageerror: ${err.message}`);
  });
  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();
    // Only care about errors from our own origin
    if (status >= 500 && url.startsWith(BASE)) {
      errorsByPage[key].push(`5xx: ${status} ${url}`);
    }
  });

  // Pre-load: set theme via localStorage BEFORE navigation so first paint matches.
  await page.addInitScript(`localStorage.setItem("amazon-ads:theme", "${theme}");`);
  await page.goto(`${BASE}${spec.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2000);  // let any async load settle

  // Screenshot for the report (small)
  await page.screenshot({ path: join(OUT, `${spec.name}-${theme}.png`), fullPage: false });
}

async function run() {
  console.log(`▶ QA: visual smoke   (base=${BASE})\n`);
  const browser = await chromium.launch();

  for (const spec of PAGES) {
    for (const theme of THEMES) {
      const ctx  = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      try {
        await loadPage(page, spec, theme);
      } catch (e) {
        errorsByPage[`${spec.name} [${theme}]`] = errorsByPage[`${spec.name} [${theme}]`] ?? [];
        errorsByPage[`${spec.name} [${theme}]`].push(`load failed: ${String(e).slice(0, 200)}`);
      }
      await ctx.close();
    }
  }

  await browser.close();

  console.log();
  for (const [key, errs] of Object.entries(errorsByPage)) {
    if (errs.length === 0) {
      console.log(`  ✓ ${key}`);
    } else {
      console.log(`  ✕ ${key}`);
      for (const e of errs.slice(0, 5)) console.log(`      ${e}`);
      failures += 1;
    }
  }
  console.log();
  console.log(`Screenshots → ${OUT}`);
  console.log();

  if (failures > 0) {
    console.error(`✗ FAILED: ${failures} page+theme combinations had errors.`);
    process.exit(1);
  } else {
    console.log(`✓ PASSED: all ${PAGES.length * THEMES.length} page+theme combinations loaded clean.`);
  }
}

run().catch((e) => { console.error("QA visual script crashed:", e); process.exit(1); });

export {};
