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
 * via the `definition` "Player".
 */
export interface Player {
  id: string;
  /**
   * @minItems 1
   */
  handles: [PlayerHandle, ...PlayerHandle[]];
  realName?: string | null;
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
 * How an organization appeared over a period: name, tag and region (SKT T1 -> T1).
 *
 * This interface was referenced by `LegendsOfLeagueCanonical`'s JSON-Schema
 * via the `definition` "TeamIdentity".
 */
export interface TeamIdentity {
  id: string;
  org: string;
  name: string;
  shortName: string;
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
