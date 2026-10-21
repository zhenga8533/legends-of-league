import type { Format, Ruleset } from "./ruleset";
import type { TournamentResult } from "./tournament";
import type { PlayedMatch, TeamId, WinLoss } from "./types";

export interface MatchSummary extends Omit<PlayedMatch, "stage"> {
  /** "Group A" for grouped stages; `label` then holds the rest ("winners' match"). */
  group?: string;
  /** Swiss only: both teams' records going into the match. */
  records?: [WinLoss, WinLoss];
}

export interface StageSummary {
  id: string;
  name: string;
  format: Format["type"];
  matches: MatchSummary[];
}

/** A tournament result arranged per stage for display (archive pages and the Studio alike). */
export function summarizeStages(result: TournamentResult, ruleset: Ruleset): StageSummary[] {
  return ruleset.stages.map((definition) => {
    const records = new Map<TeamId, WinLoss>();
    const record = (team: TeamId): WinLoss => records.get(team) ?? { wins: 0, losses: 0 };
    const matches = (result.stages[definition.id]?.matches ?? []).map((match): MatchSummary => {
      const { label, teams, bestOf, score, winner, loser, source } = match;
      // Grouped matches are labelled "Group A <position>" (GSL), "Group A" (round robin) or
      // "Group A tiebreaker".
      const group = /^(Group [A-Z])(?: (.*))?$/.exec(label);
      const summary: MatchSummary = {
        label: group ? (group[2] ?? "Round robin") : label,
        teams,
        bestOf,
        score,
        winner,
        loser,
        source,
        ...(group?.[1] ? { group: group[1] } : {}),
      };
      if (definition.format.type === "swiss") {
        summary.records = [record(teams[0]), record(teams[1])];
        const winnerRecord = record(winner);
        const loserRecord = record(loser);
        records.set(winner, { wins: winnerRecord.wins + 1, losses: winnerRecord.losses });
        records.set(loser, { wins: loserRecord.wins, losses: loserRecord.losses + 1 });
      }
      return summary;
    });
    return { id: definition.id, name: definition.name, format: definition.format.type, matches };
  });
}
