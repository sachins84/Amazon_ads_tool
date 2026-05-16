/**
 * Infer campaign "intent" from its name. Pure function — no I/O, deterministic.
 *
 * Rules derived from Mosaic's existing naming convention. Order matters:
 *   1. AUTO  — anything with 'Auto' / 'AutoKW' (regardless of other tokens)
 *   2. PAT   — 'PAT' = Product Attribute Targeting (product/category targeting)
 *   3. BRAND — has 'Brand', 'Branded'
 *   4. COMP  — has 'Competition', 'Competitor', 'Comp', 'Competitive'
 *   5. GENERIC — has 'Generic'
 *   6. otherwise OTHER
 */
export type Intent = "BRANDED" | "GENERIC" | "COMPETITION" | "AUTO" | "PAT" | "OTHER";

export const ALL_INTENTS: Intent[] = ["BRANDED", "GENERIC", "COMPETITION", "AUTO", "PAT", "OTHER"];

export function inferIntent(name: string | null | undefined): Intent {
  if (!name) return "OTHER";
  const n = name.toLowerCase();

  // Order matters — match the strongest signal first.
  if (/\bauto\b|autokw|automatic/i.test(name)) return "AUTO";
  if (/\bpat\b/i.test(name)) return "PAT";
  if (/\bbrand\b|branded|\bbb_\b/i.test(name)) {
    // 'BB_' is BeBodywise (a brand code), not a brand-intent indicator.
    // Only count BB_ as branded if 'brand' appears separately too.
    if (/brand/i.test(n.replace(/bb_/gi, ""))) return "BRANDED";
    if (!/bb_/i.test(name)) return "BRANDED";
  }
  if (/competit|\bcomp\b|\bcompetitor\b/i.test(name)) return "COMPETITION";
  if (/generic/i.test(name)) return "GENERIC";
  return "OTHER";
}

/** Human-readable label for the chip / column. */
export function intentLabel(i: Intent): string {
  return {
    BRANDED: "Brand",
    GENERIC: "Generic",
    COMPETITION: "Competition",
    AUTO: "Auto",
    PAT: "Product Targeting",
    OTHER: "Other",
  }[i];
}

/** Color for the chip — paired with utils.acos/roas conventions. */
export function intentColor(i: Intent): { bg: string; fg: string } {
  return {
    BRANDED:     { bg: "rgba(34,197,94,0.15)",  fg: "#86efac" },  // green — defending brand
    GENERIC:     { bg: "rgba(99,102,241,0.15)", fg: "#a5b4fc" },  // indigo
    COMPETITION: { bg: "rgba(239,68,68,0.15)",  fg: "#ef4444" },  // red — going at competitors
    AUTO:        { bg: "rgba(245,158,11,0.15)", fg: "#fde68a" },  // amber — Amazon controls
    PAT:         { bg: "rgba(167,139,250,0.15)", fg: "#ddd6fe" }, // violet — product targeting
    OTHER:       { bg: "rgba(85,95,110,0.20)",  fg: "#8892a4" },
  }[i];
}
