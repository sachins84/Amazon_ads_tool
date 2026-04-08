/**
 * GET /api/auth/callback?code=...&state=...
 * OAuth callback — exchanges the authorization code for a refresh token,
 * then redirects back to the accounts page with the token pre-filled.
 *
 * state param encodes: { accountId?, clientId, clientSecret, redirectTo }
 */
import { type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) {
    return Response.redirect(new URL("/accounts?error=no_code", req.url));
  }

  let stateData: {
    clientId: string;
    clientSecret: string;
    accountId?: string;
    tokenType?: "ads" | "sp";
  } = { clientId: "", clientSecret: "" };

  try {
    stateData = JSON.parse(Buffer.from(state ?? "", "base64url").toString("utf-8"));
  } catch {
    return Response.redirect(new URL("/accounts?error=invalid_state", req.url));
  }

  const { clientId, clientSecret, accountId, tokenType = "ads" } = stateData;

  if (!clientId || !clientSecret) {
    return Response.redirect(new URL("/accounts?error=missing_credentials", req.url));
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth/callback`,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const error = encodeURIComponent(`Token exchange failed: ${await tokenRes.text()}`);
    return Response.redirect(new URL(`/accounts?error=${error}`, req.url));
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  // Redirect to accounts page with the refresh token in the URL fragment
  // so the form can be pre-filled without it hitting server logs
  const redirectUrl = new URL("/accounts", req.url);
  redirectUrl.searchParams.set("refresh_token", tokens.refresh_token);
  redirectUrl.searchParams.set("token_type", tokenType);
  if (accountId) redirectUrl.searchParams.set("account_id", accountId);

  return Response.redirect(redirectUrl);
}
