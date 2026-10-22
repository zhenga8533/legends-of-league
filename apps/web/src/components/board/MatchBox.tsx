import type { BoardMatch, BoardOptions } from "./types";

const SOURCE_LABEL = { actual: "Real", picked: "Picked", simulated: "Sim" } as const;
const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

export function MatchBox({
  match,
  teams,
  showSource,
  onPick,
}: { match: BoardMatch } & BoardOptions) {
  // An empty team ID is a slot whose team isn't decided yet.
  const name = (team: string) => (team ? (teams[team]?.name ?? team) : "TBD");
  const tag = (team: string) => (team ? (teams[team]?.tag ?? team) : "TBD");
  const undecided = match.teams.every((team) => !team);
  const summary = match.score
    ? `${name(match.teams[0])} ${match.score[0]}–${match.score[1]} ${name(match.teams[1])}, best of ${match.bestOf}`
    : `${name(match.teams[0])} vs ${name(match.teams[1])}, best of ${match.bestOf}, ${undecided ? "teams to be decided" : "upcoming"}`;
  const simulated = showSource && match.source !== "actual";
  // Real results can't be overridden.
  const pickable = onPick !== undefined && match.source !== "actual";

  const rows = match.teams.map((team, i) => {
    const won = match.winner === team;
    const lost = match.score !== undefined && !won;
    const content = (
      <>
        <span className={`min-w-0 truncate ${team ? "" : "italic"}`}>{tag(team)}</span>
        <span
          className={`grid w-7 shrink-0 place-items-center self-stretch tabular-nums ${
            won ? "bg-accent font-semibold text-bg" : match.score ? "bg-surface-2" : ""
          }`}
        >
          {match.score?.[i] ?? ""}
        </span>
      </>
    );
    const rowClass = `flex w-full items-center justify-between gap-2 pl-2.5 text-left ${
      i === 0 ? "border-b border-border" : ""
    } ${won ? "font-semibold" : lost || !team ? "text-muted" : ""}`;
    const inner = (
      <span className="flex h-8 w-full items-center justify-between gap-2">{content}</span>
    );
    return pickable ? (
      <button
        key={i}
        type="button"
        className={`${rowClass} hover:bg-surface-2`}
        aria-pressed={match.source === "picked" && won}
        onClick={() => onPick?.(match, team)}
      >
        {inner}
        {/* The name is the visible tag and score plus this, so voice control can target what's
            on screen (WCAG 2.5.3). */}
        <span className="sr-only">
          : pick {name(team)} to win ({summary})
        </span>
      </button>
    ) : (
      <span key={i} className={rowClass}>
        {inner}
      </span>
    );
  });

  const status = match.score ? null : match.start ? day.format(new Date(match.start)) : "Upcoming";
  const footer = (
    <span className="flex justify-between border-t border-border px-2.5 py-0.5 text-[11px] text-muted">
      <span>
        Bo{match.bestOf}
        {status && ` · ${status}`}
      </span>
      {showSource && match.source && (
        <span
          className={`font-semibold uppercase tracking-wide ${
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
  const boxClass = `block w-full overflow-hidden rounded-md border bg-surface text-sm shadow-sm ${
    simulated
      ? "border-dashed border-blue-side"
      : undecided
        ? "border-dashed border-border"
        : "border-border"
  }`;

  if (match.href) {
    return (
      <a href={match.href} className={`${boxClass} transition-colors hover:border-accent`}>
        {rows}
        {footer}
        {/* The link's name is its visible text plus this, so it includes what's on screen. */}
        <span className="sr-only">{summary}</span>
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
