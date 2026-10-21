import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Organization, Player, Region, TeamIdentity, Tournament } from "@lol/schema";
import { DATA_DIR } from "./load";

export interface Entities {
  regions: Map<string, Region>;
  tournaments: Map<string, Tournament>;
  organizations: Map<string, Organization>;
  teams: Map<string, TeamIdentity>;
  players: Map<string, Player>;
}

function byId<T extends { id: string }>(dataDir: string, name: string): Map<string, T> {
  const records = JSON.parse(
    readFileSync(join(dataDir, "entities", `${name}.json`), "utf8"),
  ) as T[];
  return new Map(records.map((record) => [record.id, record]));
}

export function loadEntities(dataDir: string = DATA_DIR): Entities {
  return {
    regions: byId(dataDir, "regions"),
    tournaments: byId(dataDir, "tournaments"),
    organizations: byId(dataDir, "organizations"),
    teams: byId(dataDir, "teams"),
    players: byId(dataDir, "players"),
  };
}

/** The part of a canonical ID after its prefix, used in URLs: "team:t1" -> "t1". */
export function idSlug(id: string): string {
  return id.slice(id.indexOf(":") + 1);
}

export function playerHandle(player: Player): string {
  return player.handles.at(-1)?.handle ?? idSlug(player.id);
}
