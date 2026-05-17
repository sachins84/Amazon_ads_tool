/**
 * ACOS target matrix: (program, intent) → target ACOS percent.
 *
 * Programs include "SB_VIDEO" as a distinct fourth program — derived from
 * SB campaigns whose name signals a video creative.
 *
 * Lookup precedence (most specific wins):
 *   1. exact (program, intent)
 *   2. (program, '*')           — program default for any intent
 *   3. ('*', intent)            — intent default across any program
 *   4. ('*', '*')               — account-wide default
 *
 * The sentinel '*' is stored in the table (not NULL) so PRIMARY KEY uniqueness
 * is enforced — SQLite treats NULLs in PKs as distinct.
 */
import { getDb } from "@/lib/db";
import type { Intent } from "@/lib/amazon-api/intent";

export type OptimizerProgram = "SP" | "SB" | "SB_VIDEO" | "SD";
export const ALL_OPTIMIZER_PROGRAMS: OptimizerProgram[] = ["SP", "SB", "SB_VIDEO", "SD"];

export const ANY = "*" as const;
export type AnyOr<T extends string> = T | typeof ANY;

export interface AcosTargetRow {
  program: AnyOr<OptimizerProgram>;
  intent:  AnyOr<Intent>;
  targetAcos: number;       // percent (25 = 25%)
}

interface Raw { program: string; intent: string; target_acos: number }

export function listAcosTargets(accountId: string): AcosTargetRow[] {
  return (getDb()
    .prepare("SELECT program, intent, target_acos FROM acos_targets WHERE account_id = ?")
    .all(accountId) as Raw[])
    .map((r) => ({
      program: r.program as AcosTargetRow["program"],
      intent:  r.intent  as AcosTargetRow["intent"],
      targetAcos: r.target_acos,
    }));
}

/**
 * Replace the matrix for an account. Rows with target_acos null/<=0 are
 * dropped (lets the UI clear cells by sending them empty).
 */
export function upsertAcosTargets(accountId: string, rows: AcosTargetRow[]): number {
  const db = getDb();
  const del = db.prepare("DELETE FROM acos_targets WHERE account_id = ?");
  const ins = db.prepare(`
    INSERT INTO acos_targets (account_id, program, intent, target_acos)
    VALUES (?, ?, ?, ?)
  `);
  const trx = db.transaction((rs: AcosTargetRow[]) => {
    del.run(accountId);
    let n = 0;
    for (const r of rs) {
      if (!Number.isFinite(r.targetAcos) || r.targetAcos <= 0) continue;
      ins.run(accountId, r.program, r.intent, r.targetAcos);
      n++;
    }
    return n;
  });
  return trx(rows);
}

/**
 * Look up the target ACOS for a specific (program, intent) pair, walking the
 * precedence chain. Returns null if no rule (not even the account default) is
 * configured — caller decides what to do (e.g. fall back to a hard-coded floor).
 */
export function lookupAcosTarget(
  accountId: string,
  program: OptimizerProgram,
  intent: Intent,
): number | null {
  const all = listAcosTargets(accountId);
  if (all.length === 0) return null;
  const tryKey = (p: AnyOr<OptimizerProgram>, i: AnyOr<Intent>) =>
    all.find((r) => r.program === p && r.intent === i)?.targetAcos ?? null;

  return (
    tryKey(program, intent) ??
    tryKey(program, ANY) ??
    tryKey(ANY, intent) ??
    tryKey(ANY, ANY)
  );
}

/**
 * Bulk version of lookupAcosTarget — fetches the matrix once, then resolves
 * each entity in memory. Used by the optimizer runner to avoid N+1 reads.
 */
export function buildTargetResolver(accountId: string): (p: OptimizerProgram, i: Intent) => number | null {
  const all = listAcosTargets(accountId);
  if (all.length === 0) return () => null;
  const byKey = new Map(all.map((r) => [`${r.program}|${r.intent}`, r.targetAcos]));
  return (p, i) => (
    byKey.get(`${p}|${i}`) ??
    byKey.get(`${p}|${ANY}`) ??
    byKey.get(`${ANY}|${i}`) ??
    byKey.get(`${ANY}|${ANY}`) ??
    null
  );
}
