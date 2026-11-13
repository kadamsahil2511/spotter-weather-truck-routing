import { describe, expect, it } from "vitest";

import { ANALYZE_TIMEOUT_MS, loadingStage } from "../loading";

describe("loading stage", () => {
  it("names routes first and weather after a few seconds", () => {
    expect(loadingStage(0)).toBe("Finding truck routes…");
    expect(loadingStage(2499)).toBe("Finding truck routes…");
    expect(loadingStage(2500)).toBe("Checking weather…");
  });

  it("stops the request before the server timeout", () => {
    expect(ANALYZE_TIMEOUT_MS).toBeLessThan(120_000);
    expect(ANALYZE_TIMEOUT_MS).toBeGreaterThan(60_000);
  });
});
