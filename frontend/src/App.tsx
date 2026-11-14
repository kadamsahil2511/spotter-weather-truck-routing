import { Alert, Button, Drawer, ProgressBar, Skeleton, Surface, useOverlayState } from "@heroui/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { analyze, recheck } from "./api";
import { ANALYZE_TIMEOUT_MESSAGE, ANALYZE_TIMEOUT_MS, loadingStage } from "./loading";
import { HeatmapSlider } from "./components/HeatmapSlider";
import { InstallButton } from "./components/InstallButton";
import { OfflineNotice } from "./components/OfflineNotice";
import { Results } from "./components/Results";
import { RiskLegend } from "./components/RiskLegend";
import { RouteSheet, type SheetSnap } from "./components/RouteSheet";
import { TripBar } from "./components/TripBar";
import { TripForm, departureStamp, type TripValues } from "./components/TripForm";
import { HEATMAP_CAPTION, forecastLabel, formatDuration, formatMiles, formatTripSummary } from "./format";
import {
  isOffRoute,
  nextRiskAhead,
  pointAtMile,
  progressAlong,
  RECHECK_MS,
  remainingEta,
  saferRouteSuggestion,
} from "./follow";
import { LazyMap } from "./map/LazyMap";
import type { MapHandle, MapPadding } from "./map/MapView";
import { loadLastResult, saveLastResult } from "./pwa/lastResult";
import type { AnalyzeResponse } from "./types";

interface State {
  status: "idle" | "loading" | "ready" | "error";
  result: AnalyzeResponse | null;
  selectedId: string | null;
  error: string | null;
  offline: boolean;
}

type Action =
  | { type: "loading" }
  | { type: "ready"; result: AnalyzeResponse }
  | { type: "cached"; result: AnalyzeResponse }
  | { type: "error"; message: string }
  | { type: "select"; id: string }
  | { type: "refresh"; result: AnalyzeResponse; selectedId: string }
  | { type: "online" };

