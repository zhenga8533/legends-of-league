import { useState } from "react";

export interface TrendSeries {
  label: string;
  /** Every era's name, for the tooltip ("EU, EU LCS, LEC"). */
  eras: string;
  points: { year: number; wins: number; losses: number }[];
}

const WIDTH = 720;
const HEIGHT = 300;
const PAD = { top: 16, right: 64, bottom: 28, left: 40 };
const LABEL_GAP = 13;

const rate = (p: { wins: number; losses: number }) => p.wins / (p.wins + p.losses);
const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Cross-region series win rate per year, one line per region. Colours come from the chart
 * palette tokens (`--series-N` in global.css), assigned in the order the series are given.
 */
export function RegionTrend({ series, years }: { series: TrendSeries[]; years: [number, number] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [first, last] = years;
  const x = (year: number) =>
    PAD.left + ((year - first) / Math.max(last - first, 1)) * (WIDTH - PAD.left - PAD.right);
  const y = (share: number) => PAD.top + (1 - share) * (HEIGHT - PAD.top - PAD.bottom);
  const yearList = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  // Lines break where a region has no qualifying year, rather than bridging the gap.
  const segments = (points: TrendSeries["points"]) => {
    const runs: TrendSeries["points"][] = [];
    for (const point of points) {
      const run = runs.at(-1);
      if (run && run.at(-1)?.year === point.year - 1) run.push(point);
      else runs.push([point]);
    }
    return runs;
  };

  // Labels at each line's last point, spread apart where they would overlap; a leader line
  // joins a moved label to its point.
  const endLabels = series
    .flatMap((s) => {
      const end = s.points.at(-1);
      return end ? [{ text: s.label, x: x(end.year), pointY: y(rate(end)), y: y(rate(end)) }] : [];
    })
    .sort((a, b) => a.pointY - b.pointY);
  endLabels.forEach((label, i) => {
    const above = endLabels[i - 1];
    if (above && label.x === above.x) label.y = Math.max(label.y, above.y + LABEL_GAP);
  });

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * WIDTH;
    const year = Math.round(
      first + ((px - PAD.left) / (WIDTH - PAD.left - PAD.right)) * (last - first),
    );
    setHover(year >= first && year <= last ? year : null);
  };

  const hovered =
    hover === null ? [] : series.map((s) => ({ s, p: s.points.find((p) => p.year === hover) }));

  return (
    <figure className="space-y-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Legend">
        {series.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-4 rounded"
              style={{ background: `var(--series-${i + 1})` }}
            />
            <span title={s.eras}>{s.label}</span>
          </li>
        ))}
      </ul>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          role="img"
          aria-label="Cross-region series win rate per year by region; the table below has the numbers."
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((share) => (
            <g key={share}>
              <line
                x1={PAD.left}
                x2={WIDTH - PAD.right}
                y1={y(share)}
                y2={y(share)}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(share) + 4}
                textAnchor="end"
                className="fill-muted text-[11px]"
              >
                {percent(share)}
              </text>
            </g>
          ))}
          {yearList
            .filter((year) => (year - first) % 2 === 0 || year === last)
            .map((year) => (
              <text
                key={year}
                x={x(year)}
                y={HEIGHT - 8}
                textAnchor="middle"
                className="fill-muted text-[11px]"
              >
                {year}
              </text>
            ))}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              stroke="var(--color-muted)"
              strokeWidth={1}
            />
          )}
          {series.map((s, i) =>
            segments(s.points).map((run, j) => (
              <polyline
                key={`${s.label}-${j}`}
                points={run.map((p) => `${x(p.year)},${y(rate(p))}`).join(" ")}
                fill="none"
                stroke={`var(--series-${i + 1})`}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )),
          )}
          {series.map((s, i) =>
            s.points.map((p) => (
              <circle
                key={`${s.label}-${p.year}`}
                cx={x(p.year)}
                cy={y(rate(p))}
                r={p.year === hover ? 4 : 2.5}
                fill={`var(--series-${i + 1})`}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            )),
          )}
          {endLabels.map((label) => (
            <g key={label.text}>
              {label.y !== label.pointY && (
                <line
                  x1={label.x + 2}
                  y1={label.pointY}
                  x2={label.x + 10}
                  y2={label.y}
                  stroke="var(--color-muted)"
                  strokeWidth={1}
                />
              )}
              <text
                x={label.x + 12}
                y={label.y + 4}
                className="fill-current text-[11px] font-semibold"
              >
                {label.text}
              </text>
            </g>
          ))}
        </svg>
        {hover !== null && (
          <div
            data-testid="trend-readout"
            className="pointer-events-none absolute top-2 rounded border border-border bg-surface px-3 py-2 text-xs shadow"
            style={{ left: `${Math.min((x(hover) / WIDTH) * 100, 70)}%` }}
          >
            <p className="mb-1 font-semibold">{hover}</p>
            <ul>
              {hovered.map(({ s, p }, i) => (
                <li key={s.label} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block size-2 rounded-full"
                    style={{ background: `var(--series-${i + 1})` }}
                  />
                  {s.label}: {p ? `${percent(rate(p))} (${p.wins}–${p.losses})` : "—"}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </figure>
  );
}
