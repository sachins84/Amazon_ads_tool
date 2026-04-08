import { listProfiles } from "@/lib/amazon-api/profiles";
import { withCache } from "@/lib/cache";
import { AmazonConfigError } from "@/lib/amazon-api/token";

export async function GET() {
  try {
    const profiles = await withCache("profiles", listProfiles, 600_000); // 10 min
    return Response.json({ profiles });
  } catch (err) {
    if (err instanceof AmazonConfigError) {
      return Response.json({ error: err.message, code: "CONFIG_MISSING" }, { status: 500 });
    }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
