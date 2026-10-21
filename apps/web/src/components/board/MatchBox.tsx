import type { BoardMatch, BoardOptions } from "./types";

const SOURCE_LABEL = { actual: "Real", picked: "Picked", simulated: "Sim" } as const;

export function MatchBox({
  match,
  teams,
  showSource,
  onPick,
}: { match: BoardMatch } & BoardOptions) {
  const name = (team: string) => teams[team]?.name ?? team;
  const tag = (team: string) => teams[team]?.tag ?? team;
  const summary = `${name(match.teams[0])} ${match.score[0]}–${match.score[1]} ${name(match.teams[1])}, best of ${match.bestOf}`;
  const simulated = showSource && match.source !== "actual";
  // Real results can't be overridden.
  const pickable = onPick !== undefined && match.source !== "actual";

  const rows = match.teams.map((team, i) => {
    const won = match.winner === team;
    const record = match.records?.[i];
    const content = (
      <>
        <span className="truncate">
          {tag(team)}
          {record && (
            <span className="ml-1 text-xs font-normal text-muted">
              ({record.wins}-{record.losses})
            </span>
          )}
        </span>
        <span className={`tabular-nums ${won ? "text-accent" : ""}`}>{match.score[i]}</span>
      </>
    );
    const rowClass = `flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left ${
      won ? "font-semibold" : "text-muted"
    }`;
    return pickable ? (
      <button
        key={team}
        type="button"
        className={`${rowClass} hover:bg-surface-2`}
        aria-label={`Pick ${name(team)} to win: ${summary}`}
        aria-pressed={match.source === "picked" && won}
        onClick={() => onPick?.(match, team)}
      >
        {content}
      </button>
    ) : (
      <span key={team} className={rowClass}>
        {content}
      </span>
    );
  });

  const footer = (
    <span className="flex justify-between border-t border-border px-2.5 py-0.5 text-xs text-muted">
      <span>Bo{match.bestOf}</span>
      {showSource && match.source && (
        <span
          className={`rounded px-1 font-semibold uppercase tracking-wide ${
            match.source === "actual"
              ? ""
              : match.source === "picked"
                ? "text-accent"
                : "text-blue-side"
          }`}
        >
          {SOURCE_LABEL[match.source]}
        </span>
      )}
    </span>
  );
  const boxClass = `block min-w-44 rounded border bg-surface text-sm ${
    simulated ? "border-dashed border-blue-side" : "border-border"
  }`;

  if (match.href) {
    return (
      <a href={match.href} className={`${boxClass} hover:border-accent`} aria-label={summary}>
        {rows}
        {footer}
      </a>
    );
  }
  return (
    <div className={boxClass} role="group" aria-label={summary}>
      {rows}
      {footer}
    </div>
  );
}
