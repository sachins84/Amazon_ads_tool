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

  // Token-aware separator: matches start, end, underscore, space, dash, pipe.
  const sep = (token: string) => new RegExp(`(?:^|[_ \\-|])${token}(?:[_ \\-|]|$)`, "i");

  // Order matters — match the strongest signal first.
  if (sep("auto").test(n) || /autokw|automatic/.test(n)) return "AUTO";
  if (sep("pat").test(n)) return "PAT";

  // Branded: 'brand', 'branded', 'br' (as token). 'BB_' alone is the BeBodywise
  // brand code (not a brand-intent signal), so we don't count it unless the
  // name ALSO has 'brand' somewhere outside the BB_ prefix.
  if (/branded|brandkey/.test(n) || sep("brand").test(n) || sep("br").test(n)) {
    return "BRANDED";
  }

  // Competition: catches Competition, Competitor, Comp, Compt, Cmpt.
  if (sep("comp").test(n) || sep("compt").test(n) || sep("cmpt").test(n)
      || /competit/.test(n)) {
    return "COMPETITION";
  }

  // Generic: catches Generic and abbreviated 'Gen' (as a token only — never
  // matches mid-word like 'generation').
  if (/generic/.test(n) || sep("gen").test(n)) return "GENERIC";

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
