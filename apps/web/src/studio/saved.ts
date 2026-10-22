/**
 * Scenarios saved in this browser. A per-viewer convenience: storage can be empty or unavailable
 * (private windows, blocked site data), so every read and write is guarded and the Studio works
 * without it. Links and exported files are the way to keep or share a scenario for good.
 */
import { type Scenario, ScenarioSchema } from "./scenario";

const KEY = "lol-studio-saved";
/** Oldest saves are dropped beyond this many. */
export const MAX_SAVED = 20;

export interface SavedScenario {
  id: string;
  name: string;
  savedAt: string;
  scenario: Scenario;
}

export function readSaved(): SavedScenario[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item: unknown): SavedScenario[] => {
      if (typeof item !== "object" || item === null) return [];
      const { id, name, savedAt, scenario } = item as Record<string, unknown>;
      const parsed = ScenarioSchema.safeParse(scenario);
      return typeof id === "string" &&
        typeof name === "string" &&
        typeof savedAt === "string" &&
        parsed.success
        ? [{ id, name, savedAt, scenario: parsed.data }]
        : [];
    });
  } catch {
    return [];
  }
}

/** Returns false when the browser won't store it. */
export function writeSaved(saved: SavedScenario[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved.slice(0, MAX_SAVED)));
    return true;
  } catch {
    return false;
  }
}
