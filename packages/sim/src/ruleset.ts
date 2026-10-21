import { z } from "zod";

const positive = z.int().positive();
const odd = positive.refine((n) => n % 2 === 1, "best-of must be odd");

export const TiebreakerSchema = z.enum([
  "headToHead",
  "headToHeadGameDiff",
  "gameDiff",
  "gameWins",
]);

const SwissSchema = z.object({
  type: z.literal("swiss"),
  wins: positive,
  losses: positive,
  /** `decisive` applies when a match can decide advancement or elimination. */
  bestOf: z.object({ default: odd, decisive: odd }),
  /**
   * "avoid": no rematches unless every possible draw of a pool has one. "allow": rematches
   * may be drawn freely (for editions whose real draws had avoidable rematches).
   */
  rematches: z.enum(["avoid", "allow"]).default("avoid"),
});

const GslSchema = z.object({ type: z.literal("gsl"), bestOf: odd });

const RoundRobinSchema = z.object({
  type: z.literal("roundRobin"),
  /** How many times each pair meets. */
  legs: z.int().min(1).max(4),
  /** Overrides `legs` by group size, e.g. { "3": 4 } for a three-team group that met 4 times. */
  legsBySize: z.record(z.string(), z.int().min(1).max(4)).default({}),
  bestOf: odd,
  /** Applied in order after series wins. */
  tiebreakers: z.array(TiebreakerSchema),
  /**
   * Ties that span one of these positions (a tie across 2|3 for `2`) are settled by tiebreaker
   * games: one game for two teams, a bye bracket for three, two games plus a final for four.
   * Other ties stay shared. Without this, unresolved ties are drawn at random.
   */
  tiebreakerGames: z.object({ positions: z.array(positive), bestOf: odd.default(1) }).optional(),
  advance: z.int().nonnegative(),
});

const SingleEliminationSchema = z.object({
  type: z.literal("singleElimination"),
  /** One entry per round, first round first. */
  bestOf: z.array(odd).min(1),
  /** `groupDraw`: group winners face runners-up from other groups, group mates on opposite halves. */
  seeding: z.enum(["standard", "random", "swissKnockout", "groupDraw"]),
});

const DoubleEliminationSchema = z.object({
  type: z.literal("doubleElimination"),
  bestOf: odd,
  seeding: z.enum(["standard", "random"]),
});

const GroupsSchema = z.object({
  type: z.literal("groups"),
  count: z.int().min(2),
  format: z.discriminatedUnion("type", [GslSchema, RoundRobinSchema]),
});

const SeriesSchema = z.object({
  type: z.literal("series"),
  bestOf: odd,
  /**
   * Which entrants meet, as index pairs into the stage's entrant list; defaults to one series
   * between the first two. Used for qualifiers such as a last-chance match or crossed Bo5s.
   */
  pairs: z
    .array(z.tuple([z.int().nonnegative(), z.int().nonnegative()]))
    .min(1)
    .default([[0, 1]]),
  /**
   * "fixed": exactly `pairs`. "halves": the first half of the entrants is drawn against the
   * second half, keeping teams from the same group apart where possible.
   */
  draw: z.enum(["fixed", "halves"]).default("fixed"),
});

export const FormatSchema = z.discriminatedUnion("type", [
  SwissSchema,
  GslSchema,
  RoundRobinSchema,
  SingleEliminationSchema,
  DoubleEliminationSchema,
  GroupsSchema,
  SeriesSchema,
]);

const EntrantSourceSchema = z.union([
  /** Teams whose edition entry stage is this stage (direct invites). */
  z.object({ entry: z.literal(true) }),
  /** Teams from an earlier stage's bucket, in bucket order. */
  z.object({ stage: z.string(), bucket: z.string() }),
]);

const StageSchema = z.object({
  id: z.string(),
  name: z.string(),
  format: FormatSchema,
  entrants: z.array(EntrantSourceSchema).min(1),
});

export const RulesetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** Edition IDs (e.g. "ed:worlds-2024") this ruleset describes. */
    editions: z.array(z.string()),
    notes: z.array(z.string()).default([]),
    sources: z.array(z.url()).default([]),
    stages: z.array(StageSchema).min(1),
    placements: z.array(
      z.object({
        stage: z.string(),
        bucket: z.string(),
        place: z.tuple([positive, positive]),
        /**
         * "rank": split the range in order of the teams' finishing positions in their group,
         * with tied teams sharing places (e.g. 3rd places 9-11, a 3rd/4th tie 12-13, 4ths 14-16).
         */
        /** "wins": the same, but tiered by round-robin wins (best first) instead of position. */
        split: z.enum(["rank", "wins"]).optional(),
      }),
    ),
  })
  .superRefine((ruleset, ctx) => {
    const seen = new Set<string>();
    for (const stage of ruleset.stages) {
      for (const source of stage.entrants) {
        if ("stage" in source && !seen.has(source.stage)) {
          ctx.addIssue({
            code: "custom",
            message: `${stage.id} takes entrants from ${source.stage}, which does not run earlier`,
          });
        }
      }
      seen.add(stage.id);
    }
    for (const rule of ruleset.placements) {
      if (!seen.has(rule.stage)) {
        ctx.addIssue({
          code: "custom",
          message: `placement refers to unknown stage ${rule.stage}`,
        });
      }
    }
  });

export type Ruleset = z.infer<typeof RulesetSchema>;
export type Format = z.infer<typeof FormatSchema>;
export type Tiebreaker = z.infer<typeof TiebreakerSchema>;
export type StageDefinition = Ruleset["stages"][number];

export function parseRuleset(json: unknown): Ruleset {
  return RulesetSchema.parse(json);
}
