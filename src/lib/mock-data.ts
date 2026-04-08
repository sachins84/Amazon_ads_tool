import type {
  OverviewKpis,
  TimeSeriesPoint,
  CampaignRow,
  Target,
} from "./types";

// Seeded deterministic PRNG (mulberry32) — eliminates SSR/client hydration mismatch
let seed = 42;
function seededRand(): number {
  seed = (seed * 1664525 + 1013904223) & 0xffffffff;
  return ((seed >>> 0) / 0xffffffff);
}
const rnd = (min: number, max: number) =>
  Math.round((seededRand() * (max - min) + min) * 100) / 100;

// ─── KPIs ────────────────────────────────────────────────────────────────────
export const mockKpis: OverviewKpis = {
  spend:       { value: 14820,  delta: 12.4,  positive: false },
  revenue:     { value: 76540,  delta: 8.7,   positive: true  },
  acos:        { value: 19.4,   delta: -2.1,  positive: true  },
  roas:        { value: 5.16,   delta: 0.31,  positive: true  },
  orders:      { value: 1342,   delta: 6.2,   positive: true  },
  impressions: { value: 2840000, delta: 3.1,  positive: true  },
  clicks:      { value: 42600,  delta: 4.5,   positive: true  },
  ctr:         { value: 1.5,    delta: 0.12,  positive: true  },
  cpc:         { value: 0.35,   delta: -0.03, positive: true  },
  cvr:         { value: 3.15,   delta: 0.22,  positive: true  },
  ntbOrders:   { value: 398,    delta: 9.1,   positive: true  },
  tacos:       { value: 9.6,    delta: -0.8,  positive: true  },
};

// ─── Time Series (30 days) — fixed anchor date to avoid SSR/client mismatch ──
export function generateTimeSeries(days = 30): TimeSeriesPoint[] {
  const points: TimeSeriesPoint[] = [];
  // Fixed anchor: 2026-03-25 — never use new Date() here (causes hydration mismatch)
  const anchor = new Date("2026-03-25T00:00:00.000Z");
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - i);
    const spend = rnd(380, 560);
    const revenue = spend * rnd(4.5, 6.2);
    const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const day = d.getUTCDate();
    points.push({
      date: `${month} ${day}`,
      spend: Math.round(spend),
      revenue: Math.round(revenue),
      acos: Math.round((spend / revenue) * 1000) / 10,
    });
  }
  return points;
}

// ─── Campaigns ────────────────────────────────────────────────────────────────
const campaignNames = [
  "SP - Men's Running Shoes - Exact",
  "SP - Women's Yoga Pants - Broad",
  "SB - Brand Awareness - Competitor",
  "SD - ASIN Retargeting - Homepage",
  "SP - Electronics - Auto Campaign",
  "SB - New Product Launch - Q1",
  "SP - Summer Collection - Phrase",
  "SD - Category Targeting - Sports",
  "SP - Competitor Conquest - Exact",
  "SB - Video - Lifestyle Brand",
  "SP - Best Sellers - Broad",
  "SD - Audience Retargeting - Warm",
];

export const mockCampaigns: CampaignRow[] = campaignNames.map((name, i) => {
  const type = name.startsWith("SP") ? "SP" : name.startsWith("SB") ? "SB" : "SD";
  const spend = rnd(400, 2200);
  const revenue = spend * rnd(3.2, 7.8);
  const clicks = Math.round(rnd(800, 4200));
  const impressions = Math.round(clicks * rnd(60, 180));
  const orders = Math.round(clicks * rnd(0.02, 0.06));
  return {
    id: `camp_${i + 1}`,
    name,
    type,
    status: i % 5 === 3 ? "PAUSED" : "ENABLED",
    budget: rnd(50, 200),
    spend: Math.round(spend),
    impressions,
    clicks,
    ctr: Math.round((clicks / impressions) * 10000) / 100,
    cpc: Math.round((spend / clicks) * 100) / 100,
    orders,
    revenue: Math.round(revenue),
    acos: Math.round((spend / revenue) * 1000) / 10,
    roas: Math.round((revenue / spend) * 100) / 100,
    cvr: Math.round((orders / clicks) * 10000) / 100,
  };
});

