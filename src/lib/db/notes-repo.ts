/**
 * Append-only entity notes — free-form reviewer comments attached to any
 * campaign / ad group / keyword / product target. The list is the audit
 * trail; we don't edit or delete, only append.
 */
import { v4 as uuid } from "uuid";
import { getDb } from "@/lib/db";

export type EntityTargetType = "CAMPAIGN" | "AD_GROUP" | "KEYWORD" | "PRODUCT_TARGET";

export interface EntityNote {
  id:          string;
  accountId:   string;
  targetType:  EntityTargetType;
  targetId:    string;
  body:        string;
  author:      string | null;
  createdAt:   string;
}

interface Raw {
  id: string; account_id: string; target_type: string; target_id: string;
  body: string; author: string | null; created_at: string;
}

export function addNote(input: Omit<EntityNote, "id" | "createdAt">): EntityNote {
  const id = uuid();
  const body = input.body.trim();
  if (!body) throw new Error("body required");
  getDb().prepare(`
    INSERT INTO entity_notes (id, account_id, target_type, target_id, body, author)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, input.accountId, input.targetType, input.targetId, body, input.author ?? null);
  return { ...input, id, body, createdAt: new Date().toISOString() };
}

export function listNotes(accountId: string, targetType: EntityTargetType, targetId: string): EntityNote[] {
  return (getDb().prepare(`
    SELECT id, account_id, target_type, target_id, body, author, created_at
    FROM entity_notes
    WHERE account_id = ? AND target_type = ? AND target_id = ?
    ORDER BY created_at DESC
  `).all(accountId, targetType, targetId) as Raw[]).map(rowToNote);
}

/**
 * Bulk count helper — returns Map<"<targetType>|<targetId>", count> for an
 * account. Used by the explore endpoint to badge rows with their note count
 * without a per-row query.
 */
export function countNotesByTarget(accountId: string): Map<string, number> {
  const rows = getDb().prepare(`
    SELECT target_type, target_id, COUNT(*) as n
    FROM entity_notes
    WHERE account_id = ?
    GROUP BY target_type, target_id
  `).all(accountId) as Array<{ target_type: string; target_id: string; n: number }>;
  const out = new Map<string, number>();
  for (const r of rows) out.set(`${r.target_type}|${r.target_id}`, r.n);
  return out;
}

function rowToNote(r: Raw): EntityNote {
  return {
    id: r.id, accountId: r.account_id,
    targetType: r.target_type as EntityTargetType,
    targetId: r.target_id,
    body: r.body, author: r.author,
    createdAt: r.created_at,
  };
}
