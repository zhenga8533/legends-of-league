import { createRng, simulateTournament, summarizeStages } from "@lol/sim";
import { useEffect, useMemo, useRef, useState } from "react";
import { StageBoard } from "../components/board/StageBoard";
import type { BoardMatch, BoardStage } from "../components/board/types";
import { PRE_EVENT_ITERATIONS } from "./constants";
import { OddsTable } from "./OddsTable";
import type { EditionOption, EditionPayload } from "./payload";
import {
  NOW,
  type Scenario,
  defaultScenario,
  encodeScenario,
  parseScenarioFile,
  pickKey,
  scenarioFromHash,
} from "./scenario";
import { type SavedScenario, readSaved, writeSaved } from "./saved";
import { setupScenario } from "./setup";
import { useMonteCarlo } from "./useMonteCarlo";

const ITERATIONS = [1_000, 10_000, 50_000];

function newSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

export default function Studio({
  editions,
  dataBase,
}: {
  editions: EditionOption[];
  dataBase: string;
}) {
  const startingScenario = (slug: string) =>
    defaultScenario(slug, editions.find((e) => e.slug === slug)?.live);
  const [scenario, setScenario] = useState<Scenario>(() => {
    const fromHash =
      typeof location === "undefined"
        ? undefined
        : scenarioFromHash(location.hash, startingScenario);
    const known = fromHash && editions.some((e) => e.slug === fromHash.edition);
    return known ? fromHash : startingScenario(editions[0]?.slug ?? "");
  });
  const [payload, setPayload] = useState<EditionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<SavedScenario[]>(readSaved);
  const [iterations, setIterations] = useState(10_000);
  const montecarlo = useMonteCarlo();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setLoadError(null);
    fetch(`${dataBase}${scenario.edition}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<EditionPayload>;
      })
      .then((data) => !cancelled && setPayload(data))
      .catch((error: unknown) => !cancelled && setLoadError(String(error)));
    return () => {
      cancelled = true;
    };
  }, [dataBase, scenario.edition]);

  useEffect(() => {
    history.replaceState(null, "", `#s=${encodeScenario(scenario)}`);
  }, [scenario]);

  const { reset: resetMonteCarlo } = montecarlo;
  useEffect(() => resetMonteCarlo(), [scenario, resetMonteCarlo]);

  const single = useMemo(() => {
    if (!payload) return null;
    try {
      const setup = setupScenario(payload, scenario);
      const result = simulateTournament(setup.input, {
        rng: createRng(scenario.seed),
        model: setup.model,
        resolver: setup.resolver,
      });
      const stages: BoardStage[] = summarizeStages(result, payload.ruleset).map((stage) => ({
        ...stage,
        matches: stage.matches.map((match, index): BoardMatch => ({
          ...match,
          key: `${stage.id}:${index}`,
        })),
      }));
      return { result, stages, setup, error: null };
    } catch (error) {
      return {
        result: null,
        stages: [],
        setup: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [payload, scenario]);

  const update = (patch: Partial<Scenario>) => setScenario((current) => ({ ...current, ...patch }));
  const pick = (match: BoardMatch, winner: string) => {
    const stage = single?.stages.find((s) => s.matches.includes(match))?.id;
    if (!stage) return;
    update({ picks: { ...scenario.picks, [pickKey(stage, match.teams)]: winner } });
  };
  const champion = single?.result
    ? [...single.result.placements].find(([, place]) => place[0] === 1)?.[0]
    : undefined;
  const realChampion = payload
    ? Object.entries(payload.actualPlacements).find(([, place]) => place[0] === 1)?.[0]
    : undefined;
  const teamName = (team?: string) => (team ? (payload?.teams[team]?.name ?? team) : "—");
  const appliedPicks =
    single?.stages.flatMap((s) => s.matches).filter((m) => m.source === "picked").length ?? 0;
  const ratings = single?.setup?.ratings ?? payload?.ratings ?? {};

  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setNotice("Link copied. It reproduces this exact scenario.");
    } catch {
      setNotice("Copy the address bar to share this scenario.");
    }
  };
  const exportScenario = () => {
    const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `legends-of-league-${scenario.edition}-${scenario.seed}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const saveScenario = () => {
    const from =
      scenario.from === null
        ? "from the start"
        : scenario.from === NOW
          ? "from now"
          : `from ${payload?.ruleset.stages.find((s) => s.id === scenario.from)?.name ?? scenario.from}`;
    const picks = Object.keys(scenario.picks).length;
    const entry: SavedScenario = {
      id: `${Date.now()}-${newSeed()}`,
      name: [
        // The edition list is there before the edition's data has loaded.
        editions.find((e) => e.slug === scenario.edition)?.name ?? scenario.edition,
        from,
        `seed ${scenario.seed}`,
        ...(picks > 0 ? [`${picks} pick${picks === 1 ? "" : "s"}`] : []),
      ].join(" · "),
      savedAt: new Date().toISOString(),
      scenario,
    };
    const same = encodeScenario(scenario);
    const next = [entry, ...saved.filter((s) => encodeScenario(s.scenario) !== same)];
    if (writeSaved(next)) {
      setSaved(readSaved());
      setNotice("Saved in this browser.");
    } else {
      setNotice("This browser won't store scenarios. Use Copy link or Export instead.");
    }
  };
  const openSaved = (entry: SavedScenario) => {
    if (!editions.some((e) => e.slug === entry.scenario.edition)) {
      setNotice("That saved scenario's edition is no longer available.");
      return;
    }
    setScenario(entry.scenario);
    setNotice(`Opened “${entry.name}”.`);
  };
  const removeSaved = (id: string) => {
    if (writeSaved(saved.filter((s) => s.id !== id))) setSaved(readSaved());
  };
  const importScenario = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseScenarioFile(await file.text());
    if (parsed && editions.some((e) => e.slug === parsed.edition)) {
      setScenario(parsed);
      setNotice("Scenario imported.");
    } else {
      setNotice("That file isn't a valid Legends of League scenario.");
    }
  };

  return (
    <div className="space-y-8">
      <div
        role="note"
        className="sticky top-0 z-10 rounded-lg border border-dashed border-blue-side bg-surface px-4 py-2 text-sm"
      >
        <strong className="text-blue-side">Simulated.</strong> Brackets and odds on this page come
        from the simulator, not from real matches, except where marked <em>Real</em>.
      </div>

      <section aria-labelledby="scenario" className="card space-y-4 p-4">
        <h2 id="scenario" className="text-xl font-semibold">
          Scenario
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            Edition
            <select
              className="input"
              value={scenario.edition}
              onChange={(e) => setScenario(startingScenario(e.target.value))}
            >
              {editions.map((edition) => (
                <option key={edition.slug} value={edition.slug}>
                  {edition.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Simulate from
            <select
              className="input"
              value={scenario.from ?? ""}
              onChange={(e) => update({ from: e.target.value || null, picks: {} })}
              disabled={!payload}
            >
              <option value="">The start (simulate everything)</option>
              {payload?.ruleset.stages.slice(1).map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name} (earlier stages real)
                </option>
              ))}
              {payload?.edition.live && <option value={NOW}>Now (every result so far real)</option>}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Seed
            <span className="flex gap-2">
              <input
                className="input w-full"
                value={scenario.seed}
                maxLength={64}
                onChange={(e) => e.target.value && update({ seed: e.target.value })}
              />
              <button type="button" className="btn" onClick={() => update({ seed: newSeed() })}>
                Reroll
              </button>
            </span>
          </label>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <button type="button" className="btn" onClick={saveScenario}>
              Save
            </button>
            <button type="button" className="btn" onClick={share}>
              Copy link
            </button>
            <button type="button" className="btn" onClick={exportScenario}>
              Export
            </button>
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
              Import
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              className="hidden"
              aria-label="Import scenario file"
              onChange={(e) => importScenario(e.target.files?.[0])}
            />
          </div>
        </div>
        <p className="text-sm text-muted" aria-live="polite">
          {notice}
        </p>
        {saved.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer">Saved in this browser ({saved.length})</summary>
            <ul className="mt-2 divide-y divide-border">
              {saved.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <button
                    type="button"
                    className="text-left font-medium hover:text-accent hover:underline"
                    onClick={() => openSaved(entry)}
                  >
                    {entry.name}
                  </button>
                  <span className="text-xs text-muted">
                    {new Date(entry.savedAt).toLocaleDateString("en", { dateStyle: "medium" })}
                  </span>
                  <button
                    type="button"
                    className="ml-auto text-xs text-muted hover:text-loss"
                    aria-label={`Remove “${entry.name}”`}
                    onClick={() => removeSaved(entry.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {loadError && <p role="alert">Couldn't load this edition's data ({loadError}).</p>}
      {!payload && !loadError && <p className="text-muted">Loading edition…</p>}

      {payload && single && (
        <>
          <section aria-labelledby="run" className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="run" className="text-2xl font-semibold tracking-tight">
                One simulated {payload.edition.name}
              </h2>
              <a className="link text-sm" href={payload.edition.path}>
                See what really happened
              </a>
            </div>
            {single.error ? (
              <p role="alert">This scenario can't be simulated: {single.error}</p>
            ) : (
              <>
                <p>
                  Simulated champion:{" "}
                  <strong data-testid="simulated-champion">{teamName(champion)}</strong>
                  <span className="text-muted">
                    {" "}
                    · Real champion:{" "}
                    {payload.edition.live && !realChampion
                      ? "not decided yet"
                      : teamName(realChampion)}
                  </span>
                </p>
                <p className="text-sm text-muted">
                  Click a team in any simulated match to make it win; later rounds update.{" "}
                  {appliedPicks} pick
                  {appliedPicks === 1 ? "" : "s"} applied.{" "}
                  {Object.keys(scenario.picks).length > 0 && (
                    <button type="button" className="link" onClick={() => update({ picks: {} })}>
                      Clear picks
                    </button>
                  )}
                </p>
                {single.stages.map((stage) => (
                  <StageBoard
                    key={stage.id}
                    stage={stage}
                    teams={payload.teams}
                    headingLevel={3}
                    showSource
                    onPick={pick}
                  />
                ))}
              </>
            )}
          </section>

          <section aria-labelledby="odds" className="space-y-4">
            <h2 id="odds" className="text-2xl font-semibold tracking-tight">
              Odds
            </h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                Simulations
                <select
                  className="input"
                  value={iterations}
                  onChange={(e) => setIterations(Number(e.target.value))}
                >
                  {ITERATIONS.map((n) => (
                    <option key={n} value={n}>
                      {n.toLocaleString("en")}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => montecarlo.run(payload, scenario, iterations)}
                disabled={montecarlo.state.status === "running"}
              >
                Run this scenario
              </button>
              {montecarlo.state.status === "running" && (
                <>
                  <progress
                    value={montecarlo.state.done}
                    max={montecarlo.state.total}
                    aria-label="Simulation progress"
                  />
                  <span data-testid="progress">
                    {montecarlo.state.done.toLocaleString("en")} /{" "}
                    {montecarlo.state.total.toLocaleString("en")}
                  </span>
                </>
              )}
            </div>
            {montecarlo.state.status === "error" && <p role="alert">{montecarlo.state.message}</p>}
            {montecarlo.state.status === "done" ? (
              <OddsTable
                result={montecarlo.state.result}
                payload={payload}
                ratings={ratings}
                caption={`This scenario, ${montecarlo.state.result.iterations.toLocaleString("en")} simulations (seed ${montecarlo.state.scenario.seed})`}
              />
            ) : payload.forecast ? (
              <OddsTable
                result={payload.forecast}
                payload={payload}
                ratings={payload.ratings}
                caption={`Live forecast: ${PRE_EVENT_ITERATIONS.toLocaleString("en")} simulations from every result so far, with Elo ratings from before the event`}
              />
            ) : (
              <OddsTable
                result={payload.preEvent}
                payload={payload}
                ratings={payload.ratings}
                caption={`Pre-event odds: ${PRE_EVENT_ITERATIONS.toLocaleString("en")} simulations with Elo ratings from before the event`}
              />
            )}
          </section>

          <section aria-labelledby="ratings" className="space-y-3">
            <h2 id="ratings" className="text-2xl font-semibold tracking-tight">
              Ratings
            </h2>
            <p className="text-sm text-muted">
              Game-level Elo from international games before this edition; teams without history
              start at their region's average. Change a rating to see how it shifts the odds.{" "}
              {Object.keys(scenario.ratings).length > 0 && (
                <button type="button" className="link" onClick={() => update({ ratings: {} })}>
                  Reset ratings
                </button>
              )}
            </p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {payload.participants.map(({ team }) => (
                <li key={team}>
                  <label className="card flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="truncate">{payload.teams[team]?.name ?? team}</span>
                    <input
                      type="number"
                      step={10}
                      min={0}
                      max={4000}
                      className="input w-20 px-1 text-right tabular-nums"
                      value={ratings[team] ?? ""}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        if (Number.isFinite(value) && value >= 0 && value <= 4000) {
                          update({ ratings: { ...scenario.ratings, [team]: value } });
                        }
                      }}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