const initial: State = {
  status: "idle",
  result: null,
  selectedId: null,
  error: null,
  offline: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loading":
      return { ...state, status: "loading", error: null, offline: false };
    case "ready":
      return {
        ...state,
        status: "ready",
        result: action.result,
        selectedId: action.result.recommendation?.route_id ?? action.result.routes[0]?.id ?? null,
        error: null,
        offline: false,
      };
    case "cached":
      return {
        ...state,
        status: "ready",
        result: action.result,
        selectedId: action.result.recommendation?.route_id ?? action.result.routes[0]?.id ?? null,
        offline: true,
        error: null,
      };
    case "error":
      return { ...state, status: "error", error: action.message };
    case "select":
      return { ...state, selectedId: action.id };
    case "refresh":
      return { ...state, status: "ready", result: action.result, selectedId: action.selectedId, error: null };
    case "online":
      return { ...state, offline: false };
    default:
      return state;
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [hour, setHour] = useState(0);
  const [trip, setTrip] = useState<TripValues | null>(null);
  const [editing, setEditing] = useState(false);
  const [snap, setSnap] = useState<SheetSnap>("peek");
  const [loadingNote, setLoadingNote] = useState("Finding truck routes…");
  const [following, setFollowing] = useState(false);
  const [headingUp, setHeadingUp] = useState(false);
  const [followNote, setFollowNote] = useState<string[] | null>(null);
  const [suggestion, setSuggestion] = useState<{ routeId: string; message: string } | null>(null);
  const [followError, setFollowError] = useState<string | null>(null);
  const simulate = useMemo(() => new URLSearchParams(window.location.search).get("simulate") === "1", []);
  const driven = useRef(0);
  const drivenRoute = useRef<string | null>(null);
  const lastRecheck = useRef(0);
  const [recheckTick, setRecheckTick] = useState(0);
  const pendingRecheck = useRef<AnalyzeResponse | null>(null);
  const desktop = useDesktop();
  const editDrawer = useOverlayState();
  const mapRef = useRef<MapHandle>(null);
  const requestId = useRef(0);
  const focusRef = useRef<HTMLDivElement>(null);
  const onSelect = useCallback((id: string) => dispatch({ type: "select", id }), []);

  useEffect(() => {
    if (navigator.onLine) return;
    void loadLastResult().then((saved) => {
      if (saved) dispatch({ type: "cached", result: saved });
    });
  }, []);

  useEffect(() => {
    const onOnline = () => dispatch({ type: "online" });
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (state.status === "loading" || state.status === "error") setSnap("peek");
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "loading") return;
    const started = Date.now();
    setLoadingNote(loadingStage(0));
    const timer = window.setInterval(() => setLoadingNote(loadingStage(Date.now() - started)), 400);
    return () => window.clearInterval(timer);
  }, [state.status]);

  useEffect(() => {
    if (!following) {
      mapRef.current?.setPuck(null);
      setFollowNote(null);
      return;
    }
    const route = state.result?.routes.find((item) => item.id === state.selectedId);
    if (!route) return;
    if (drivenRoute.current !== route.id) {
      driven.current = 0;
      drivenRoute.current = route.id;
    }
    const show = (lon: number, lat: number) => {
      const progress = progressAlong(route.geometry, lon, lat);
      if (!progress) return;
      driven.current = progress.mile;
      const bearing = headingUp ? progress.bearing : null;
      mapRef.current?.setPuck({ lon: progress.snapped[0], lat: progress.snapped[1], bearing });
      mapRef.current?.followFrame(progress.snapped[0], progress.snapped[1], bearing);
      if (isOffRoute(progress.distanceMi)) {
        setFollowNote(["Off route"]);
        return;
      }
      const risk = nextRiskAhead(route.checkpoints, progress.mile);
      const left = remainingEta(route, progress.mile);
      setFollowNote(
        [risk?.text, `${formatMiles(left.miles)} mi left`, formatDuration(left.seconds)].filter(
          (part): part is string => Boolean(part),
        ),
      );
    };
    let watchId = 0;
    let timer = 0;
    if (simulate) {
      const length = Math.max(route.distance_mi, 1);
      const tick = () => {
        const mile = Math.min(length, driven.current + 8);
        const at = pointAtMile(route.geometry, mile);
        if (at) show(at[0], at[1]);
      };
      tick();
      timer = window.setInterval(tick, 300);
    } else if (!navigator.geolocation) {
      setFollowError("This browser has no location. Open with ?simulate=1 to preview the drive.");
    } else {
      watchId = navigator.geolocation.watchPosition(
        (position) => show(position.coords.longitude, position.coords.latitude),
        () => setFollowError("Location is off. Allow location to follow, or open this page with ?simulate=1."),
        { enableHighAccuracy: false, maximumAge: 20000, timeout: 20000 },
      );
    }
    return () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
    };
  }, [following, headingUp, simulate, state.selectedId, state.result]);

  useEffect(() => {
    if (!following || !trip?.origin || !trip.destination || !state.selectedId) return;
    let stopped = false;
    const selectedId = state.selectedId;
    const run = async () => {
      const now = Date.now();
      if (lastRecheck.current !== 0 && now - lastRecheck.current < 2 * 60 * 1000) return;
      const route = state.result?.routes.find((item) => item.id === selectedId);
      const at = route ? pointAtMile(route.geometry, driven.current) : null;
      if (!at || !trip.destination) return;
      lastRecheck.current = now;
      try {
        const next = await recheck(
          {
            origin: {
              id: "here",
              label: "Current location",
              lon: at[0],
              lat: at[1],
              timezone: trip.origin?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            },
            destination: trip.destination,
            departure: departureStamp({ ...trip, departAt: false }),
            load_lb: trip.loadLb,
            sample_miles: trip.sampleMiles,
          },
          new AbortController().signal,
        );
        if (stopped) return;
        pendingRecheck.current = next;
        setSuggestion(saferRouteSuggestion(selectedId, next));
        if (next.routes.some((item) => item.id === selectedId)) {
          dispatch({ type: "refresh", result: next, selectedId });
        }
      } catch {
        lastRecheck.current = 0;
      }
    };
    const first = window.setTimeout(() => void run(), 1200);
    const interval = window.setInterval(() => void run(), RECHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [following, trip, state.selectedId, state.result, recheckTick]);

  useEffect(() => {
    if (state.status !== "ready" || !state.result) return;
    setHour(0);
    setSnap("peek");
    mapRef.current?.setHour(0);
    focusRef.current?.querySelector<HTMLElement>("#recommendation")?.focus();
  }, [state.result, state.status]);

  function changeHour(next: number) {
    setHour(next);
    mapRef.current?.setHour(next);
  }

  async function onSubmit(values: TripValues) {
    if (!values.origin || !values.destination) return;
    setTrip(values);
    setEditing(false);
    editDrawer.close();
    if (!navigator.onLine) {
      dispatch({ type: "error", message: "You are offline. The last trip stays on the map." });
      return;
    }
    const id = ++requestId.current;
    const controller = new AbortController();
    const timedOut = window.setTimeout(() => controller.abort(), ANALYZE_TIMEOUT_MS);
    let abortedByTimeout = false;
    const onAbort = () => {
      abortedByTimeout = true;
    };
    controller.signal.addEventListener("abort", onAbort);
    dispatch({ type: "loading" });
    try {
      const result = await analyze(
        {
          origin: values.origin,
          destination: values.destination,
          departure: departureStamp(values),
          load_lb: values.loadLb,
          sample_miles: values.sampleMiles,
        },
        controller.signal,
      );
      if (id !== requestId.current) return;
      dispatch({ type: "ready", result });
      void saveLastResult(result);
    } catch (error) {
      if (id !== requestId.current) return;
      if ((error as { name?: string }).name === "AbortError") {
        if (abortedByTimeout) dispatch({ type: "error", message: ANALYZE_TIMEOUT_MESSAGE });
        return;
      }
      const saved = await loadLastResult().catch(() => undefined);
      if (saved && !navigator.onLine) {
        dispatch({ type: "cached", result: saved });
        return;
      }
      dispatch({
        type: "error",
        message: error instanceof Error ? error.message : "The trip could not be analyzed.",
      });
    } finally {
      window.clearTimeout(timedOut);
      controller.signal.removeEventListener("abort", onAbort);
    }
  }

  function retry() {
    if (trip) void onSubmit(trip);
  }

  const timeZone = trip?.origin?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const summary =
    trip?.origin && trip.destination
      ? formatTripSummary(trip.origin.label, trip.destination.label, trip.time.hour, trip.time.minute, trip.loadLb)
      : "Last trip";
  const collapsed = Boolean(trip) || Boolean(state.result);
  const label = state.result ? forecastLabel(state.result.heatmap.anchor, hour, timeZone) : "Weather at departure";
  const showSheet = !desktop && (state.status === "loading" || state.status === "error" || Boolean(state.result));
  const padding = useMemo<MapPadding>(() => {
    if (desktop) return { top: 56, right: 56, bottom: 96, left: 400 };
    if (!collapsed) {
      const formTop = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.52) : 420;
      return { top: formTop, right: 20, bottom: 96, left: 20 };
    }
    return {
      top: 88,
      right: 28,
      bottom: snap === "half" ? 460 : snap === "full" ? 160 : 300,
      left: 28,
    };
  }, [desktop, collapsed, snap]);

  const body = (
    <div ref={focusRef} className="flex flex-col gap-3">
      {state.offline && <OfflineNotice />}
      {state.status === "loading" && (
        <>
          <p className="text-sm font-medium text-[#1C1917]">{loadingNote}</p>
          <RouteSkeletons />
        </>
      )}
      {state.status === "error" && state.error && <TripError message={state.error} onRetry={retry} />}
      {state.status !== "loading" && state.result && (
        <Results
          result={state.result}
          selectedId={state.selectedId}
          timeZone={timeZone}
          origin={trip?.origin ?? null}
          destination={trip?.destination ?? null}
          scope={!desktop && snap === "peek" ? "selected" : "all"}
          showTimeline={desktop || snap === "full"}
          onSelect={onSelect}
          onSteps={desktop ? undefined : () => setSnap("full")}
          onFollow={() => {
            setFollowError(null);
            setSuggestion(null);
            setFollowing((current) => !current);
          }}
          following={following}
        />
      )}
      <p className="text-[11px] leading-4 text-stone-500">Sustained wind is scored. Gusts are shown and not scored.</p>
    </div>
  );

  const form = (
    <TripForm
      busy={state.status === "loading"}
      initial={trip ?? undefined}
      onSubmit={(values) => void onSubmit(values)}
    />
  );

  return (
    <div
      className="relative h-dvh overflow-hidden bg-[#fafaf9]"
        style={{
          ["--map-control-bottom" as string]: desktop
            ? "1.25rem"
            : state.result && snap === "half"
              ? "calc(62dvh + 8px)"
              : state.result && snap === "peek"
                ? "calc(min(400px, 48dvh) + 8px)"
                : "5.5rem",
        }}
    >
      <div className="absolute inset-0">
        <LazyMap
          ref={mapRef}
          following={following}
          padding={padding}
          result={state.result}
          selectedId={state.selectedId}
          onSelect={onSelect}
        />
      </div>
      {state.status === "loading" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30">
          <ProgressBar aria-label={loadingNote} isIndeterminate className="w-full" size="sm">
            <ProgressBar.Track>
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {state.status === "loading" ? "Checking routes" : state.status === "error" ? state.error : ""}
      </div>

      {desktop ? (
        <aside className="absolute bottom-4 left-4 top-4 z-20 flex w-[360px] max-w-[calc(100%-2rem)] flex-col">
          <Surface className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl bg-white shadow-xl" variant="default">
            <div className="flex items-start justify-between gap-3 px-4 pb-2 pt-4">
              <div>
                <h1 className="text-base font-semibold tracking-tight text-[#1C1917]">Truck Weather Routes</h1>
                <p className="text-xs text-stone-500">Sustained wind, load, and three routes</p>
              </div>
              <InstallButton />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {collapsed && !editing ? (
                <div className="sticky top-0 z-10 -mx-4 mb-3 bg-white px-4 pb-3">
                  <TripBar summary={summary} onEdit={() => setEditing(true)} />
                </div>
              ) : (
                <div className="mb-3">
                  {collapsed && (
                    <Button className="mb-2 h-11" size="sm" variant="ghost" onPress={() => setEditing(false)}>
                      Back to routes
                    </Button>
                  )}
                  {form}
                </div>
              )}
              {collapsed && !editing && body}
            </div>
          </Surface>
        </aside>
      ) : (
        <>
          <div className="absolute inset-x-0 top-0 z-20 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            {collapsed ? (
              <>
                <h1 className="sr-only">Truck Weather Routes</h1>
                <TripBar summary={summary} onEdit={() => editDrawer.open()} />
              </>
            ) : (
              <Surface
                className="flex max-h-[58dvh] flex-col overflow-hidden rounded-2xl bg-white p-4 shadow-xl"
                variant="default"
              >
                <div className="mb-3 flex shrink-0 items-start justify-between gap-3">
                  <div>
                    <h1 className="text-base font-semibold tracking-tight text-[#1C1917]">Truck Weather Routes</h1>
                    <p className="text-xs text-stone-500">Sustained wind, load, and three routes</p>
                  </div>
                  <InstallButton />
                </div>
                {form}
              </Surface>
            )}
          </div>
          {showSheet && (
            <RouteSheet snap={snap} fit={state.status === "error"} onSnap={setSnap}>
              {body}
            </RouteSheet>
          )}
          <Drawer state={editDrawer}>
            <Drawer.Backdrop>
              <Drawer.Content placement="bottom">
                <Drawer.Dialog>
                  <Drawer.Handle />
                  <Drawer.Header>
                    <Drawer.Heading>Edit trip</Drawer.Heading>
                  </Drawer.Header>
                  <Drawer.Body className="max-h-[78vh] overflow-y-auto">
                    {trip && (
                      <TripForm
                        key={`${trip.origin?.id ?? ""}-${trip.destination?.id ?? ""}`}
                        busy={state.status === "loading"}
                        initial={trip}
                        onSubmit={(values) => void onSubmit(values)}
                      />
                    )}
                  </Drawer.Body>
                </Drawer.Dialog>
              </Drawer.Content>
            </Drawer.Backdrop>
          </Drawer>
        </>
      )}

      {following && (followNote || followError || suggestion) && (
        <div className="absolute inset-x-3 top-[max(4.5rem,env(safe-area-inset-top))] z-30 flex flex-col items-center gap-2 md:left-[400px]">
          {followError && (
            <p className="max-w-md rounded-2xl bg-white px-4 py-2 text-sm text-[#1C1917] shadow-md">{followError}</p>
          )}
          {followNote && (
            <div className="flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-full bg-[#1C1917] px-4 py-2 text-sm text-[#fafaf9] shadow-md">
              {followNote.map((part, index) => (
                <span className="whitespace-nowrap" key={part}>
                  {index > 0 ? "· " : ""}
                  {part}
                </span>
              ))}
              {followNote[0] === "Off route" && (
                <button
                  className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#1C1917]"
                  type="button"
                  onClick={() => {
                    lastRecheck.current = 0;
                    setRecheckTick((tick) => tick + 1);
                  }}
                >
                  Recheck
                </button>
              )}
              <button
                className="whitespace-nowrap rounded-full border border-white/40 px-3 py-1 text-xs"
                type="button"
                onClick={() => setHeadingUp((current) => !current)}
              >
                {headingUp ? "North up" : "Heading up"}
              </button>
            </div>
          )}
          {suggestion && (
            <div className="w-full max-w-md rounded-2xl bg-white p-3 shadow-lg">
              <p className="text-sm font-medium text-[#1C1917]">{suggestion.message}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  className="h-11"
                  variant="primary"
                  onPress={() => {
                    const pending = pendingRecheck.current;
                    if (pending) dispatch({ type: "refresh", result: pending, selectedId: suggestion.routeId });
                    else dispatch({ type: "select", id: suggestion.routeId });
                    setSuggestion(null);
                  }}
                >
                  Switch
                </Button>
                <Button className="h-11" variant="secondary" onPress={() => setSuggestion(null)}>
                  Keep this route
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {state.status === "idle" && !state.result && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(2.25rem,env(safe-area-inset-bottom))] z-10 flex justify-center px-4 pr-16">
          <p className="rounded-full bg-white px-4 py-2 text-center text-sm text-stone-600 shadow-md">
            Pick two places to compare 3 truck routes
          </p>
        </div>
      )}

      {state.result && state.status !== "loading" && (desktop || snap !== "full") && (
        <div
          className="pointer-events-none absolute z-10 flex items-end gap-2"
          style={
            desktop
              ? { left: 400, right: 16, bottom: 16 }
              : { left: 12, right: 12, bottom: snap === "half" ? "calc(62dvh + 12px)" : "calc(min(400px, 48dvh) + 12px)" }
          }
        >
          <div className="pointer-events-auto min-w-0 flex-1">
            <HeatmapSlider caption={HEATMAP_CAPTION} hour={hour} label={label} onHour={changeHour} />
          </div>
          <div className="pointer-events-auto shrink-0">
            <RiskLegend compact={!desktop} />
          </div>
        </div>
      )}
    </div>
  );
}

function RouteSkeletons() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <Skeleton animationType="shimmer" className="h-6 w-40 rounded-lg" />
      <Skeleton animationType="shimmer" className="h-28 w-full rounded-2xl" />
      <Skeleton animationType="shimmer" className="h-28 w-full rounded-2xl" />
      <Skeleton animationType="shimmer" className="h-28 w-full rounded-2xl" />
    </div>
  );
}

function TripError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Could not compare routes</Alert.Title>
          <Alert.Description>{message}</Alert.Description>
        </Alert.Content>
      </Alert>
      <Button className="h-11 min-h-11" variant="primary" onPress={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function useDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : false,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const apply = () => setDesktop(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return desktop;
}
