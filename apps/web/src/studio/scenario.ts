/** A Studio scenario: everything needed to reproduce a simulation, small enough for a URL. */
import { z } from "zod";

export const ScenarioSchema = z.object({
  v: z.literal(1),
  edition: z.string().regex(/^[a-z0-9-]+$/),
  seed: z.string().min(1).max(64),
  /** Stage to simulate from; earlier stages keep their real results. Null simulates everything. */
  from: z.string().nullable(),
  /** Picked winners by match: `${stage}|${teamA}|${teamB}` with the teams sorted. */
  picks: z.record(z.string(), z.string()),
  /** Rating overrides by team. */
  ratings: z.record(z.string(), z.number().finite().min(0).max(4000)),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

export function defaultScenario(edition: string): Scenario {
  return { v: 1, edition, seed: "1", from: null, picks: {}, ratings: {} };
}

export function pickKey(stage: string, teams: readonly string[]): string {
  return [stage, ...[...teams].sort()].join("|");
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function encodeScenario(scenario: Scenario): string {
  return toBase64Url(JSON.stringify(scenario));
}

export function decodeScenario(text: string): Scenario | undefined {
  try {
    const parsed = ScenarioSchema.safeParse(JSON.parse(fromBase64Url(text)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Reads `#s=<scenario>` or `#ed=<edition>` (links from edition pages). */
export function scenarioFromHash(hash: string): Scenario | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const encoded = params.get("s");
  if (encoded) return decodeScenario(encoded);
  const edition = params.get("ed");
  return edition && /^[a-z0-9-]+$/.test(edition) ? defaultScenario(edition) : undefined;
}

export function parseScenarioFile(text: string): Scenario | undefined {
  try {
    const parsed = ScenarioSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
