import { Chip } from "@heroui/react";

import { formatLevel } from "../format";
import { RISK_COLOR } from "../riskColors";
import type { RiskLevel } from "../types";

export function RiskBadge({ level }: { level: RiskLevel | null }) {
  const name = formatLevel(level);
  const key = level ?? "unknown";
  const ink = key === "severe" || key === "no_travel" ? "#fafaf9" : "#1C1917";
  return (
    <Chip className="shrink-0 border-0" size="sm" variant="soft" style={{ background: RISK_COLOR[key], color: ink }}>
      {name}
    </Chip>
  );
}
