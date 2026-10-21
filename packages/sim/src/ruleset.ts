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
});

const GslSchema = z.object({ type: z.literal("gsl"), bestOf: odd });

const RoundRobinSchema = z.object({
  type: z.literal("roundRobin"),
  legs: z.union([z.literal(1), z.literal(2)]),
  bestOf: odd,
  /** Applied in order after series wins; teams still tied after all of them are drawn. */
  tiebreakers: z.array(TiebreakerSchema),
  advance: z.int().nonnegative(),
});

const SingleEliminationSchema = z.object({
  type: z.literal("singleElimination"),
  /** One entry per round, first round first. */
  bestOf: z.array(odd).min(1),
  seeding: z.enum(["standard", "random", "swissKnockout"]),
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

export const FormatSchema = z.discriminatedUnion("type", [
  SwissSchema,
  GslSchema,
  RoundRobinSchema,
  SingleEliminationSchema,
  DoubleEliminationSchema,
  GroupsSchema,
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
      z.object({ stage: z.string(), bucket: z.string(), place: z.tuple([positive, positive]) }),
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
