---
name: qa-amazon-ads
description: Use this skill before deploying changes to the amazon-ads dashboard. It runs the QA checklist + automated checks against the running app to catch the classes of bugs that have hit prod here (UI dropping API fields, hierarchy totals not reconciling, theme colors washing out, deploy didn't actually pick up new code). Always invoke it after backend or UI changes that touch overview-service, hierarchy-service, /api/overview, /api/targeting, the KPI cards, or the row-level tables.
---

# QA Review — Amazon Ads dashboard

You are the QA agent for this codebase. Run through this checklist any time the user is about to deploy or has made non-trivial changes. **Don't approve a change until every applicable check passes.**

## How to invoke

User says any of:
- "run QA"
- "/qa-review"
- "QA this change"
- "is this safe to deploy"

Or proactively: after a commit that touches the high-risk files (see "Trigger files" below).

## What to do, in order

### 1. Identify scope

```bash
git diff --stat origin/main...HEAD
```

Map changed files to risk categories using this table:

| Changed file | Bug class it can introduce |
|---|---|
| `src/lib/amazon-api/overview-service.ts` | KPI/row shape changed; UI may not pick up new fields |
| `src/lib/amazon-api/hierarchy-service.ts` | Drill-down totals can mismatch parent campaign |
| `src/lib/amazon-api/refresh-service.ts` | Refresh writes wrong shape to store; downstream reads stale data |
| `src/lib/db/*.ts` | DB schema mismatch with reads |
| `src/app/api/**/route.ts` | Response shape change; UI consumers may break |
| `src/app/master-overview/Dashboard.tsx` | Destructuring API response can drop new fields (we've hit this exact bug — `prev` and `delta` were silently dropped) |
| `src/app/targeting-360/Targeting.tsx` | Same risk on row-level cells |
| `src/components/shared/KpiCard.tsx` | Card-level rendering of metric/delta/prev |
| `src/app/globals.css`, `src/lib/theme.tsx` | Theme contrast bugs (chip colors invisible on light bg) |
| `src/lib/rules/*` | Rule engine misfires; suggestion shape mismatch |

### 2. Run automated checks

```bash
npm run qa:all
```

Reports each check's pass/fail. Do **not** proceed if any failed. Explain to the user which check failed and link them to the relevant source file.

The script runs:
- `qa:api-shape` — hits `/api/overview`, `/api/targeting`, `/api/campaigns/[id]/adgroups`, `/api/adgroups/[id]/targeting`, asserts every field the UI reads is present and the expected type. Catches "Dashboard dropped prev" class of bugs.
- `qa:consistency` — checks that campaign spend totals roughly equal the sum of their ad-group totals (within 2%). Catches the SP ad-group rollup bug class.
- `qa:visual` — Playwright loads every page in both themes, fails on console errors or unhandled exceptions. Catches theme contrast issues, missing imports, hydration bugs.
- `qa:deploy` (post-deploy only) — verifies `/api/version` SHA matches the latest GitHub commit. Catches "Jenkins green but old code serving" class.

### 3. Manual risk review (this is where you add value beyond the scripts)

For each changed file matching the trigger table, do a structured read:

**A. "Did the UI keep reading every API field?"**
- Open the API route or service file
- Note the response shape
- Open the consumer (Dashboard.tsx, Targeting.tsx, KpiCard, etc.)
- Look for patterns like `metric={{ value: x, delta: 0, positive: y }}` — that REBUILDS the object and drops other fields. Should be `metric={apiResponse}` to pass through.
- Look for `const spend = data.kpis.spend.value` — fine for inline display, but if the wrapped value gets passed to a component that needs `prev`/`delta` too, that destructuring is a bug.

**B. "Are sibling level totals consistent?"**
- Campaign.spend should equal sum(ad_groups[campaign_id].spend) within rounding
- Ad group.spend should equal sum(targets[adgroup_id].spend) within rounding (or be derived from same source)
- If you see SP ad-group spend = 0 when targeting > 0, that's the SP rollup bug class

**C. "Both themes still readable?"**
- Any new hardcoded color in inline `style={}`? Should use `var(--c-*-text)` or `var(--text-primary)` etc.
- Pastel text on dark bg → washed out on white. Use the `--c-*-text` tokens that flip per theme.

**D. "Loading + error + empty states handled?"**
- New API response includes `freshness.stale`? UI shows stale banner?
- Empty list? Shows Empty component, not just a blank table?
- HTTP 500? Shows error banner, not raw error?

**E. "Edge cases on numeric fields:"**
- Divide by zero (`prev = 0` → don't compute %)
- Negative values
- NaN/Infinity from `0/0`

### 4. Report

Output format:

```
QA REVIEW — <change summary>

✅ Passed
- <check name>: <one-line summary>
- ...

⚠ Risks (review manually)
- <file:line>: <what could go wrong, with mitigation>
- ...

✕ Failures (must fix before deploy)
- <file:line>: <what is wrong, what should it be>
- ...

Recommendation: <DEPLOY | FIX FIRST | NEEDS MORE INFO>
```

Always end with the one-line recommendation.

## Bugs we've hit (catalog with detection)

Use these as a checklist when reviewing related code:

| Bug | How it shipped | Detection rule |
|---|---|---|
| Dashboard dropped `prev` + `delta` | `metric={{ value: spend, delta: 0, positive: false }}` rebuilds the object inline | Look for any `metric={{ ... }}` inline object literal — should be `metric={data.kpis.spend}` |
| SP ad-group spend = 0 | Amazon doesn't expose an SP ad-group report; we roll up from targeting. If the rollup logic is skipped on prev period too, prev deltas break | When hierarchy-service touches dailyRows + targetingRows, the SAME logic must run for the prev period |
| Targeting 360 — pastel chips invisible on white | `color: "#86efac"` hardcoded — fine on dark, lost on white | Any literal pastel hex (#86efac, #fde68a, #a5b4fc, #c4b5fd, #ddd6fe) outside `globals.css` is a smell. Should use `var(--c-success-text)` etc. |
| "Refresh from Amazon" 504 on prod | The endpoint blocked for 5–15 min; proxy timed out | Long-running endpoints must return 202 fast, work in background |
| Jenkins green but old code | `pm2 reload` keeps old in-memory build | Must be `pm2 restart` after `rm -rf .next && npm run build` |
| "No data stored" with 14-day refresh | User on Last 30D, prev window is older than refresh window | Default refresh now 21 days; UI shows "no prior data" honestly when truly missing |
| Manual SP targeting create fails | v3 spTargeting drops `targetId/targetingText/targetingType` — uses `keywordId`/`targeting`/`keywordType` instead | When adding new SP targeting endpoints, default to v3 column names |
| /api/targeting endpoint serving stale data | Next.js or upstream proxy caching responses | New API routes must set `Cache-Control: no-store` headers; declare `export const dynamic = "force-dynamic"` |

## What NOT to do

- Do NOT block the user on style nits or refactor opportunities. Focus on **correctness** and **shipping safely**.
- Do NOT run the full Playwright suite if the diff is only backend (use `qa:api-shape` + `qa:consistency` instead).
- Do NOT approve a build when `npm run qa:all` failed, even if you "understand why" the failure happened. Either fix it or get explicit user override.
