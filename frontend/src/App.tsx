import { Alert, Button, Drawer, Header, useOverlayState } from "@heroui/react";
import { useEffect, useReducer, useRef, useState } from "react";

import { analyze } from "./api";
import { HeatmapSlider } from "./components/HeatmapSlider";
import { OfflineNotice } from "./components/OfflineNotice";
import { InstallButton } from "./components/InstallButton";
import { Results } from "./components/Results";
import { TripForm, departureStamp, type TripValues } from "./components/TripForm";
import { MapView, type MapHandle } from "./map/MapView";
import { hourLabel } from "./format";
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
    case "online":
      return { ...state, offline: false };
    default:
      return state;
  }
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [hour, setHour] = useState(0);
  const desktop = useDesktop();
  const drawer = useOverlayState({});
  const mapRef = useRef<MapHandle>(null);
  const requestId = useRef(0);
  const focusRef = useRef<HTMLDivElement>(null);

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

  const drawerRef = useRef(drawer);
  drawerRef.current = drawer;

  useEffect(() => {
    if (state.status !== "ready" || !state.result) return;
    setHour(0);
    mapRef.current?.setHour(0);
    if (!desktop) drawerRef.current.open();
    focusRef.current?.querySelector<HTMLElement>("#recommendation")?.focus();
  }, [state.result, state.status, desktop]);

  function changeHour(next: number) {
    setHour(next);
    mapRef.current?.setHour(next);
  }

  async function onSubmit(values: TripValues) {
    if (!navigator.onLine) {
      dispatch({ type: "error", message: "You are offline. The last trip stays on the map." });
      return;
    }
    if (!values.origin || !values.destination) return;
    const id = ++requestId.current;
    const controller = new AbortController();
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
      if ((error as { name?: string }).name === "AbortError") return;
      const saved = await loadLastResult().catch(() => undefined);
      if (saved && !navigator.onLine) {
        dispatch({ type: "cached", result: saved });
        return;
      }
      dispatch({
        type: "error",
        message: error instanceof Error ? error.message : "The trip could not be analyzed.",
      });
    }
  }

  const label = state.result ? hourLabel(state.result.heatmap.anchor, hour) : "T+0h";
  const results = state.result ? (
    <div ref={focusRef}>
      {state.offline && <OfflineNotice />}
      <Results
        result={state.result}
        selectedId={state.selectedId}
        onSelect={(id) => dispatch({ type: "select", id })}
      />
    </div>
  ) : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
        <div>
          <Header className="text-base font-semibold">Truck Weather Routes</Header>
          <p className="text-xs text-stone-500">Sustained wind, load, and three routes</p>
        </div>
        <InstallButton />
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:h-[calc(100dvh-4.5rem)] md:flex-row">
        <section className="flex w-full flex-col gap-4 p-4 md:h-full md:w-[380px] md:shrink-0 md:overflow-y-auto">
          <TripForm busy={state.status === "loading"} onSubmit={(values) => void onSubmit(values)} />
          {state.error && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>{state.error}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          {state.result && (
            <HeatmapSlider hour={hour} label={label} onHour={changeHour} />
          )}
          {desktop && results}
        </section>
        <div className="relative h-[60vh] min-h-80 md:h-auto md:min-h-0 md:flex-1">
          <MapView
            ref={mapRef}
            result={state.result}
            selectedId={state.selectedId}
            onSelect={(id) => dispatch({ type: "select", id })}
          />
        </div>
      </div>
      {!desktop && state.result && (
        <Drawer state={drawer}>
          <div className="fixed inset-x-0 bottom-4 z-20 flex justify-center">
            <Button variant="primary" onPress={drawer.open}>
              Routes
            </Button>
          </div>
          <Drawer.Backdrop>
            <Drawer.Content placement="bottom">
              <Drawer.Dialog>
                <Drawer.Handle />
                <Drawer.Header>
                  <Drawer.Heading>Routes</Drawer.Heading>
                </Drawer.Header>
                <Drawer.Body className="max-h-[70vh] overflow-y-auto">{results}</Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      )}
      <footer className="px-4 py-3 text-xs text-stone-500">
        Weather © Open-Meteo (CC BY 4.0). Routes © openrouteservice / OpenStreetMap. Map © OpenFreeMap
        / OpenMapTiles / OSM. Wind rules use sustained speed. Gusts are shown and not scored.
      </footer>
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
