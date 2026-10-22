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
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-3 gap-y-4">
      {matches.map((match) => (
        <li key={match.key}>
          {labelled && (
            <p className="mb-1 h-4 truncate text-xs text-muted">
              {match.label === "Round robin" ? "" : capitalize(match.label)}
            </p>
          )}
          <MatchBox match={match} {...options} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Bracket rounds side by side. Every slot in a round gets an equal share of the height, so a
 * match sits level with the midpoint of the two it follows. Connector lines (CSS, see
 * global.css) join each pair of matches to the next round's match, or one match to the next
 * when a round keeps its size (lower brackets). Other shapes are left unconnected.
 */
function Columns({
  columns,
  options,
}: {
  columns: { label: string; matches: BoardMatch[] }[];
  options: BoardOptions;
}) {
  const sizes = columns.map((column) => column.matches.length);
  return (
    <div className="flex">
      {columns.map((column, c) => {
        const next = sizes[c + 1];
        const previous = sizes[c - 1];
        const pairs = next !== undefined && next * 2 === column.matches.length;
        const out = pairs || next === column.matches.length;
        const into =
          previous !== undefined &&
          (previous === column.matches.length * 2 || previous === column.matches.length);
        const slot = (match: BoardMatch) => (
          <li
            key={match.key}
            className={`relative flex flex-1 items-center py-1.5 ${out ? "bracket-out" : ""} ${
              into ? "bracket-in" : ""
            }`}
          >
            <MatchBox match={match} {...options} />
          </li>
        );
        const groups = pairs
          ? Array.from({ length: next }, (_, i) => column.matches.slice(i * 2, i * 2 + 2))
          : [column.matches];
        return (
          <div
            key={column.label}
            className={`flex w-44 shrink-0 flex-col ${c < columns.length - 1 ? "mr-10" : ""}`}
          >
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              {capitalize(column.label)}
            </p>
            <div className="flex flex-1 flex-col">
              {groups.map((group, g) => (
                <ul
                  key={g}
                  className={`relative flex flex-1 flex-col ${pairs ? "bracket-pair" : ""}`}
                >
                  {group.map(slot)}
                </ul>
              ))}
            </div>
          </div>
        );
      })}
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
  // Upcoming matches only add their teams; undecided slots add nothing.
  for (const match of matches.filter((m) => !isTiebreaker(m))) {
    for (const team of match.teams.filter(Boolean)) {
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
  // Wide boards scroll sideways on small screens; keyboard users need to reach the scroll area.
  const scrollable = { tabIndex: 0, role: "region", "aria-label": `${stage.name} board` } as const;

  let body;
  switch (stage.format) {
    case "swiss":
      body = (
        <div className="flex gap-4 overflow-x-auto pb-2" {...scrollable}>
          {columns.map((round) => {
            const pools = new Map<string, BoardMatch[]>();
            for (const match of round.matches) {
              const record = match.records?.[0];
              const key = record ? `${record.wins}–${record.losses}` : "";
              pools.set(key, [...(pools.get(key) ?? []), match]);
            }
            return (
              <div key={round.label} className="w-44 shrink-0 space-y-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
                  {round.label}
                </h3>
                {[...pools].map(([record, matches]) => (
                  <div key={record} className="space-y-2">
                    {record && (
                      <p className="text-xs font-semibold tabular-nums text-text">{record}</p>
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
        <div className={groups.length > 1 ? "grid gap-8 lg:grid-cols-2" : ""}>
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
        <div className="overflow-x-auto pb-2" {...scrollable}>
          <Columns columns={columns} options={options} />
        </div>
      );
      break;
    case "doubleElimination":
      body = (
        <div className="space-y-6 overflow-x-auto pb-2" {...scrollable}>
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

  if (stage.matches.length === 0) {
    body = <p className="text-sm text-muted">No matches yet: the teams aren't decided.</p>;
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
