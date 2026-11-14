import type { RiskLevel } from "./types";

/** Risk palette from the UX spec. Orange and red are risk only. */
export const RISK_COLOR: Record<RiskLevel, string> = {
  low: "#8A9A8B",
  moderate: "#E9B949",
  high: "#E8762C",
  severe: "#C8312B",
  no_travel: "#2B1B2E",
  unknown: "#a8a29e",
};

export const CHARCOAL = "#1C1917";
export const UNSELECTED_LINE = "#a8a29e";

export const RISK_LEGEND: { level: RiskLevel; label: string }[] = [
  { level: "low", label: "Low" },
  { level: "moderate", label: "Moderate" },
  { level: "high", label: "High" },
  { level: "severe", label: "Severe" },
  { level: "no_travel", label: "No Travel" },
];
