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
 *       targetRoas: number,
 *       maxScaleUpPct?: number,    // default 20
 *       maxScaleDownPct?: number,  // default 30
 *       minSpendThreshold?: number,// default 100
 *       pauseWhenOrdersZeroDays?: number, // default 7
 *     },
 *     topNAdGroups?: number,    // optimizer caps per level for speed
 *     topNTargets?: number,
 *   }
 *
 * Returns: { entitiesScored, suggestionsCreated, byBucket, durationMs }
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    accountId?: string;
    objective?: {
      targetRoas?: number;
      maxScaleUpPct?: number;
      maxScaleDownPct?: number;
      minSpendThreshold?: number;
      pauseWhenOrdersZeroDays?: number;
    };
    topNAdGroups?: number;
    topNTargets?: number;
  };
  if (!body.accountId || !body.objective?.targetRoas) {
    return Response.json({ error: "accountId + objective.targetRoas required" }, { status: 400 });
  }
  try {
    const r = await runOptimizerForAccount({
      accountId: body.accountId,
      objective: {
        targetRoas:              body.objective.targetRoas,
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
