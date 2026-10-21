/* Generated from ingest/src/lol_ingest/models by `pnpm schema:gen`. Do not edit by hand. */

export interface LegendsOfLeagueCanonical {
  [k: string]: unknown;
}
/**
 * Inclusive date range; a missing bound means unknown or still ongoing.
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "DateRange".
 */
export interface DateRange {
  start?: string | null;
  end?: string | null;
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Draft".
 */
export interface Draft {
  blue: TeamDraft;
  red: TeamDraft;
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "TeamDraft".
 */
export interface TeamDraft {
  /**
   * Champion bans in draft order; null = no ban.
   */
  bans: (string | null)[];
  /**
   * Champion picks in draft order.
   */
  picks: string[];
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Edition".
 */
export interface Edition {
  id: string;
  tournament: string;
  year: number;
  name: string;
  status: "upcoming" | "live" | "completed";
  dates: DateRange;
  stages: Stage[];
  participants: Participant[];
  externalRefs?: ExternalRef[];
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Stage".
 */
export interface Stage {
  id: string;
  name: string;
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Participant".
 */
export interface Participant {
  team: string;
  /**
   * The team's region at the time of this edition.
   */
  region: string;
  entryStage: string;
}
/**
 * A provider's identifier for a canonical record, e.g. a Leaguepedia OverviewPage.
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "ExternalRef".
 */
export interface ExternalRef {
  provider: "leaguepedia" | "lolesports";
  /**
   * Provider field the value comes from, e.g. 'OverviewPage'.
   */
  key: string;
  value: string;
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Game".
 */
export interface Game {
  id: string;
  series: string;
  number: number;
  blue: string;
  red: string;
  winner: string;
  durationSeconds?: number | null;
  patch?: string | null;
  start?: string | null;
  draft?: Draft | null;
  externalRefs?: ExternalRef[];
}
/**
 * Data the edition should have but the provider does not supply.
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Gap".
 */
export interface Gap {
  record: string;
  reason: string;
}
/**
 * Relationship to another organization, e.g. KSV acquiring Samsung Galaxy's spot.
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "OrgLink".
 */
export interface OrgLink {
  org: string;
  relation: "acquisition" | "merger" | "spin-off";
  date?: string | null;
  note?: string | null;
}
/**
 * The persistent organization behind one or more team identities.
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Organization".
 */
export interface Organization {
  id: string;
  /**
   * Canonical display name; historical names live on TeamIdentity.
   */
  name: string;
  lineage?: OrgLink[];
  externalRefs?: ExternalRef[];
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Placement".
 */
export interface Placement {
  team: string;
  placeFrom: number;
  /**
   * Equal to place_from unless the place is shared.
   */
  placeTo: number;
  prizeUsd?: number | null;
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Player".
 */
export interface Player {
  id: string;
  /**
   * @minItems 1
   */
  handles: [PlayerHandle, ...PlayerHandle[]];
  realName?: string | null;
  nativeName?: string | null;
  /**
   * ISO 3166-1 alpha-2.
   */
  country?: string | null;
  externalRefs?: ExternalRef[];
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "PlayerHandle".
 */
export interface PlayerHandle {
  handle: string;
  active: DateRange;
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "PlayerGameStats".
 */
export interface PlayerGameStats {
  game: string;
  team: string;
  player: string;
  side: "blue" | "red";
  role: "top" | "jungle" | "mid" | "bot" | "support";
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  gold?: number | null;
  cs?: number | null;
  damageToChampions?: number | null;
  visionScore?: number | null;
  summonerSpells?: string[];
  items?: string[];
  trinket?: string | null;
  keystone?: string | null;
  primaryTree?: string | null;
  secondaryTree?: string | null;
  runes?: string[];
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Provenance".
 */
export interface Provenance {
  gaps?: Gap[];
  records?: ProvenanceRecord[];
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "ProvenanceRecord".
 */
export interface ProvenanceRecord {
  /**
   * Record key, e.g. 'series:ser:worlds-2024-swiss-round-1-01'.
   */
  key: string;
  provider: "leaguepedia" | "lolesports";
  /**
   * Provider identifier of the source row(s).
   */
  ref: string;
  /**
   * Truncated SHA-256 of the normalized record.
   */
  hash: string;
  /**
   * Run that last wrote the record; see data/_meta.
   */
  importRun: string;
  status: "verified" | "provisional";
}
/**
 * A competitive region during one era. Splits and merges (e.g. NA + BR + LAT into LTA)
 * are modelled as separate regions linked by predecessors/successors, so historical
 * records keep pointing at the region that existed at the time.
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Region".
 */
export interface Region {
  id: string;
  name: string;
  abbreviation: string;
  active: DateRange;
  predecessors?: string[];
  successors?: string[];
  externalRefs?: ExternalRef[];
}
/**
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "RosterEntry".
 */
export interface RosterEntry {
  team: string;
  player: string;
  role: "top" | "jungle" | "mid" | "bot" | "support" | "coach";
}
/**
 * A match between two teams: one Bo1 game, or a Bo3/Bo5 set of games.
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Series".
 */
export interface Series {
  id: string;
  stage: string;
  /**
   * Round label within the stage, e.g. 'Round 3', 'Finals'.
   */
  round: string;
  /**
   * Order of the series within its round.
   */
  number: number;
  bestOf: number;
  /**
   * @minItems 2
   * @maxItems 2
   */
  teams: [string, string];
  score?: [number, number] | null;
  winner?: string | null;
  forfeit?: boolean;
  tiebreaker?: boolean;
  start?: string | null;
  patch?: string | null;
  mvp?: string | null;
  externalRefs?: ExternalRef[];
}
/**
 * How an organization appeared over a period: name, tag and region (SKT T1 -> T1).
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "TeamIdentity".
 */
export interface TeamIdentity {
  id: string;
  org: string;
  name: string;
  /**
   * Tag, e.g. 'BLG'; unknown for some.
   */
  shortName?: string | null;
  region: string;
  active: DateRange;
  externalRefs?: ExternalRef[];
}
/**
 * A tournament series such as Worlds; individual years are editions.
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "Tournament".
 */
export interface Tournament {
  id: string;
  name: string;
  shortName: string;
  active: DateRange;
  externalRefs?: ExternalRef[];
}
