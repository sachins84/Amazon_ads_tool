import { listAccounts, createAccount, type AccountInput } from "@/lib/db/accounts";

export async function GET() {
  try {
    const accounts = listAccounts();
    return Response.json({ accounts });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as AccountInput;

    if (!body.name)            return Response.json({ error: "name is required" },            { status: 400 });
    if (!body.adsClientId)     return Response.json({ error: "adsClientId is required" },     { status: 400 });
    if (!body.adsClientSecret) return Response.json({ error: "adsClientSecret is required" }, { status: 400 });
    if (!body.adsRefreshToken) return Response.json({ error: "adsRefreshToken is required" }, { status: 400 });
    if (!body.adsProfileId)    return Response.json({ error: "adsProfileId is required" },    { status: 400 });

    const account = createAccount(body);
    return Response.json({ account }, { status: 201 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
