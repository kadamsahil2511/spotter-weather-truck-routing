import { get, set } from "idb-keyval";

import type { AnalyzeResponse } from "../types";

const KEY = "last-analyze";

export function saveLastResult(result: AnalyzeResponse): Promise<void> {
  return set(KEY, result);
}

export function loadLastResult(): Promise<AnalyzeResponse | undefined> {
  return get<AnalyzeResponse>(KEY);
}
