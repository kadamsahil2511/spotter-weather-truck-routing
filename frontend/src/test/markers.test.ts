import { describe, expect, it } from "vitest";

import { weatherMarker } from "../map/markers";

describe("weather markers", () => {
  it("shows sustained wind and never the gust", () => {
    const marker = weatherMarker({
      risk: { level: "severe", wind: "severe", rain: "low", snow: "low" },
      weather: { wind_used_mph: 36, gust_mph: 70, rain_in_hr: 0, snow_in_hr: 0 },
    });
    expect(marker?.icon).toBe("wind");
    expect(marker?.label).toBe("36 mph");
    expect(marker?.label).not.toContain("70");
  });

  it("uses rain in/h when rain is the worse hazard", () => {
    const marker = weatherMarker({
      risk: { level: "high", wind: "low", rain: "high", snow: "low" },
      weather: { wind_used_mph: 10, gust_mph: 40, rain_in_hr: 0.3, snow_in_hr: 0 },
    });
    expect(marker?.icon).toBe("rain");
    expect(marker?.label).toBe("0.3 in/h");
  });

  it("skips low checkpoints", () => {
    expect(
      weatherMarker({
        risk: { level: "low", wind: "low", rain: "low", snow: "low" },
        weather: { wind_used_mph: 12, gust_mph: 55, rain_in_hr: 0, snow_in_hr: 0 },
      }),
    ).toBeNull();
  });
});
