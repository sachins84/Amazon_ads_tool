"use client";
import dynamic from "next/dynamic";

const Dashboard = dynamic(() => import("./Dashboard"), { ssr: false });

export default function MasterOverviewPage() {
  return <Dashboard />;
}
