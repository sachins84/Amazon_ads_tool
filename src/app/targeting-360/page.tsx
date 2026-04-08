"use client";
import dynamic from "next/dynamic";

const Targeting = dynamic(() => import("./Targeting"), { ssr: false });

export default function TargetingPage() {
  return <Targeting />;
}
