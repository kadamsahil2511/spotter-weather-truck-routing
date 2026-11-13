import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  Marker,
  type MapLayerMouseEvent,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import { formatDurationCompact } from "../format";
import { markerGlyph, weatherMarker } from "./markers";
import { RISK_COLOR, UNSELECTED_LINE } from "../riskColors";
import { pointAlong, segmentLines } from "../segments";
import type { AnalyzeResponse, RouteResult } from "../types";

// MapLibre 6 loads ./maplibre-gl-worker.mjs next to its own chunk. Vite does not
// emit that sibling, so point it at the worker asset before any map is created.
setWorkerUrl(maplibreWorkerUrl);

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const WEIGHT = [0, 0.35, 0.65, 0.85, 1];

export interface MapPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface MapPuck {
  lon: number;
  lat: number;
  bearing: number | null;
}

export interface MapHandle {
  setHour: (hour: number) => void;
  setPuck: (puck: MapPuck | null) => void;
  followFrame: (lon: number, lat: number, bearing: number | null) => void;
}

const LEVEL_COLOR: unknown[] = [
  "match",
  ["get", "level"],
  "low",
  RISK_COLOR.low,
  "moderate",
  RISK_COLOR.moderate,
  "high",
  RISK_COLOR.high,
  "severe",
  RISK_COLOR.severe,
  "no_travel",
  RISK_COLOR.no_travel,
  RISK_COLOR.unknown,
];

export const MapView = memo(
  forwardRef<
    MapHandle,
    {
      result: AnalyzeResponse | null;
      selectedId: string | null;
      padding: MapPadding;
      following?: boolean;
      onSelect: (id: string) => void;
    }
  >(function MapView({ result, selectedId, padding, following = false, onSelect }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<Map | null>(null);
    const markersRef = useRef<Marker[]>([]);
    const resultRef = useRef(result);
    const selectedRef = useRef(selectedId);
    const hourRef = useRef(0);
    const paddingRef = useRef(padding);
      const fitKeyRef = useRef("");
      const puckRef = useRef<Marker | null>(null);
      const followingRef = useRef(following);
      const onSelectRef = useRef(onSelect);
      followingRef.current = following;
    onSelectRef.current = onSelect;
    resultRef.current = result;
    selectedRef.current = selectedId;
    paddingRef.current = padding;

    useImperativeHandle(ref, () => ({
      setHour(hour: number) {
        hourRef.current = hour;
        const map = mapRef.current;
        const current = resultRef.current;
        if (!map || !current || !map.getSource("heatmap")) return;
        (map.getSource("heatmap") as GeoJSONSource).setData(heatmapData(current, hour));
        if (map.getLayer("heatmap")) map.setPaintProperty("heatmap", "heatmap-opacity", hour === 0 ? 0.12 : 0.72);
      },
      setPuck(puck: MapPuck | null) {
        const map = mapRef.current;
        if (!map) return;
        if (!puck) {
          puckRef.current?.remove();
          puckRef.current = null;
          return;
        }
        if (!puckRef.current) {
          const dot = document.createElement("div");
          dot.className = "location-puck";
          puckRef.current = new Marker({ element: dot, rotationAlignment: "map", pitchAlignment: "map" })
            .setLngLat([puck.lon, puck.lat])
            .addTo(map);
        } else {
          puckRef.current.setLngLat([puck.lon, puck.lat]);
        }
        puckRef.current.setRotation(puck.bearing ?? 0);
      },
      followFrame(lon: number, lat: number, bearing: number | null) {
        const map = mapRef.current;
        if (!map) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        map.easeTo({
          center: [lon, lat],
          bearing: bearing ?? 0,
          duration: reduce ? 0 : 400,
        });
      },
    }));

    useEffect(() => {
      const node = containerRef.current;
      if (!node || mapRef.current) return;
      const map = new Map({
        container: node,
        style: "https://tiles.openfreemap.org/styles/positron",
          center: [-97.5, 39.8],
          zoom: 4.2,
        attributionControl: { compact: true },
      });
      map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new LocateControl(), "bottom-right");
      map.on("load", () => {
        map.addSource("heatmap", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "heatmap",
          type: "heatmap",
          source: "heatmap",
          paint: {
            "heatmap-weight": ["get", "w"],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.6, 8, 1.4],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 14, 8, 36],
              "heatmap-opacity": 0.12,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(0,0,0,0)",
              0.25,
              "#E9B949",
              0.55,
              "#E8762C",
              0.85,
              "#C8312B",
              1,
              "#2B1B2E",
            ],
          },
        });
        map.addSource("routes-other", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "route-casing",
          type: "line",
          source: "routes-other",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 7 },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "routes-other",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": UNSELECTED_LINE, "line-width": 3 },
        });
        map.addSource("routes-selected", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "selected-casing",
          type: "line",
          source: "routes-selected",
          filter: ["!=", ["get", "level"], "no_travel"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#1C1917", "line-width": 10 },
        });
        map.addLayer({
          id: "selected-nt-casing",
          type: "line",
          source: "routes-selected",
          filter: ["==", ["get", "level"], "no_travel"],
          layout: { "line-cap": "butt", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 10, "line-dasharray": [0.8, 1.2] },
        });
        map.addLayer({
          id: "selected-line",
          type: "line",
          source: "routes-selected",
          filter: ["!=", ["get", "level"], "no_travel"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": LEVEL_COLOR as never, "line-width": 6 },
        });
        map.addLayer({
          id: "selected-nt",
          type: "line",
          source: "routes-selected",
          filter: ["==", ["get", "level"], "no_travel"],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": RISK_COLOR.no_travel, "line-width": 6 },
        });
        map.addSource("route-hit-source", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "route-hit",
          type: "line",
          source: "route-hit-source",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#000000", "line-width": 22, "line-opacity": 0.01 },
        });
        map.addSource("low-dots", { type: "geojson", data: EMPTY });
        map.addLayer({
          id: "low-dots",
          type: "circle",
          source: "low-dots",
          paint: {
            "circle-radius": 2,
            "circle-color": RISK_COLOR.low,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1,
          },
        });
        const choose = (event: MapLayerMouseEvent) => {
          const id = event.features?.[0]?.properties?.id;
          if (typeof id === "string") onSelectRef.current(id);
        };
        map.on("click", "route-hit", choose);
        map.on("click", "low-dots", (event: MapLayerMouseEvent) => {
          const props = event.features?.[0]?.properties;
          if (!props) return;
          if (typeof props.routeId === "string") onSelectRef.current(props.routeId);
          const nodeId = `cp-${props.routeId}-${props.index}`;
          window.setTimeout(() => document.getElementById(nodeId)?.scrollIntoView({ block: "nearest" }), 40);
        });
        for (const layer of ["route-hit", "low-dots"]) {
          map.on("mouseenter", layer, () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", layer, () => {
            map.getCanvas().style.cursor = "";
          });
        }
        paint(
          map,
          markersRef,
          resultRef.current,
          selectedRef.current,
          hourRef.current,
          paddingRef.current,
          fitKeyRef,
          followingRef.current,
          (id) => onSelectRef.current(id),
        );
      });
      mapRef.current = map;
      return () => {
          clearMarkers(markersRef.current);
          markersRef.current = [];
          puckRef.current?.remove();
          puckRef.current = null;
          map.remove();
        mapRef.current = null;
      };
    }, []);

    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      const apply = () =>
        paint(map, markersRef, result, selectedId, hourRef.current, padding, fitKeyRef, followingRef.current, (id) =>
          onSelectRef.current(id),
        );
      if (map.isStyleLoaded()) apply();
      else map.once("idle", apply);
    }, [result, selectedId, padding, following]);

    return <div ref={containerRef} className="map-shell h-full w-full" />;
  }),
);

