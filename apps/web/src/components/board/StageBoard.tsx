import { MatchBox } from "./MatchBox";
import type { BoardMatch, BoardOptions, BoardStage } from "./types";

function byLabel(matches: BoardMatch[]): { label: string; matches: BoardMatch[] }[] {
  const columns: { label: string; matches: BoardMatch[] }[] = [];
  for (const match of matches) {
    const column = columns.find((c) => c.label === match.label);
    if (column) column.matches.push(match);
    else columns.push({ label: match.label, matches: [match] });
  }
  return columns;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function MatchList({
  matches,
  options,
  labelled,
}: {
  matches: BoardMatch[];
  options: BoardOptions;
  labelled?: boolean;
}) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {matches.map((match) => (
        <li key={match.key}>
          {labelled && match.label !== "Round robin" && (
            <p className="mb-1 text-xs text-muted">{capitalize(match.label)}</p>
          )}
          <MatchBox match={match} {...options} />
        </li>
      ))}
    </ul>
  );
}

function Columns({
  columns,
  options,
}: {
  columns: { label: string; matches: BoardMatch[] }[];
  options: BoardOptions;
}) {
  return (
    <div className="flex gap-6">
      {columns.map((column) => (
        <div key={column.label} className="flex min-w-44 flex-col">
          <p className="mb-2 text-sm text-muted">{capitalize(column.label)}</p>
          <ul className="flex flex-1 flex-col justify-around gap-3">
            {column.matches.map((match) => (
              <li key={match.key}>
                <MatchBox match={match} {...options} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Wins and losses from a group's own matches; tiebreaker games aren't counted but order tied
 * teams: more tiebreaker wins first, then whoever was knocked out of the tiebreakers later.
 */
function GroupTable({ matches, options }: { matches: BoardMatch[]; options: BoardOptions }) {
  const isTiebreaker = (m: BoardMatch) => m.label.toLowerCase().includes("tiebreaker");
  const rows = new Map<
    string,
    { team: string; w: number; l: number; tbWins: number; tbOut: number }
  >();
  const row = (team: string) => rows.get(team) ?? { team, w: 0, l: 0, tbWins: 0, tbOut: Infinity };
  // Upcoming matches only add their teams.
  for (const match of matches.filter((m) => !isTiebreaker(m))) {
    for (const team of match.teams) {
      const entry = row(team);
      if (match.winner) entry[match.winner === team ? "w" : "l"]++;
      rows.set(team, entry);
    }
  }
  matches.filter(isTiebreaker).forEach((match, index) => {
    if (!match.winner || !match.loser) return;
    const winner = row(match.winner);
    winner.tbWins++;
    rows.set(match.winner, winner);
    const loser = row(match.loser);
    loser.tbOut = index;
    rows.set(match.loser, loser);
  });
  const ordered = [...rows.values()].sort(
    (a, b) => b.w - a.w || a.l - b.l || b.tbWins - a.tbWins || b.tbOut - a.tbOut,
  );
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Team</th>
          <th scope="col" className="num">
            W–L
          </th>
        </tr>
      </thead>
      <tbody>
        {ordered.map((row) => (
          <tr key={row.team}>
            <th scope="row" className="font-normal">
              {options.teams[row.team]?.name ?? row.team}
            </th>
            <td className="num">
              {row.w}–{row.l}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StageBoard({
  stage,
  headingLevel = 2,
  ...options
}: { stage: BoardStage; headingLevel?: 2 | 3 } & BoardOptions) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const columns = byLabel(stage.matches);
  const groups = [...new Set(stage.matches.flatMap((m) => (m.group ? [m.group] : [])))];
  const isRoundRobin = (matches: BoardMatch[]) => matches.some((m) => m.label === "Round robin");

  let body;
  switch (stage.format) {
    case "swiss":
      body = (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {columns.map((round) => {
            const pools = new Map<string, BoardMatch[]>();
            for (const match of round.matches) {
              const record = match.records?.[0];
              const key = record ? `${record.wins}–${record.losses}` : "";
              pools.set(key, [...(pools.get(key) ?? []), match]);
            }
            return (
              <div key={round.label} className="space-y-3">
                <h3 className="text-sm font-semibold text-muted">{round.label}</h3>
                {[...pools].map(([record, matches]) => (
                  <div key={record} className="space-y-2">
                    {record && (
                      <p className="text-xs uppercase tracking-wide text-muted">{record} pool</p>
                    )}
                    <ul className="space-y-2">
                      {matches.map((match) => (
                        <li key={match.key}>
                          <MatchBox match={match} {...options} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      );
      break;
    case "groups":
    case "gsl":
      body = (
        <div className="grid gap-6 md:grid-cols-2">
          {(groups.length > 0 ? groups : [""]).map((group) => {
            const matches = group ? stage.matches.filter((m) => m.group === group) : stage.matches;
            return (
              <div key={group} className="space-y-3">
                {group && <h3 className="font-semibold">{group}</h3>}
                {isRoundRobin(matches) && <GroupTable matches={matches} options={options} />}
                <MatchList matches={matches} options={options} labelled />
              </div>
            );
          })}
        </div>
      );
      break;
    case "roundRobin":
      body = (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <GroupTable matches={stage.matches} options={options} />
          <MatchList
            matches={stage.matches}
            options={options}
            labelled={stage.matches.some((m) => m.label !== "Round robin")}
          />
        </div>
      );
      break;
    case "singleElimination":
      body = (
        <div className="overflow-x-auto pb-2">
          <Columns columns={columns} options={options} />
        </div>
      );
      break;
    case "doubleElimination":
      body = (
        <div className="space-y-6 overflow-x-auto pb-2">
          {[
            { title: "Upper bracket", columns: columns.filter((c) => c.label.startsWith("Upper")) },
            { title: "Lower bracket", columns: columns.filter((c) => c.label.startsWith("Lower")) },
            { title: "Grand final", columns: columns.filter((c) => c.label === "Grand final") },
          ].map((part) => (
            <div key={part.title}>
              <h3 className="mb-2 font-semibold">{part.title}</h3>
              <Columns columns={part.columns} options={options} />
            </div>
          ))}
        </div>
      );
      break;
    case "series":
      body = <MatchList matches={stage.matches} options={options} />;
      break;
  }

  return (
    <section aria-labelledby={`stage-${stage.id}`} className="space-y-4">
      <Heading
        id={`stage-${stage.id}`}
        className={
          headingLevel === 2 ? "text-2xl font-semibold tracking-tight" : "text-xl font-semibold"
        }
      >
        {stage.name}
      </Heading>
      {body}
    </section>
  );
}
