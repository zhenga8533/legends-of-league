import { useEffect, useMemo, useState } from "react";
import type { MeetingsPayload } from "./types";

export default function HeadToHead({ dataUrl }: { dataUrl: string }) {
  const [data, setData] = useState<MeetingsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pair, setPair] = useState<[string, string]>(["", ""]);

  useEffect(() => {
    fetch(dataUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<MeetingsPayload>;
      })
      .then((payload) => {
        setData(payload);
        setPair(payload.defaultPair);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [dataUrl]);

  const [a, b] = pair;
  const rows = useMemo(
    () =>
      (data?.meetings ?? [])
        .filter((m) => (m.orgs[0] === a && m.orgs[1] === b) || (m.orgs[0] === b && m.orgs[1] === a))
        .reverse(),
    [data, a, b],
  );

  if (error) return <p role="alert">Couldn't load the head-to-head data ({error}).</p>;
  if (!data) return <p className="text-muted">Loading head-to-head…</p>;

  const name = (org: string) => data.orgs.find((o) => o.id === org)?.name ?? org;
  const side = (m: (typeof rows)[number], org: string) => (m.orgs[0] === org ? 0 : 1);
  const flip = (index: 0 | 1): 0 | 1 => (index === 0 ? 1 : 0);
  const tally = { a: 0, b: 0, gamesA: 0, gamesB: 0 };
  for (const m of rows) {
    const sa = side(m, a);
    if (m.winner === sa) tally.a++;
    else tally.b++;
    tally.gamesA += m.score[sa];
    tally.gamesB += m.score[flip(sa)];
  }
  const select = (index: 0 | 1, label: string) => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <select
        className="rounded border border-border bg-bg px-2 py-1.5"
        value={pair[index]}
        onChange={(e) =>
          setPair((current) =>
            index === 0 ? [e.target.value, current[1]] : [current[0], e.target.value],
          )
        }
      >
        {data.orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 sm:max-w-xl">
        {select(0, "Team")}
        {select(1, "Opponent")}
      </div>
      {a === b ? (
        <p className="text-muted">Pick two different teams.</p>
      ) : rows.length === 0 ? (
        <p className="text-muted" aria-live="polite">
          {name(a)} and {name(b)} have never met at an international event.
        </p>
      ) : (
        <>
          <p className="text-lg" aria-live="polite">
            <strong>{name(a)}</strong> {tally.a}–{tally.b} <strong>{name(b)}</strong>
            <span className="text-sm text-muted">
              {" "}
              in series · games {tally.gamesA}–{tally.gamesB}
            </span>
          </p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Meetings">
            <table className="data-table">
              <caption className="sr-only">
                Every international series between {name(a)} and {name(b)}, newest first
              </caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Edition</th>
                  <th scope="col">Match</th>
                  <th scope="col" className="num">
                    Score
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const sa = side(m, a);
                  const edition = data.editions[m.edition];
                  return (
                    <tr key={m.series}>
                      <td>{m.date ?? "—"}</td>
                      <td>
                        <a className="link" href={edition?.path}>
                          {edition?.name ?? m.edition}
                        </a>
                      </td>
                      <td>
                        <a
                          className="link"
                          href={`${data.matchBase}${m.series.slice(m.series.indexOf(":") + 1)}/`}
                        >
                          {data.teams[m.teams[sa]]} vs {data.teams[m.teams[flip(sa)]]}
                        </a>
                      </td>
                      <td className="num">
                        <span className={m.winner === sa ? "font-semibold" : ""}>
                          {m.score[sa]}
                        </span>
                        –
                        <span className={m.winner !== sa ? "font-semibold" : ""}>
                          {m.score[flip(sa)]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
