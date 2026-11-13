import type { AnalyzeRequest, AnalyzeResponse, Place } from "./types";

const base = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function geocode(query: string, signal: AbortSignal): Promise<Place[]> {
  const response = await fetch(`${base}/api/geocode?q=${encodeURIComponent(query)}`, { signal });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new ApiError(body.error?.message ?? "Place search failed.", response.status);
  }
  return (body.results as Omit<Place, "id">[]).map((place, index) => ({
    ...place,
    id: `${place.label}-${index}`,
  }));
}

export async function analyze(payload: AnalyzeRequest, signal: AbortSignal): Promise<AnalyzeResponse> {
  const response = await fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new ApiError(body.error?.message ?? "The trip could not be analyzed.", response.status);
  }
  return body as AnalyzeResponse;
}
