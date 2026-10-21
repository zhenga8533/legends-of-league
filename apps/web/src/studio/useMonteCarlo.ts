import type { MonteCarloResult } from "@lol/sim";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditionPayload } from "./payload";
import type { Scenario } from "./scenario";
import type { RunRequest } from "./worker";

export type MonteCarloState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number }
  | { status: "done"; result: MonteCarloResult; scenario: Scenario }
  | { status: "error"; message: string };

/** Runs Monte Carlo batches in a Web Worker so the page stays responsive. */
export function useMonteCarlo() {
  const [state, setState] = useState<MonteCarloState>({ status: "idle" });
  const worker = useRef<Worker | null>(null);

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);

  const run = useCallback(
    (payload: EditionPayload, scenario: Scenario, iterations: number) => {
      stop();
      const instance = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      worker.current = instance;
      setState({ status: "running", done: 0, total: iterations });
      instance.onmessage = (event: MessageEvent) => {
        const message = event.data as
          | { type: "progress"; done: number; total: number }
          | { type: "done"; result: MonteCarloResult }
          | { type: "error"; message: string };
        if (message.type === "progress")
          setState({ status: "running", done: message.done, total: message.total });
        if (message.type === "done") {
          setState({ status: "done", result: message.result, scenario });
          stop();
        }
        if (message.type === "error") {
          setState({ status: "error", message: message.message });
          stop();
        }
      };
      instance.onerror = (event) => {
        setState({ status: "error", message: event.message || "The simulation worker failed." });
        stop();
      };
      const request: RunRequest = { payload, scenario, iterations };
      instance.postMessage(request);
    },
    [stop],
  );

  const reset = useCallback(() => {
    stop();
    setState({ status: "idle" });
  }, [stop]);

  useEffect(() => stop, [stop]);
  return { state, run, reset };
}
