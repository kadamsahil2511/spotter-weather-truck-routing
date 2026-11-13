import { Chip } from "@heroui/react";

import { formatLevel } from "../format";
import type { RiskLevel } from "../types";

const color: Record<RiskLevel, "default" | "warning" | "danger" | "accent"> = {
  low: "default",
  moderate: "warning",
  high: "accent",
  severe: "danger",
  no_travel: "danger",
  unknown: "default",
};

export function RiskBadge({ level }: { level: RiskLevel | null }) {
  const name = formatLevel(level);
  return (
    <Chip color={color[level ?? "unknown"]} size="sm" variant="soft">
      {name}
    </Chip>
  );
}
