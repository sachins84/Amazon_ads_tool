export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

export function fmt(n: number, type: "currency" | "percent" | "number" | "multiplier" | "compact") {
  if (type === "currency") return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  if (type === "percent") return `${n.toFixed(1)}%`;
  if (type === "multiplier") return `${n.toFixed(2)}x`;
  if (type === "compact") {
    if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
    if (n >= 100_000)    return `${(n / 100_000).toFixed(1)}L`;
    if (n >= 1_000)      return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  }
  return n.toLocaleString("en-IN");
}

export function acosColor(acos: number): string {
  if (acos === 0) return "#555f6e";
  if (acos < 15) return "#22c55e";
  if (acos <= 25) return "#f59e0b";
  return "#ef4444";
}

export function acosBg(acos: number): string {
  if (acos === 0) return "rgba(85,95,110,0.15)";
  if (acos < 15) return "rgba(34,197,94,0.12)";
  if (acos <= 25) return "rgba(245,158,11,0.12)";
  return "rgba(239,68,68,0.12)";
}
