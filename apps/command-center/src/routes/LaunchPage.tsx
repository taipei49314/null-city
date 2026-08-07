import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { restApi } from "../api/rest";
import { ApiError } from "../api/types";
import { useLocale } from "../i18n/LocaleContext";
import { DEFAULT_SCENARIO_ID, SCENARIO_TOPOLOGIES } from "../topology/registry";
import "./LaunchPage.css";

const DEFAULT_SEED = 49314;

export function LaunchPage() {
  const navigate = useNavigate();
  const { t, scenarioSummary, toggleLocale } = useLocale();
  const [scenarioId, setScenarioId] = useState(DEFAULT_SCENARIO_ID);
  const [seed, setSeed] = useState(String(DEFAULT_SEED));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const parsedSeed = Number(seed);
    if (!Number.isFinite(parsedSeed) || !Number.isInteger(parsedSeed)) {
      setError(t.seedInvalid);
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const created = await restApi.createSession({ scenarioId, seed: parsedSeed });
      navigate(`/session/${encodeURIComponent(created.sessionId)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`${err.code}: ${err.message}`);
      } else {
        setError(t.serverDown);
      }
      setStarting(false);
    }
  }

  return (
    <main className="launch nc-scanlines">
      <button type="button" className="nc-btn launch-locale-btn" onClick={toggleLocale} aria-label={t.localeToggle}>
        {t.localeToggle}
      </button>
      <div className="launch-content">
        <div className="launch-kicker">{t.kicker}</div>
        <h1 className="launch-title">NULL CITY</h1>
        <p className="launch-subtitle">{t.subtitle}</p>

        <form className="nc-panel launch-card" onSubmit={handleStart} aria-label={t.start}>
          <fieldset className="launch-field launch-scenario-picker">
            <legend>{t.scenario}</legend>
            {SCENARIO_TOPOLOGIES.map((topology) => (
              <label key={topology.scenarioId} className="launch-scenario-option">
                <input
                  type="radio"
                  name="scenario"
                  value={topology.scenarioId}
                  checked={scenarioId === topology.scenarioId}
                  onChange={() => setScenarioId(topology.scenarioId)}
                />
                <span className="launch-scenario-option-body">
                  <span className="launch-scenario-option-title">
                    <span className="launch-scenario-name">{topology.name}</span>
                    <span className="nc-tag nc-tag-amber">
                      {topology.districts.length} {t.districts}
                    </span>
                  </span>
                  <span className="launch-scenario-option-summary">{scenarioSummary(topology.scenarioId)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="launch-field">
            <label htmlFor="seed">{t.seed}</label>
            <input
              id="seed"
              name="seed"
              className="nc-input"
              inputMode="numeric"
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
              aria-describedby="seed-hint"
            />
            <span id="seed-hint" className="launch-footnote">
              {t.seedHint}
            </span>
          </div>

          {error && (
            <p className="launch-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="nc-btn nc-btn-primary launch-start-btn" disabled={starting}>
            {starting ? t.starting : t.start}
          </button>
        </form>

        <p className="launch-footnote">{t.localNote}</p>
      </div>
    </main>
  );
}
