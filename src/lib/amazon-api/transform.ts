/**
 * Small shared helpers — date range resolution from preset strings.
 *
 * Earlier mergeCampaigns / mergeKeywordTargets / mergeProductTargets helpers
 * were removed when the project moved to the v3 unified shape; the new
 * overview-service and hierarchy-service build the rows directly.
 */

export function dateRangeFromPreset(preset: string): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();

  const fmt = (d: Date) => d.toISOString().split("T")[0];

  switch (preset) {
    case "Today":      start.setDate(end.getDate()); break;
    case "Yesterday":  start.setDate(end.getDate() - 1); end.setDate(end.getDate() - 1); break;
    case "Last 7D":    start.setDate(end.getDate() - 7); break;
    case "Last 14D":   start.setDate(end.getDate() - 14); break;
    case "Last 30D":   start.setDate(end.getDate() - 30); break;
    case "This Month": start.setDate(1); break;
    case "Last Month": start.setMonth(start.getMonth() - 1, 1); end.setDate(0); break;
    default:           start.setDate(end.getDate() - 30);
  }

  return { startDate: fmt(start), endDate: fmt(end) };
}
