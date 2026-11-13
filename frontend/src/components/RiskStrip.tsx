import { routeSegments } from "../segments";
import { formatMiles } from "../format";
import { RISK_COLOR } from "../riskColors";
import type { Checkpoint } from "../types";

export function RiskStrip({
  checkpoints,
  distanceMi,
  large = false,
}: {
  checkpoints: Pick<Checkpoint, "mile" | "risk">[];
  distanceMi: number;
  large?: boolean;
}) {
  const segments = routeSegments(checkpoints);
  const total = segments.reduce((sum, segment) => sum + segment.miles, 0) || distanceMi || 1;
  return (
    <div className={large ? "mt-2" : "mt-1.5"}>
      <div
        className={`flex overflow-hidden rounded-full ${large ? "h-3" : "h-2"}`}
        aria-hidden="true"
      >
        {segments.length === 0 ? (
          <div className="h-full flex-1 bg-stone-300" />
        ) : (
          segments.map((segment, index) => (
            <div
              key={`${segment.startMile}-${index}`}
              className="h-full"
              style={{
                width: `${(segment.miles / total) * 100}%`,
                background: RISK_COLOR[segment.level],
              }}
            />
          ))
        )}
      </div>
      <div className={`flex justify-between text-stone-500 ${large ? "mt-1 text-xs" : "mt-0.5 text-[10px]"}`}>
        <span>0</span>
        <span>{formatMiles(total / 2)}</span>
        <span>{formatMiles(distanceMi)} mi</span>
      </div>
    </div>
  );
}
