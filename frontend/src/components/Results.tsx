import { Alert, Card } from "@heroui/react";
import { useEffect } from "react";

import {
  formatClock,
  formatDuration,
  formatLevel,
  formatMeasure,
  formatMiles,
  loadNote,
  worstSummaryLevel,
} from "../format";
import { googleMapsDirectionsUrl, NAV_CAVEAT } from "../nav";
import type { AnalyzeResponse, Place, RouteResult } from "../types";
import { RiskBadge } from "./RiskBadge";
import { RiskStrip } from "./RiskStrip";

export function Results({
  result,
  selectedId,
  onSelect,
  timeZone = "UTC",
  origin = null,
  destination = null,
  showTimeline = true,
}: {
  result: AnalyzeResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  timeZone?: string;
  origin?: Place | null;
  destination?: Place | null;
  showTimeline?: boolean;
}) {
  const recommendedId = result.recommendation?.route_id ?? null;
  const selected = result.routes.find((route) => route.id === selectedId) ?? result.routes[0];
  useEffect(() => {
    if (!selected?.id) return;
    document.getElementById(`route-${selected.id}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selected?.id]);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[#1C1917]" id="recommendation" tabIndex={-1}>
          {result.recommendation ? "Recommended route" : "No recommendation"}
        </h2>
        <p className="text-xs text-stone-500">Ranked: Severe mi, High mi, avg risk, time</p>
      </div>
      {result.recommendation ? (
        <p className="text-sm text-stone-700">{result.recommendation.explanation}</p>
      ) : (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Weather did not come back</Alert.Title>
            <Alert.Description>The lines are drawn. Nothing was ranked.</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {result.warnings.includes("routing_fixture") && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Straight-line stand-in</Alert.Title>
            <Alert.Description>
              ORS_API_KEY is not set, so these paths are not truck routes. Weather and the ranking still run on them.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {result.warnings.includes("non_us") && (
        <Alert status="default">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>These load and wind rules are the assessment rules, not local truck law.</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {result.warnings.includes("partial_routes") && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>The router returned fewer than three distinct routes.</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <ul aria-label="Routes in API order" className="flex flex-col gap-2">
        {result.routes.map((route) => (
          <li key={route.id} data-route-id={route.id}>
            <RouteCard
              route={route}
              selected={route.id === selected?.id}
              recommended={route.id === recommendedId}
              timeZone={timeZone}
              origin={origin}
              destination={destination}
              onSelect={onSelect}
            />
            {route.warnings.includes("no_travel") && (
              <Alert className="mt-2" status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>No Travel miles on {route.label}</Alert.Title>
                  <Alert.Description>
                    {formatMiles(route.summary.no_travel_mi)} miles are No Travel. The rank still follows the brief:
                    Severe miles, then High miles, then average risk, then time.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            )}
          </li>
        ))}
      </ul>
      {showTimeline && selected && <CheckpointList route={selected} timeZone={timeZone} />}
    </div>
  );
}

function RouteCard({
  route,
  selected,
  recommended,
  timeZone,
  origin,
  destination,
  onSelect,
}: {
  route: RouteResult;
  selected: boolean;
  recommended: boolean;
  timeZone: string;
  origin: Place | null;
  destination: Place | null;
  onSelect: (id: string) => void;
}) {
  const arrival = route.checkpoints.at(-1)?.eta;
  const href = googleMapsDirectionsUrl(route, origin, destination);
  const caveatId = `nav-caveat-${route.id}`;
  return (
    <Card className={`w-full ${selected ? "ring-2 ring-[#1C1917]" : ""}`}>
      <button
        id={`route-${route.id}`}
        className="w-full min-h-11 p-3 text-left"
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(route.id)}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-[#1C1917]">
            {route.label}
            {recommended ? " · Recommended" : ""}
          </p>
          <RiskBadge level={worstSummaryLevel(route.summary)} />
        </div>
        <p className="mt-1 text-sm text-stone-700">
          {formatDuration(route.duration_s)} · {formatMiles(route.distance_mi)} mi
          {arrival ? ` · arrive ${formatClock(arrival, timeZone)}` : ""}
        </p>
        <RiskStrip checkpoints={route.checkpoints} distanceMi={route.distance_mi} large={selected} />
        <p className="mt-1 text-xs text-stone-600">
          {formatMiles(route.summary.severe_mi)} Severe · {formatMiles(route.summary.high_mi)} High
          {route.summary.moderate_mi > 0.05 ? ` · ${formatMiles(route.summary.moderate_mi)} Moderate mi` : ""}
          {route.summary.avg_risk != null ? ` · avg ${route.summary.avg_risk.toFixed(2)}` : ""}
        </p>
        {route.summary.no_travel_mi > 0.05 && (
          <span className="mt-2 inline-flex min-h-8 items-center rounded-full bg-[#2B1B2E] px-2.5 text-xs font-medium text-[#fafaf9]">
            ⚠ {formatMiles(route.summary.no_travel_mi)} mi No Travel
          </span>
        )}
      </button>
      {selected && (
        <div className="px-3 pb-3">
          <a
            className="button button--primary inline-flex h-11 w-full items-center justify-center"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-describedby={caveatId}
          >
            Start navigation
          </a>
          <p className="mt-1 text-xs text-stone-500" id={caveatId}>
            {NAV_CAVEAT}
          </p>
        </div>
      )}
    </Card>
  );
}

function CheckpointList({ route, timeZone }: { route: RouteResult; timeZone: string }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-[#1C1917]">{route.label} along the way</h3>
      <ul className="flex flex-col gap-2">
        {route.checkpoints.map((point) => {
          const note = loadNote(point.risk.load_adjustment);
          return (
            <li
              className="rounded-xl border border-stone-200 bg-white p-3 text-sm"
              id={`cp-${route.id}-${point.index}`}
              key={point.index}
            >
              <div className="flex items-center justify-between gap-2">
                <span>
                  Mile {formatMiles(point.mile)} · {formatClock(point.eta, timeZone)}
                </span>
                <RiskBadge level={point.risk.level} />
              </div>
              <p className="mt-1 text-stone-700">
                Sustained {formatMeasure(point.weather.wind_used_mph)} mph
                {point.weather.gust_mph != null && (
                  <span className="text-stone-400"> · gust {formatMeasure(point.weather.gust_mph)} mph</span>
                )}
              </p>
              <p className="text-stone-500">
                Rain {formatMeasure(point.weather.rain_in_hr)} in/h · snow {formatMeasure(point.weather.snow_in_hr)} in/h
                {" · "}Wind {formatLevel(point.risk.wind)} · Rain {formatLevel(point.risk.rain)} · Snow{" "}
                {formatLevel(point.risk.snow)}
                {note ? ` · ${note}` : ""}
                {point.risk.partial ? " · partial forecast" : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
