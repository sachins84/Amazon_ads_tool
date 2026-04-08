/**
 * POST /api/accounts/:id/connect
 * Tests the stored credentials by fetching the profile list.
 * Sets account.connected = true on success.
 */
import { type NextRequest } from "next/server";
import { getAccount, setAccountConnected, toSafe } from "@/lib/db/accounts";
import { getAccountAccessToken } from "@/lib/amazon-api/account-client";
import { AmazonConfigError } from "@/lib/amazon-api/token";

interface Params { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const account = getAccount(id);
  if (!account) return Response.json({ error: "Account not found" }, { status: 404 });

  try {
    // Test credentials by fetching an access token + calling profiles
    const accessToken = await getAccountAccessToken(id);

    const profileRes = await fetch(`${account.adsEndpoint}/v2/profiles`, {
      headers: {
        "Authorization":                   `Bearer ${accessToken}`,
        "Amazon-Advertising-API-ClientId": account.adsClientId,
      },
    });

    if (!profileRes.ok) {
      const text = await profileRes.text();
      return Response.json(
        { success: false, error: `Amazon API rejected credentials (${profileRes.status}): ${text}` },
        { status: 400 }
      );
    }

    const profiles = await profileRes.json();
    setAccountConnected(id, true);

    return Response.json({
      success:  true,
      profiles, // return available profiles so user can confirm/change profile ID
      account:  toSafe(getAccount(id)!),
    });
  } catch (err) {
    setAccountConnected(id, false);
    if (err instanceof AmazonConfigError) {
      return Response.json({ success: false, error: err.message }, { status: 400 });
    }
    return Response.json({ success: false, error: String(err) }, { status: 500 });
  }
}
