import type { MonteCarloResult } from "@lol/sim";
import type { EditionPayload } from "./payload";

const placeLabel = ([from, to]: [number, number]) => (from === to ? `${from}` : `${from}–${to}`);

/** Share of runs where the team finished at or above `position`. */
function atLeast(placements: Record<string, number>, position: number): number {
  return Object.entries(placements)
    .filter(([label]) => Number(label.split("-")[0]) <= position)
    .reduce((sum, [, share]) => sum + share, 0);
}

const percent = (share: number) =>
  share === 0 ? "–" : share < 0.001 ? "<0.1%" : `${(share * 100).toFixed(1)}%`;

export function OddsTable({
  result,
  payload,
  ratings,
  caption,
}: {
  result: MonteCarloResult;
  payload: EditionPayload;
  ratings: Record<string, number>;
  caption: string;
}) {
  const rows = Object.entries(result.teams)
    .map(([team, outlook]) => ({
      team,
      outlook,
      final: atLeast(outlook.placements, 2),
      top4: atLeast(outlook.placements, 4),
    }))
    .sort(
      (a, b) => b.outlook.champion - a.outlook.champion || b.final - a.final || b.top4 - a.top4,
    );
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={caption}>
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col" className="num">
              Elo
            </th>
            <th scope="col" className="num">
              Champion
            </th>
            <th scope="col" className="num">
              Final
            </th>
            <th scope="col" className="num">
              Top 4
            </th>
            <th scope="col" className="num">
              Real place
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, outlook, final, top4 }) => {
            const actual = payload.actualPlacements[team];
            return (
              <tr key={team}>
                <th scope="row" className="font-normal">
                  {payload.teams[team]?.name ?? team}
                  <span className="ml-1.5 rounded bg-surface-2 px-1 py-0.5 text-xs text-muted">
                    {payload.regions[payload.teams[team]?.region ?? ""] ?? ""}
                  </span>
                </th>
                <td className="num">{ratings[team]}</td>
                <td className="num font-semibold">{percent(outlook.champion)}</td>
                <td className="num">{percent(final)}</td>
                <td className="num">{percent(top4)}</td>
                <td className="num">{actual ? placeLabel(actual) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
