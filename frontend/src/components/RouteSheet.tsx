import { Surface } from "@heroui/react";
import { useRef, type ReactNode } from "react";

export type SheetSnap = "peek" | "half" | "full";

const NEXT: Record<SheetSnap, SheetSnap> = { peek: "half", half: "full", full: "peek" };
const PREVIOUS: Record<SheetSnap, SheetSnap> = { peek: "peek", half: "peek", full: "half" };

export function RouteSheet({
  snap,
  onSnap,
  fit = false,
  children,
}: {
  snap: SheetSnap;
  onSnap: (snap: SheetSnap) => void;
  /** Hug the content. Used for a short error, so the sheet does not cover the map. */
  fit?: boolean;
  children: ReactNode;
}) {
  const startY = useRef(0);
  const height = snap === "peek" ? "min(400px, 48dvh)" : snap === "half" ? "62dvh" : "calc(100dvh - 5.25rem - env(safe-area-inset-top))";
  const label = snap === "full" ? "Collapse routes" : "Expand routes";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center">
      <Surface
        className="route-sheet pointer-events-auto flex w-full max-w-lg flex-col rounded-t-3xl bg-white shadow-2xl"
        style={{
          height: fit ? "auto" : height,
          maxHeight: fit ? "70dvh" : undefined,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        variant="default"
      >
        <button
          type="button"
          className="flex h-11 w-full items-center justify-center"
          aria-label={label}
          onPointerDown={(event) => {
            startY.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            const delta = event.clientY - startY.current;
            if (delta < -28) onSnap(snap === "peek" ? "half" : "full");
            else if (delta > 28) onSnap(PREVIOUS[snap]);
            else onSnap(NEXT[snap]);
          }}
        >
          <span className="h-1 w-10 rounded-full bg-stone-400" />
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
      </Surface>
    </div>
  );
}
