import type { MeetingRow } from "@lol/data";

/** The head-to-head tool's data, served as /stats/meetings.json. */
export interface MeetingsPayload {
  /** Organizations that played at least one series, by display name. */
  orgs: { id: string; name: string }[];
  teams: Record<string, string>;
  editions: Record<string, { name: string; path: string }>;
  /** Match pages are at `${matchBase}<series ID without its prefix>/`. */
  matchBase: string;
  meetings: MeetingRow[];
  /** The most-played pairing, shown first. */
  defaultPair: [string, string];
}
