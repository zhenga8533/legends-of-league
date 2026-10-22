import type {
  ActualSeries,
  MonteCarloResult,
  Participant,
  Ruleset,
  ScheduledSeries,
} from "@lol/sim";

/** Everything the Studio needs about one edition; built at site build time. */
export interface EditionPayload {
  edition: {
    id: string;
    slug: string;
    name: string;
    year: number;
    tournament: string;
    path: string;
    /** Still being played: the Studio starts from the results so far. */
    live: boolean;
  };
  ruleset: Ruleset;
  participants: Participant[];
  actualSeries: ActualSeries[];
  /** Upcoming series whose teams are already known (events in progress). */
  scheduledSeries: ScheduledSeries[];
  actualPlacements: Record<string, [number, number]>;
  teams: Record<string, { name: string; tag: string; region: string }>;
  regions: Record<string, string>;
  /** Pre-event Elo, from games before the edition only. */
  ratings: Record<string, number>;
  /** Precomputed pre-event odds. */
  preEvent: MonteCarloResult;
  /** Live editions: precomputed odds from the results so far. */
  forecast?: MonteCarloResult;
}

export interface EditionOption {
  slug: string;
  name: string;
  live: boolean;
}
