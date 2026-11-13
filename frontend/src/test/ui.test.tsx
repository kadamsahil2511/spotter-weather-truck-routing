import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HeatmapSlider } from "../components/HeatmapSlider";
import { OfflineNotice } from "../components/OfflineNotice";
import { Results } from "../components/Results";
import { RiskBadge } from "../components/RiskBadge";
import { TripForm } from "../components/TripForm";
import { sampleResult } from "./sampleResult";

describe("trip form", () => {
  it("does not submit until both places are picked", async () => {
    const onSubmit = vi.fn();
    render(<TripForm busy={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare routes" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Pick an origin and a destination from the list.")).toBeInTheDocument();
  });
});

describe("results", () => {
  it("shows the recommendation sentence and the no-travel warning", () => {
    render(<Results result={sampleResult} selectedId="direct" onSelect={() => undefined} />);
    expect(screen.getByText("direct has 0 severe miles versus 18 on via-east.")).toBeInTheDocument();
    expect(screen.getByText("2 h 0 min")).toBeInTheDocument();
    expect(screen.getAllByText(/100 mi/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Safest route/).length).toBeGreaterThan(0);
    expect(screen.getByText(/No Travel miles on Direct/)).toBeInTheDocument();
    expect(screen.getByText(/still follows the brief/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Start navigation" });
    const url = new URL(link.getAttribute("href") ?? "");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect((url.searchParams.get("waypoints") ?? "").split("|").length).toBeLessThanOrEqual(3);
    expect(screen.getByText("Car directions in Google Maps. Check truck restrictions.")).toBeInTheDocument();
  });

  it("renders routes in API order and takes Recommended from recommendation.route_id", () => {
    const result = {
      ...sampleResult,
      routes: [
        route("via-west", "Via west", true, { severe_mi: 50, high_mi: 0, moderate_mi: 0, no_travel_mi: 0, low_mi: 248 }),
        route("direct", "Direct", true, { severe_mi: 50, high_mi: 0, moderate_mi: 0, no_travel_mi: 50, low_mi: 171 }),
        route("via-east", "Via east", true, { severe_mi: 0, high_mi: 0, moderate_mi: 100, no_travel_mi: 0, low_mi: 196 }),
      ],
      recommendation: {
        route_id: "via-east",
        decided_by: "severe_mi",
        confidence: "full",
        explanation: "Via east has 0 severe miles versus 50 on Via west.",
      },
      warnings: [],
    };
    render(<Results result={result} selectedId="via-east" onSelect={() => undefined} showTimeline={false} />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-route-id"))).toEqual(["via-west", "direct", "via-east"]);
    expect(screen.getByRole("button", { name: /Via east/ })).toHaveTextContent("Safest route");
    expect(screen.getByRole("button", { name: /Via east/ })).toHaveTextContent("Moderate");
    expect(screen.getByRole("button", { name: /Via west/ })).not.toHaveTextContent("Safest");
    expect(screen.getByRole("button", { name: /Via west/ })).toHaveTextContent("Severe");
    expect(screen.getByRole("button", { name: /Direct/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Direct/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Via east/ })).toHaveAttribute("aria-pressed", "true");
  });
});

function route(
  id: string,
  label: string,
  recommended: boolean,
  miles: { severe_mi: number; high_mi: number; moderate_mi: number; no_travel_mi: number; low_mi: number },
) {
  return {
    ...sampleResult.routes[0],
    id,
    label,
    recommended,
    distance_mi: miles.low_mi + miles.moderate_mi + miles.high_mi + miles.severe_mi + miles.no_travel_mi,
    summary: {
      ...sampleResult.routes[0].summary,
      ...miles,
      unknown_mi: 0,
      avg_risk: 1,
      incomplete: false,
    },
    checkpoints: [],
    warnings: miles.no_travel_mi > 0 ? ["no_travel"] : [],
    geometry: [
      [-87.6, 41.8],
      [-89, 40.2],
      [-90.2, 38.6],
    ] as [number, number][],
  };
}

describe("risk badge", () => {
  it("includes the word Severe", () => {
    render(<RiskBadge level="severe" />);
    expect(screen.getByText("Severe")).toBeInTheDocument();
  });
});

describe("forecast slider", () => {
  it("exposes aria-valuetext that follows the hour", async () => {
    const { rerender } = render(
      <HeatmapSlider hour={0} label="T+0h · Mon 12:00 PM" onHour={() => undefined} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "T+0h · Mon 12:00 PM"),
    );
    rerender(<HeatmapSlider hour={3} label="T+3h · Mon 3:00 PM" onHour={() => undefined} />);
    await waitFor(() =>
      expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext", "T+3h · Mon 3:00 PM"),
    );
  });
});

describe("offline banner", () => {
  it("renders when the cached trip is marked offline", () => {
    render(<OfflineNotice />);
    expect(screen.getByText("Offline. Showing the last trip.")).toBeInTheDocument();
  });
});
