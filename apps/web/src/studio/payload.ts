import type { ActualSeries, MonteCarloResult, Participant, Ruleset } from "@lol/sim";

/** Everything the Studio needs about one edition; built at site build time. */
export interface EditionPayload {
  edition: {
    id: string;
    slug: string;
    name: string;
    year: number;
    tournament: string;
    path: string;
  };
  ruleset: Ruleset;
  participants: Participant[];
  actualSeries: ActualSeries[];
  actualPlacements: Record<string, [number, number]>;
  teams: Record<string, { name: string; tag: string; region: string }>;
  regions: Record<string, string>;
  /** Pre-event Elo, from games before the edition only. */
  ratings: Record<string, number>;
  /** Precomputed pre-event odds. */
  preEvent: MonteCarloResult;
}

export interface EditionOption {
  slug: string;
  name: string;
}
