import { type Context, at, must } from "../context";
import type { Format } from "../ruleset";
import type { Entrant, PlayedMatch, StageOutcome, TeamId } from "../types";
import { runGsl } from "./gsl";
import { runRoundRobin } from "./roundRobin";

type GroupsFormat = Extract<Format, { type: "groups" }>;

const letter = (index: number): string => String.fromCharCode(65 + index);

/**
 * Several parallel groups of the same format. Bucket lists are merged group by group, so
 * "qualified:1" lists every group winner in group order.
 */
export function runGroups(
  format: GroupsFormat,
  stage: string,
  entrants: readonly Entrant[],
  ctx: Context,
): StageOutcome {
  const teams = entrants.map((e) => e.team);
  const groups = ctx.groups({ stage, count: format.count, teams }, () => {
    const dealt: TeamId[][] = Array.from({ length: format.count }, () => []);
    ctx.rng.shuffle(teams).forEach((team, i) => at(dealt, i % format.count).push(team));
    return dealt;
  });

  const matches: PlayedMatch[] = [];
  const buckets: StageOutcome["buckets"] = {};
  groups.forEach((members, index) => {
    const groupEntrants = members.map((team) =>
      must(
        entrants.find((e) => e.team === team),
        team,
      ),
    );
    const label = `Group ${letter(index)}`;
    const outcome =
      format.format.type === "gsl"
        ? runGsl(format.format, stage, groupEntrants, ctx, label)
        : runRoundRobin(format.format, stage, groupEntrants, ctx, label);
    matches.push(...outcome.matches);
    for (const [name, list] of Object.entries(outcome.buckets)) {
      buckets[name] = [...(buckets[name] ?? []), ...list];
    }
  });
  return { stage, matches, buckets };
}
