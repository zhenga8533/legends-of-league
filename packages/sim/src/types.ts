export type TeamId = string;
/** Games won by [teams[0], teams[1]]. */
export type Score = [number, number];
export type MatchSource = "actual" | "picked" | "simulated";

export interface MatchSpec {
  stage: string;
  /** Human-readable position, e.g. "Round 3" or "Group A winners' match". */
  label: string;
  teams: [TeamId, TeamId];
  bestOf: number;
}

export interface PlayedMatch extends MatchSpec {
  score: Score;
  winner: TeamId;
  loser: TeamId;
  source: MatchSource;
}

export interface WinLoss {
  wins: number;
  losses: number;
}

/** A team entering a stage, carrying anything later seeding needs. */
export interface Entrant {
  team: TeamId;
  region?: string;
  record?: WinLoss;
}

export interface StageOutcome {
  stage: string;
  matches: PlayedMatch[];
  /** Named, ordered groups of teams, e.g. "qualified", "eliminated:1-3", "champion". */
  buckets: { [bucket: string]: Entrant[] };
}

export interface PairingRequest {
  stage: string;
  /** What the pairing is for, e.g. "round-3:2-0" or "group-a:opening". */
  purpose: string;
  teams: TeamId[];
}

export interface GroupsRequest {
  stage: string;
  count: number;
  teams: TeamId[];
}

/**
 * Supplies known facts to a simulation: locked results (actual or user-picked) and fixed draws.
 * Anything it does not answer is drawn or simulated.
 */
export interface Resolver {
  result?(match: MatchSpec): { score: Score; source: MatchSource } | undefined;
  pairing?(request: PairingRequest): [TeamId, TeamId][] | undefined;
  groups?(request: GroupsRequest): TeamId[][] | undefined;
  /** A fresh copy for another run, for resolvers that track what one run has consumed. */
  fork?(): Resolver;
}
