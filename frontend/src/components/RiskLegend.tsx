import { useState } from "react";

import { RISK_COLOR, RISK_LEGEND } from "../riskColors";

export function RiskLegend({ compact }: { compact: boolean }) {
  const [open, setOpen] = useState(false);
  if (compact && !open) {
    return (
      <button
        type="button"
        className="h-11 w-11 rounded-full bg-white text-sm font-semibold text-[#1C1917] shadow-md"
        aria-label="Risk colors"
        aria-expanded={false}
        onClick={() => setOpen(true)}
      >
        i
      </button>
    );
  }
  return (
    <div
      className="flex items-center gap-2 rounded-full bg-white px-3 py-1.5 shadow-md"
      role="list"
      aria-label="Risk colors"
    >
      {RISK_LEGEND.map((item) => (
        <span key={item.level} className="flex items-center gap-1 text-[11px] text-stone-600" role="listitem">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{
              background: RISK_COLOR[item.level],
              boxShadow: item.level === "no_travel" ? "inset 0 0 0 1px #fafaf9" : undefined,
            }}
          />
          {(open || !compact) && <span>{item.label}</span>}
        </span>
      ))}
      {compact && (
        <button
          type="button"
          className="h-11 min-w-11 rounded-full px-2 text-sm text-stone-500"
          aria-label="Hide risk colors"
          onClick={() => setOpen(false)}
        >
          ×
        </button>
      )}
    </div>
  );
}
