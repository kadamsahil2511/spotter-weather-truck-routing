import { Suspense, forwardRef, lazy } from "react";

import type { AnalyzeResponse } from "../types";
import type { MapHandle } from "./MapView";

const LoadedMap = lazy(() => import("./MapView").then((mod) => ({ default: mod.MapView })));

type MapProps = {
  result: AnalyzeResponse | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export const LazyMap = forwardRef<MapHandle, MapProps>(function LazyMap(props, ref) {
  return (
    <Suspense
      fallback={
        <div className="map-shell grid h-full w-full place-items-center bg-stone-100 text-sm text-stone-500">
          Loading map…
        </div>
      }
    >
      <LoadedMap ref={ref} {...props} />
    </Suspense>
  );
});