class LocateControl {
  private container: HTMLDivElement | null = null;
  private map: Map | null = null;

  onAdd(map: Map) {
    this.map = map;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "maplibregl-ctrl-icon";
    button.setAttribute("aria-label", "My location");
    button.textContent = "◎";
    button.style.fontSize = "16px";
    button.style.width = "29px";
    button.style.height = "29px";
    button.addEventListener("click", () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition((position) => {
        this.map?.flyTo({
          center: [position.coords.longitude, position.coords.latitude],
          zoom: Math.max(this.map.getZoom(), 10),
        });
      });
    });
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    container.append(button);
    this.container = container;
    return container;
  }

  onRemove() {
    this.container?.remove();
    this.map = null;
  }
}

function clearMarkers(markers: Marker[]) {
  for (const marker of markers) marker.remove();
}

function paint(
  map: Map,
  markersRef: { current: Marker[] },
  result: AnalyzeResponse | null,
  selectedId: string | null,
  hour: number,
  padding: MapPadding,
  fitKeyRef: { current: string },
  following: boolean,
  onSelect: (id: string) => void,
) {
  const heatmap = map.getSource("heatmap") as GeoJSONSource | undefined;
  const others = map.getSource("routes-other") as GeoJSONSource | undefined;
  const selected = map.getSource("routes-selected") as GeoJSONSource | undefined;
  const hits = map.getSource("route-hit-source") as GeoJSONSource | undefined;
  const dots = map.getSource("low-dots") as GeoJSONSource | undefined;
  if (!heatmap || !others || !selected || !hits || !dots) return;
  clearMarkers(markersRef.current);
  markersRef.current = [];
  if (!result) {
    heatmap.setData(EMPTY);
    others.setData(EMPTY);
    selected.setData(EMPTY);
    hits.setData(EMPTY);
    dots.setData(EMPTY);
    const frame = `conus:${padding.top}:${padding.bottom}:${padding.left}:${padding.right}`;
    if (!following && fitKeyRef.current !== frame) {
      fitKeyRef.current = frame;
      const bounds = new LngLatBounds([-124.8, 24.4], [-66.9, 49.4]);
      map.fitBounds(bounds, { padding, duration: 0, maxZoom: 5 });
    }
    return;
  }
  if (map.getLayer("heatmap")) map.setPaintProperty("heatmap", "heatmap-opacity", hour === 0 ? 0.12 : 0.72);
  const chosen = result.routes.find((route) => route.id === selectedId) ?? null;
  heatmap.setData(heatmapData(result, hour));
  others.setData(routeCollection(result.routes.filter((route) => route.id !== chosen?.id)));
  selected.setData(chosen ? selectedCollection(chosen) : EMPTY);
  hits.setData(routeCollection(result.routes));
  dots.setData(lowDotCollection(chosen));
  markersRef.current = placeMarkers(map, result, chosen, onSelect);
  const fitKey = `${result.routes.map((route) => route.id).join(",")}:${padding.top}:${padding.bottom}:${padding.left}:${padding.right}`;
  if (!following && fitKey !== fitKeyRef.current) {
    fitKeyRef.current = fitKey;
    const bounds = new LngLatBounds();
    let any = false;
    for (const route of result.routes) {
      for (const [lon, lat] of route.geometry) {
        bounds.extend([lon, lat]);
        any = true;
      }
    }
    if (any && !bounds.isEmpty()) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      map.fitBounds(bounds, { padding, duration: reduce ? 0 : 500, maxZoom: 9 });
    }
  }
}

