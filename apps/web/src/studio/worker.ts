/// <reference lib="webworker" />
import { runChunked } from "./montecarlo";
import type { EditionPayload } from "./payload";
import type { Scenario } from "./scenario";

export interface RunRequest {
  payload: EditionPayload;
  scenario: Scenario;
  iterations: number;
}

self.onmessage = (event: MessageEvent<RunRequest>) => {
  const { payload, scenario, iterations } = event.data;
  try {
    const result = runChunked(payload, scenario, iterations, (done) =>
      self.postMessage({ type: "progress", done, total: iterations }),
    );
    self.postMessage({ type: "done", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
