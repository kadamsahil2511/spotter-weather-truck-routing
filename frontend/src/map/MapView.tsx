import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  type MapLayerMouseEvent,
  NavigationControl,
  setWorkerUrl,
} from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

import type { AnalyzeResponse, RouteResult } from "../types";

// MapLibre 6 loads ./maplibre-gl-worker.mjs next to its own chunk. Vite does not
// emit that sibling, so point it at the worker asset before any map is created.
setWorkerUrl(maplibreWorkerUrl);

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const WEIGHT = [0, 0.35, 0.65, 0.85, 1];

export interface MapHandle {
  setHour: (hour: number) => void;
}

export const MapView = memo(
  forwardRef<MapHandle, { result: AnalyzeResponse | null; selectedId: string | null; onSelect: (id: string) => void }>(
    function MapView({ result, selectedId, onSelect }, ref) {
      const containerRef = useRef<HTMLDivElement>(null);
      const mapRef = useRef<Map | null>(null);
      const resultRef = useRef(result);
      const selectedRef = useRef(selectedId);
      const hourRef = useRef(0);
      const onSelectRef = useRef(onSelect);
      onSelectRef.current = onSelect;
      resultRef.current = result;
      selectedRef.current = selectedId;

      useImperativeHandle(ref, () => ({
        setHour(hour: number) {
          hourRef.current = hour;
          const map = mapRef.current;
          const current = resultRef.current;
          if (!map || !current || !map.getSource("heatmap")) return;
          (map.getSource("heatmap") as GeoJSONSource).setData(heatmapData(current, hour));
        },
      }));

      useEffect(() => {
        const node = containerRef.current;
        if (!node || mapRef.current) return;
        const map = new Map({
          container: node,
          style: "https://tiles.openfreemap.org/styles/positron",
          center: [-96, 39],
          zoom: 3.4,
        });
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
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
              "heatmap-opacity": 0.85,
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(0,0,0,0)",
                0.25,
                "#fbbf24",
                0.55,
                "#ea580c",
                0.85,
                "#b91c1c",
                1,
                "#44403c",
              ],
            },
          });
          map.addSource("routes", { type: "geojson", data: EMPTY, promoteId: "id" });
          map.addLayer({
            id: "route-casing",
            type: "line",
            source: "routes",
            paint: { "line-color": "#fafaf9", "line-width": 8, "line-opacity": 0.9 },
          });
          map.addLayer({
            id: "route-line",
            type: "line",
            source: "routes",
            paint: {
              "line-color": [
                "case",
                ["boolean", ["feature-state", "recommended"], false],
                "#c2410c",
                "#44403c",
              ],
              "line-width": [
                "case",
                ["boolean", ["feature-state", "selected"], false],
                6,
                ["boolean", ["feature-state", "recommended"], false],
                5,
                3,
              ],
            },
          });
          map.addSource("checkpoints", { type: "geojson", data: EMPTY });
          map.addLayer({
            id: "checkpoints",
            type: "circle",
            source: "checkpoints",
            paint: {
              "circle-radius": ["case", ["==", ["get", "selected"], 1], 8, 5],
              "circle-color": [
                "match",
                ["get", "level"],
                "low",
                "#a8a29e",
                "moderate",
                "#d97706",
                "high",
                "#ea580c",
                "severe",
                "#dc2626",
                "no_travel",
                "#1c1917",
                "#a8a29e",
              ],
              "circle-stroke-color": "#fafaf9",
              "circle-stroke-width": 1.5,
            },
          });
          map.on("click", "route-line", (event: MapLayerMouseEvent) => {
            const id = event.features?.[0]?.properties?.id;
            if (typeof id === "string") onSelectRef.current(id);
          });
          map.on("click", "checkpoints", (event: MapLayerMouseEvent) => {
            const props = event.features?.[0]?.properties;
            if (!props) return;
            if (typeof props.routeId === "string") onSelectRef.current(props.routeId);
            const nodeId = `cp-${props.routeId}-${props.index}`;
            document.getElementById(nodeId)?.scrollIntoView({ block: "nearest" });
          });
          map.getCanvas().style.cursor = "pointer";
          paint(map, resultRef.current, selectedRef.current, hourRef.current);
        });
        mapRef.current = map;
        return () => {
          map.remove();
          mapRef.current = null;
        };
      }, []);

      useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const apply = () => paint(map, result, selectedId, hourRef.current);
        if (map.isStyleLoaded()) apply();
        else map.once("idle", apply);
      }, [result, selectedId]);

      return <div ref={containerRef} className="map-shell h-full w-full" />;
    },
  ),
);

function paint(map: Map, result: AnalyzeResponse | null, selectedId: string | null, hour: number) {
  const heatmap = map.getSource("heatmap") as GeoJSONSource | undefined;
  const routes = map.getSource("routes") as GeoJSONSource | undefined;
  const checkpoints = map.getSource("checkpoints") as GeoJSONSource | undefined;
  if (!heatmap || !routes || !checkpoints) return;
  if (!result) {
    heatmap.setData(EMPTY);
    routes.setData(EMPTY);
    checkpoints.setData(EMPTY);
    return;
  }
  heatmap.setData(heatmapData(result, hour));
  routes.setData(routeData(result.routes));
  checkpoints.setData(checkpointData(result.routes, selectedId));
  for (const route of result.routes) {
    map.setFeatureState({ source: "routes", id: route.id }, {
      selected: route.id === selectedId,
      recommended: route.recommended,
    });
  }
  const bounds = new LngLatBounds();
  let any = false;
  for (const route of result.routes) {
    for (const [lon, lat] of route.geometry) {
      bounds.extend([lon, lat]);
      any = true;
    }
  }
  if (any) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.fitBounds(bounds, { padding: 48, duration: reduce ? 0 : 500, maxZoom: 9 });
  }
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

function routeData(routes: RouteResult[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.map((route) => ({
      type: "Feature",
      id: route.id,
      properties: { id: route.id },
      geometry: { type: "LineString", coordinates: route.geometry },
    })),
  };
}

function checkpointData(routes: RouteResult[], selectedId: string | null): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const route of routes) {
    if (selectedId && route.id !== selectedId) continue;
    for (const point of route.checkpoints) {
      features.push({
        type: "Feature",
        properties: {
          routeId: route.id,
          index: point.index,
          level: point.risk.level,
          selected: route.id === selectedId ? 1 : 0,
        },
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
