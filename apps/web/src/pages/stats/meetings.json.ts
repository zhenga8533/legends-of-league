import { meetings } from "@lol/data";
import type { APIRoute } from "astro";
import { archive, orgName, paths, teamName } from "../../lib/archive";
import { withBase } from "../../lib/paths";
import type { MeetingsPayload } from "../../stats/types";

export const GET: APIRoute = () => {
  const rows = meetings(archive);
  const pairs = new Map<string, number>();
  for (const row of rows) {
    const key = [...row.orgs].sort().join("|");
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
  }
  const [mostPlayed] = [...pairs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const orgIds = [...new Set(rows.flatMap((row) => row.orgs))];
  const payload: MeetingsPayload = {
    orgs: orgIds
      .map((id) => ({ id, name: orgName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    teams: Object.fromEntries(
      [...new Set(rows.flatMap((row) => row.teams))].map((id) => [id, teamName(id)]),
    ),
    editions: Object.fromEntries(
      archive.editions.map((bundle) => [
        bundle.edition.id,
        { name: bundle.edition.name, path: paths.edition(bundle) },
      ]),
    ),
    matchBase: withBase("/matches/"),
    meetings: rows,
    defaultPair: (mostPlayed?.[0].split("|") ?? ["", ""]) as [string, string],
  };
  return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
};
