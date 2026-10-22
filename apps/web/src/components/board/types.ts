import type { MatchSummary, StageSummary } from "@lol/sim";

export interface TeamLabel {
  name: string;
  tag: string;
}

type Result = "score" | "winner" | "loser" | "source";

/**
 * A match to show. Without a result it is upcoming, and a team ID of "" is a slot whose team
 * isn't decided yet (archive pages of an event in progress).
 */
export type BoardMatch = Omit<MatchSummary, Result> &
  Partial<Pick<MatchSummary, Result>> & {
    key: string;
    /** Archive pages link each match to its page. */
    href?: string;
    /** Start time; upcoming matches show the day. */
    start?: string;
  };

export interface BoardStage extends Omit<StageSummary, "matches"> {
  matches: BoardMatch[];
}

export interface BoardOptions {
  teams: Record<string, TeamLabel>;
  /** Studio: mark each match as real, picked or simulated. */
  showSource?: boolean;
  /** Studio: clicking a team picks it to win that match. */
  onPick?: (match: BoardMatch, winner: string) => void;
}
