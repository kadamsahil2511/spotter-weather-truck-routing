import { Alert, Card } from "@heroui/react";

import { formatDuration, formatLevel, formatWhen, loadNote } from "../format";
import type { AnalyzeResponse } from "../types";
import { RiskBadge } from "./RiskBadge";

export function Results({
  result,
  selectedId,
  onSelect,
}: {
  result: AnalyzeResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = result.routes.find((route) => route.id === selectedId) ?? result.routes[0];
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold" id="recommendation" tabIndex={-1}>
        {result.recommendation ? "Recommended route" : "No recommendation"}
      </h2>
      {result.recommendation ? (
        <p>{result.recommendation.explanation}</p>
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
              ORS_API_KEY is not set, so these paths are not truck routes. Weather and the ranking
              still run on them.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      {result.warnings.includes("non_us") && (
        <Alert status="default">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              These load and wind rules are the assessment rules, not local truck law.
            </Alert.Description>
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
      <ul className="flex flex-col gap-2">
        {result.routes.map((route) => (
          <li key={route.id}>
            <Card
              className={`w-full text-left ${route.id === selectedId ? "ring-2 ring-[var(--accent)]" : ""}`}
            >
              <button className="w-full p-3 text-left" type="button" onClick={() => onSelect(route.id)}>
                <Card.Header className="flex items-center justify-between gap-2 p-0">
                  <Card.Title>
                    {route.label}
                    {route.recommended ? " · Recommended" : ""}
                  </Card.Title>
                  <RiskBadge level={route.summary.no_travel_mi > 0 ? "no_travel" : route.summary.severe_mi > 0 ? "severe" : "low"} />
                </Card.Header>
                <Card.Content className="p-0 pt-2 text-sm">
                  <p>
                    {formatDuration(route.duration_s)} · {route.distance_mi.toFixed(1)} mi
                  </p>
                  <p>
                    Severe {route.summary.severe_mi.toFixed(1)} mi · High {route.summary.high_mi.toFixed(1)} mi
                    · No Travel {route.summary.no_travel_mi.toFixed(1)} mi
                    {route.summary.avg_risk != null ? ` · avg ${route.summary.avg_risk.toFixed(2)}` : ""}
                  </p>
                </Card.Content>
              </button>
            </Card>
            {route.warnings.includes("no_travel") && (
              <Alert className="mt-2" status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>No Travel miles on {route.label}</Alert.Title>
                  <Alert.Description>
                    {route.summary.no_travel_mi.toFixed(1)} miles are No Travel. The rank still follows
                    the brief: Severe miles, then High miles, then average risk, then time.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            )}
          </li>
        ))}
      </ul>
      {selected && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">{selected.label} checkpoints</h3>
          <ul className="flex flex-col gap-2">
            {selected.checkpoints.map((point) => {
              const note = loadNote(point.risk.load_adjustment);
              return (
                <li
                  className="rounded-xl border border-stone-200 bg-white p-3 text-sm"
                  id={`cp-${selected.id}-${point.index}`}
                  key={point.index}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      Mile {point.mile.toFixed(1)} · {formatWhen(point.eta)}
                    </span>
                    <RiskBadge level={point.risk.level} />
                  </div>
                  <p className="mt-1 text-stone-600">
                    Sustained {point.weather.wind_used_mph ?? "—"} mph
                    {point.weather.gust_mph != null ? ` · gust ${point.weather.gust_mph} mph` : ""}
                    {" · "}rain {point.weather.rain_in_hr ?? "—"} in/hr · snow {point.weather.snow_in_hr ?? "—"} in/hr
                  </p>
                  <p className="text-stone-500">
                    Wind {formatLevel(point.risk.wind)} · Rain {formatLevel(point.risk.rain)} · Snow{" "}
                    {formatLevel(point.risk.snow)}
                    {note ? ` · ${note}` : ""}
                    {point.risk.partial ? " · partial forecast" : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
