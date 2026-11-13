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
    expect(screen.getByText("Time 2 h 0 min · Distance 100.0 miles")).toBeInTheDocument();
    expect(screen.getByText(/No Travel miles on Direct/)).toBeInTheDocument();
    expect(screen.getByText(/still follows the brief/)).toBeInTheDocument();
  });
});

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
