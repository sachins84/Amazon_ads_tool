import { type NextRequest } from "next/server";
import { runOptimizerForAccount } from "@/lib/rules/optimizer-runner";

export const dynamic = "force-dynamic";

/**
 * POST /api/optimizer/run
 *
 * Body:
 *   {
 *     accountId: string,
 *     objective: {
 *       defaultTargetAcos: number,       // percent, e.g. 25 for 25% ACOS
 *       maxScaleUpPct?: number,          // default 20
 *       maxScaleDownPct?: number,        // default 30
 *       minSpendThreshold?: number,      // default 100
 *       pauseWhenOrdersZeroDays?: number,// default 7
 *     },
 *     topNAdGroups?: number,
 *     topNTargets?: number,
 *   }
 *
 * Per-(program, intent) targets come from the acos_targets table — POST
 * /api/optimizer/targets to set them. defaultTargetAcos is the fallback.
 *
 * Returns: { entitiesScored, suggestionsCreated, byBucket, durationMs }
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    accountId?: string;
    objective?: {
      defaultTargetAcos?: number;
      maxScaleUpPct?: number;
      maxScaleDownPct?: number;
      minSpendThreshold?: number;
      pauseWhenOrdersZeroDays?: number;
    };
    topNAdGroups?: number;
    topNTargets?: number;
  };
  if (!body.accountId || !body.objective?.defaultTargetAcos) {
    return Response.json({ error: "accountId + objective.defaultTargetAcos required" }, { status: 400 });
  }
  try {
    const r = await runOptimizerForAccount({
      accountId: body.accountId,
      objective: {
        defaultTargetAcos:       body.objective.defaultTargetAcos,
        maxScaleUpPct:           body.objective.maxScaleUpPct           ?? 20,
        maxScaleDownPct:         body.objective.maxScaleDownPct         ?? 30,
        minSpendThreshold:       body.objective.minSpendThreshold       ?? 100,
        pauseWhenOrdersZeroDays: body.objective.pauseWhenOrdersZeroDays ?? 7,
      },
      topNAdGroups: body.topNAdGroups,
      topNTargets:  body.topNTargets,
    });
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
