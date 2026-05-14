export function cn(...classes: (string | undefined | false | null)[]) {
  return classes.filter(Boolean).join(" ");
}

export type Currency = "INR" | "USD";
export const currencySymbol = (c: Currency | string | undefined) =>
  c === "USD" ? "$" : "₹";

/** Indian (lakh/crore) comma grouping */
function inrFormat(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const fixed = Math.round(abs).toString();
  if (fixed.length <= 3) return sign + fixed;
  const last3 = fixed.slice(-3);
  const rest   = fixed.slice(0, -3);
  return sign + rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

function usFormat(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmt(
  n: number,
  type: "currency" | "percent" | "number" | "multiplier" | "compact",
  currency: Currency | string = "INR",
) {
  const sym = currencySymbol(currency);
  const isInr = currency !== "USD";

  if (type === "currency") {
    if (isInr) return `${sym}${inrFormat(n)}`;
    return `${sym}${usFormat(n, 2)}`;
  }
  if (type === "percent")    return `${n.toFixed(1)}%`;
  if (type === "multiplier") return `${n.toFixed(2)}x`;
  if (type === "number")     return isInr ? inrFormat(n) : usFormat(n, 0);

  if (type === "compact") {
    if (isInr) {
      if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
      if (n >= 100_000)    return `${(n / 100_000).toFixed(1)}L`;
      if (n >= 1_000)      return `${(n / 1_000).toFixed(1)}K`;
      return inrFormat(n);
    }
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
    return usFormat(n, 0);
  }
  return isInr ? inrFormat(n) : usFormat(n, 0);
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
