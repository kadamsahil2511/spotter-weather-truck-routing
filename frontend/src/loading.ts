/** Copy shown while one analyze request is in flight. Weather is the short tail. */
export function loadingStage(elapsedMs: number): string {
  if (elapsedMs < 2500) return "Finding truck routes…";
  return "Checking weather…";
}

export const ANALYZE_TIMEOUT_MS = 90_000;

export const ANALYZE_TIMEOUT_MESSAGE =
  "This trip is taking too long. The check was stopped so you can try again.";
