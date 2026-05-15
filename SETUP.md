# Amazon-Ads — Backend Setup Guide

## How It Works

```
Browser → Next.js API Routes → Amazon Ads API
                ↓
         In-memory cache (5 min TTL)
```

Without credentials the app runs in **Demo Mode** using mock data.
Add your Amazon credentials to see live data.

---

## Step 1 — Register an Amazon Ads API Application

1. Go to [Amazon Ads API Console](https://advertising.amazon.com/API/docs/en-us/onboarding/overview)
2. Sign in with your Amazon Advertising account
3. Navigate to **Developer Console → Applications → Create Application**
4. Fill in:
   - App name: `Amazon-Ads`
   - App type: `Private` (for single-account use)
   - OAuth2 Redirect URL: `http://localhost:3000/api/auth/callback`
5. Copy your **Client ID** and **Client Secret**

---

## Step 2 — Generate a Refresh Token (LWA OAuth)

Open this URL in your browser (replace `YOUR_CLIENT_ID`):

```
https://www.amazon.com/ap/oa?client_id=YOUR_CLIENT_ID&scope=advertising::campaign_management&response_type=code&redirect_uri=http://localhost:3000/api/auth/callback
```

After approving, you'll get an `authorization_code` in the redirect URL.
Exchange it for a refresh token:

```bash
curl -X POST https://api.amazon.com/auth/o2/token \
  -d "grant_type=authorization_code" \
  -d "code=YOUR_AUTH_CODE" \
  -d "redirect_uri=http://localhost:3000/api/auth/callback" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET"
```

Copy the `refresh_token` from the response.

---

## Step 3 — Get Your Profile ID

```bash
curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
     -H "Amazon-Advertising-API-ClientId: YOUR_CLIENT_ID" \
     https://advertising-api.amazon.com/v2/profiles
```

Pick the `profileId` for the marketplace you want (e.g. US = `ATVPDKIKX0DER`).

---

## Step 4 — Create `.env.local`

Copy the example file:
```bash
cp .env.local.example .env.local
```

Fill in your values:
```bash
AMAZON_CLIENT_ID=amzn1.application-oa2-client.XXXX
AMAZON_CLIENT_SECRET=XXXX
AMAZON_REFRESH_TOKEN=Atzr|XXXX
AMAZON_PROFILE_ID=1234567890
AMAZON_API_ENDPOINT=https://advertising-api.amazon.com
CACHE_TTL=300
```

Restart the dev server:
```bash
npm run dev
```

---

## Marketplace API Endpoints

| Region | Endpoint |
|--------|----------|
| US, CA, MX, BR | `https://advertising-api.amazon.com` |
| UK, DE, FR, IT, ES, NL, AE, SE, PL, BE, TR, SA, EG | `https://advertising-api-eu.amazon.com` |
| JP, AU, SG, IN | `https://advertising-api-fe.amazon.com` |

---

## Data Flow

### Master Overview
```
GET /api/overview?profileId=&dateRange=
  → listSPCampaigns()         [Amazon Ads API]
  → fetchCampaignReport()     [Reports API v3 — async, ~10s]
  → mergeCampaigns()          [transform to app types]
  → cached 5 min
```

### Targeting 360
```
GET /api/targeting?profileId=&dateRange=&...filters
  → listSPKeywords()          [Amazon Ads API]
  → listSPProductTargets()    [Amazon Ads API]
  → fetchTargetingReport()    [Reports API v3 — async, ~20s]
  → merge + filter + paginate
  → cached 5 min
```

### Bid Update
```
PATCH /api/targeting/:id
  → updateSPKeywords() or updateSPProductTargets()
  → invalidates targeting cache
```

### Bulk Actions
```
POST /api/targeting/bulk
  → batch updateSPKeywords() + updateSPProductTargets()
  → invalidates targeting cache
```

---

## Daily refresh (incremental)

Reads now come from SQLite, not directly from Amazon. The 8 AM cron below
pulls the **trailing 14 days** every morning — that covers Amazon's
attribution backfill window, so older data never re-pulls.

**One-time first-time backfill** (longer history):
```bash
# Replace ACCOUNT_ID with the row id from /api/accounts
curl -X POST 'http://localhost:3000/api/admin/refresh?accountId=ACCOUNT_ID&days=60'
# or all accounts at once:
curl -X POST 'http://localhost:3000/api/admin/refresh?all=true&days=60'
```

**Daily cron — 8 AM IST = 02:30 UTC** (`crontab -e`):
```cron
30 2 * * * curl -s -X POST 'http://localhost:3000/api/admin/refresh?all=true&days=14' > /tmp/amazon-ads-refresh.log 2>&1
```

The dashboard's **↻ Refresh from Amazon** button hits the same endpoint
on demand. A 14-day refresh for a typical Mosaic account takes ~5–15 min
(US ~30s warm, India 5–15 min cold per Amazon's queue).

State of last refresh is visible at `GET /api/admin/refresh` and on the
Master Overview header. UI shows a warning banner when the requested
range has no stored data, with a one-click 60-day backfill.

## Notes

- **Reports take 10–30s** to generate on Amazon's side. The API polls every 10s until complete.
- **Rate limits**: Amazon allows ~50 req/s per profile. The client auto-retries with exponential backoff on 429s.
- **SB/SD campaigns**: SP + SB + SD all fetched. Ad-group reports use `groupBy:["adGroup"]` against `spCampaigns`/`sbCampaigns`/`sdCampaigns` reportTypeIds (there's no `spAdGroup` reportTypeId in v3).