function placeMarkers(map: Map, result: AnalyzeResponse, chosen: RouteResult | null, onSelect: (id: string) => void): Marker[] {
  const markers: Marker[] = [];
  const recommendedId = result.recommendation?.route_id ?? null;
  for (const route of result.routes) {
    if (route.geometry.length < 2) continue;
    const best = route.id === recommendedId;
    const noTravel = route.summary.no_travel_mi > 0.05;
    const label = `${formatDurationCompact(route.duration_s)}${best ? " · Safest" : ""}${noTravel ? " ⚠" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "route-bubble";
    button.textContent = label;
    button.setAttribute("aria-label", `${route.label}, ${label}`);
    if (best) button.dataset.best = "true";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect(route.id);
    });
    const marker = new Marker({ element: button, anchor: "bottom", offset: [0, -8] })
      .setLngLat(pointAlong(route.geometry, 0.45))
      .addTo(map);
    marker.getElement().style.zIndex = best ? "3" : "2";
    markers.push(marker);
  }
  if (chosen) {
    for (const point of chosen.checkpoints) {
      const weather = weatherMarker(point);
      if (!weather) continue;
      const pill = document.createElement("div");
      pill.className = "weather-pill";
      pill.textContent = `${markerGlyph(weather.icon)} ${weather.label}`;
      pill.style.borderColor = RISK_COLOR[weather.level];
      pill.title = `${weather.label}. Gusts are not shown here.`;
      const marker = new Marker({ element: pill, anchor: "top", offset: [0, 6] })
        .setLngLat([point.lon, point.lat])
        .addTo(map);
      marker.getElement().style.zIndex = "4";
      markers.push(marker);
    }
  }
  return markers;
}

function heatmapData(result: AnalyzeResponse, hour: number): GeoJSON.FeatureCollection {
  const row = result.heatmap.levels[hour] ?? [];
  const features: GeoJSON.Feature[] = [];
  result.heatmap.points.forEach(([lon, lat], index) => {
    const level = row[index];
    if (level == null || level <= 0) return;
    features.push({
      type: "Feature",
      properties: { w: WEIGHT[level] ?? 0 },
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  });
  return { type: "FeatureCollection", features };
}

function routeCollection(routes: RouteResult[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes
      .filter((route) => route.geometry.length >= 2)
      .map((route) => ({
        type: "Feature" as const,
        properties: { id: route.id },
        geometry: { type: "LineString" as const, coordinates: route.geometry },
      })),
  };
}

function selectedCollection(route: RouteResult): GeoJSON.FeatureCollection {
  const lines = segmentLines(route.geometry, route.checkpoints);
  const features =
    lines.length > 0
      ? lines
      : route.geometry.length >= 2
        ? [{ level: "low" as const, coordinates: route.geometry }]
        : [];
  return {
    type: "FeatureCollection",
    features: features.map((line) => ({
      type: "Feature" as const,
      properties: { id: route.id, level: line.level },
      geometry: { type: "LineString" as const, coordinates: line.coordinates },
    })),
  };
}

function lowDotCollection(route: RouteResult | null): GeoJSON.FeatureCollection {
  if (!route) return EMPTY;
  return {
    type: "FeatureCollection",
    features: route.checkpoints
      .filter((point) => point.risk.level === "low")
      .map((point) => ({
        type: "Feature" as const,
        properties: { routeId: route.id, index: point.index, id: route.id },
        geometry: { type: "Point" as const, coordinates: [point.lon, point.lat] },
      })),
  };
}
