/**
 * Pure types + constants for the optimizer's (program × intent) targeting
 * matrix. Kept dependency-free so client components can import them without
 * dragging better-sqlite3 / fs into the browser bundle.
 */
import type { Intent } from "@/lib/amazon-api/intent";

export type OptimizerProgram = "SP" | "SB" | "SB_VIDEO" | "SD";
export const ALL_OPTIMIZER_PROGRAMS: OptimizerProgram[] = ["SP", "SB", "SB_VIDEO", "SD"];

/** Sentinel used in place of NULL (which SQLite treats as distinct in PKs)
 *  to mean "any program" or "any intent" inside the acos_targets table. */
export const ANY = "*" as const;
export type AnyOr<T extends string> = T | typeof ANY;

export interface AcosTargetRow {
  program: AnyOr<OptimizerProgram>;
  intent:  AnyOr<Intent>;
  targetAcos: number;       // percent (25 = 25%)
}
