"use client";
import dynamic from "next/dynamic";

const BrandAnalytics = dynamic(() => import("./BrandAnalytics"), { ssr: false });

export default function BrandAnalyticsPage() {
  return <BrandAnalytics />;
}