// ─── Targets ─────────────────────────────────────────────────────────────────
const keywords = [
  "running shoes for men",
  "best yoga mat",
  "wireless earbuds",
  "protein powder chocolate",
  "resistance bands set",
  "air fryer 5 quart",
  "standing desk mat",
  "blue light glasses",
  "mens athletic shorts",
  "womens leggings high waist",
  "foam roller for back",
  "jump rope weighted",
  "pull up bar doorframe",
  "dumbbells adjustable set",
  "gym bag with shoe compartment",
  "pre workout energy drink",
  "creatine monohydrate powder",
  "sleep aid melatonin",
  "vitamin d3 supplement",
  "fish oil omega 3",
  "B07XQ1N2X3",
  "B08K3NGLYQ",
  "B09NQKL7R2",
  "B0BF6NQ8M5",
  "B07YDVRBTZ",
];

const adGroupNames = [
  "Men's Footwear - Core",
  "Women's Activewear",
  "Supplements - Core",
  "Electronics - Broad",
  "Home Fitness - Auto",
  "Competitor Targets",
];

export const mockTargets: Target[] = Array.from({ length: 200 }, (_, i) => {
  const kw = keywords[i % keywords.length];
  const isAsin = kw.startsWith("B0");
  const isCat = i % 15 === 0;
  const type = isCat ? "CATEGORY" : isAsin ? "ASIN" : i % 20 === 0 ? "AUTO" : "KEYWORD";
  const matchTypes: Target["matchType"][] = ["EXACT", "PHRASE", "BROAD", "AUTO"];
  const matchType = type === "AUTO" || type === "ASIN" || type === "CATEGORY"
    ? "AUTO"
    : matchTypes[i % 3];
  const campIdx = i % mockCampaigns.length;
  const spend = rnd(0, 480);
  const revenue = spend > 0 ? spend * rnd(2.5, 8.5) : 0;
  const clicks = Math.round(rnd(0, 320));
  const impressions = Math.round(clicks * rnd(50, 200));
  const orders = Math.round(clicks * rnd(0.01, 0.07));
  const bid = rnd(0.25, 2.5);
  return {
    id: `tgt_${i + 1}`,
    value: isCat ? `Sports & Outdoors > ${kw}` : kw,
    type,
    matchType,
    campaignId: mockCampaigns[campIdx].id,
    campaignName: mockCampaigns[campIdx].name,
    adGroupId: `ag_${(i % 6) + 1}`,
    adGroupName: adGroupNames[i % 6],
    status: i % 8 === 0 ? "PAUSED" : i % 25 === 0 ? "ARCHIVED" : "ENABLED",
    bid: Math.round(bid * 100) / 100,
    suggestedBid: Math.round((bid * rnd(0.8, 1.3)) * 100) / 100,
    impressions,
    clicks,
    ctr: clicks > 0 && impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
    spend: Math.round(spend * 100) / 100,
    orders,
    revenue: Math.round(revenue * 100) / 100,
    acos: revenue > 0 ? Math.round((spend / revenue) * 1000) / 10 : 0,
    roas: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
    cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
    cvr: clicks > 0 ? Math.round((orders / clicks) * 10000) / 100 : 0,
    trend7d: Array.from({ length: 7 }, () => rnd(10, 45)),
  };
});

// Campaign type breakdown for donut
export const spendByType = [
  { name: "Sponsored Products", value: 8420, color: "#6366f1" },
  { name: "Sponsored Brands",   value: 3840, color: "#8b5cf6" },
  { name: "Sponsored Display",  value: 2560, color: "#a78bfa" },
];
