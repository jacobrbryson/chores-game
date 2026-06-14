"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import {
  RESPONSIBILITY_PILLARS,
  RESPONSIBILITY_PILLAR_EMOJI,
  type ResponsibilityPillar,
} from "@/lib/responsibility/types";

type ResponsibilityConfig = {
  xpValues: {
    choreCompletionXp: number;
    routineStepXp: number;
    routineCompletionBonusXp: number;
    newSkillBonusXp: number;
  };
  levelThresholds: number[];
};

type ChoreSuggestion = {
  id: string;
  title: string;
  pillar: ResponsibilityPillar | "";
  minAge: number;
  maxAge: number;
  difficulty: "easy" | "medium" | "hard";
  estimatedMinutes: number;
  popularity: number;
  active: boolean;
};

type CommunityRoutine = {
  id: string;
  name: string;
  pillar: ResponsibilityPillar | "";
  steps: Array<{ id: string; title: string }>;
  minAge: number;
  maxAge: number;
  status: "pending" | "approved" | "rejected";
  featured: boolean;
};

type Analytics = {
  scannedEvents: number;
  scanCap: number;
  xpByPillar: Record<string, number>;
  eventsByType: Record<string, number>;
  choreCompletionsByPillar: Record<string, number>;
  mostCompletedRoutines: Array<{ routineId: string; completions: number }>;
  familyRoutines?: {
    total: number;
    active: number;
    byPillar: Record<string, number>;
    mostUsed: Array<{
      name: string;
      timesUsed: number;
      timesCompleted: number;
      completionRate: number;
    }>;
    assignments: {
      total: number;
      completed: number;
      active: number;
      abandoned: number;
      completionRate: number;
    };
  };
  communityLibrary: {
    total: number;
    byStatus: Record<string, number>;
    byPillar: Record<string, number>;
    featured: number;
  };
};

const PILLAR_LABELS: Record<ResponsibilityPillar, string> = {
  home_care: "Home Care",
  self_care: "Self Care",
  organization: "Organization",
  family_contribution: "Family Contribution",
  life_skills: "Life Skills",
};

function pillarLabel(pillar: ResponsibilityPillar | "" | "unassigned") {
  if (!pillar || pillar === "unassigned") {
    return "Unassigned";
  }
  return `${RESPONSIBILITY_PILLAR_EMOJI[pillar]} ${PILLAR_LABELS[pillar]}`;
}

export function SupportResponsibilityPanel() {
  return (
    <div className="flex flex-col gap-6">
      <PillarDefinitionsCard />
      <ConfigCard />
      <SuggestionsCard />
      <CommunityRoutinesCard />
      <AnalyticsCard />
    </div>
  );
}

function PillarDefinitionsCard() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900">Responsibility Pillars</h3>
      <p className="text-sm text-slate-500">
        Pillar identifiers are a stable part of the domain model (XP events and chore metadata
        reference them by id). Display names are localized in the locale files under
        <code className="mx-1 rounded bg-slate-100 px-1">responsibility.pillars.*</code>.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {RESPONSIBILITY_PILLARS.map((pillar) => (
          <li key={pillar} className="rounded-lg border border-slate-200 p-3">
            <p className="font-medium text-slate-800">{pillarLabel(pillar)}</p>
            <p className="text-xs text-slate-500">id: {pillar}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConfigCard() {
  const [config, setConfig] = useState<ResponsibilityConfig | null>(null);
  const [thresholdsText, setThresholdsText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/support/responsibility/config", { cache: "no-store" });
      const data = (await response.json()) as { config?: ResponsibilityConfig; error?: string };
      if (!response.ok || !data.config) {
        throw new Error(data.error || "Config unavailable");
      }
      setConfig(data.config);
      setThresholdsText(data.config.levelThresholds.join(", "));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Config unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!config) return;
    const thresholds = thresholdsText
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value));
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/support/responsibility/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config.xpValues, levelThresholds: thresholds }),
      });
      const data = (await response.json()) as { config?: ResponsibilityConfig; error?: string };
      if (!response.ok || !data.config) {
        throw new Error(data.error || "Save failed");
      }
      setConfig(data.config);
      setThresholdsText(data.config.levelThresholds.join(", "));
      setNotice("Configuration saved. New values apply within a minute.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function setXp(key: keyof ResponsibilityConfig["xpValues"], raw: string) {
    const value = Number(raw);
    setConfig((current) =>
      current
        ? {
            ...current,
            xpValues: {
              ...current.xpValues,
              [key]: Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0,
            },
          }
        : current,
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900">XP Configuration</h3>
      <p className="text-sm text-slate-500">
        Tunes XP awards and level thresholds platform-wide. Stored at appConfig/responsibility;
        missing values fall back to code defaults.
      </p>
      {error ? <Alert className="mt-2">{error}</Alert> : null}
      {notice ? <Alert tone="success" className="mt-2">{notice}</Alert> : null}
      {config ? (
        <form onSubmit={save} className="mt-3 flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["choreCompletionXp", "Chore completion XP"],
                ["routineStepXp", "Routine step XP"],
                ["routineCompletionBonusXp", "Routine completion bonus XP"],
                ["newSkillBonusXp", "New Skill Bonus XP"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-700">{label}</span>
                <input
                  type="number"
                  min={0}
                  value={config.xpValues[key]}
                  onChange={(event) => setXp(key, event.target.value)}
                  className="h-10 rounded-md border border-slate-300 px-3 text-slate-800"
                />
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">
              Level thresholds (comma-separated cumulative XP, must start at 0 and ascend)
            </span>
            <input
              type="text"
              value={thresholdsText}
              onChange={(event) => setThresholdsText(event.target.value)}
              className="h-10 rounded-md border border-slate-300 px-3 text-slate-800"
            />
            <span className="text-xs text-slate-500">
              Levels beyond the list continue using the gap between the last two thresholds.
            </span>
          </label>
          <div>
            <Button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save configuration"}
            </Button>
          </div>
        </form>
      ) : !error ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : null}
    </section>
  );
}

function SuggestionsCard() {
  const [suggestions, setSuggestions] = useState<ChoreSuggestion[]>([]);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [pillar, setPillar] = useState<ResponsibilityPillar | "">("");
  const [minAge, setMinAge] = useState("4");
  const [maxAge, setMaxAge] = useState("18");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [estimatedMinutes, setEstimatedMinutes] = useState("10");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/support/responsibility/suggestions", {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        suggestions?: ChoreSuggestion[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Suggestions unavailable");
      }
      setSuggestions(data.suggestions ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Suggestions unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/support/responsibility/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          pillar,
          minAge: Number(minAge),
          maxAge: Number(maxAge),
          difficulty,
          estimatedMinutes: Number(estimatedMinutes),
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Create failed");
      }
      setTitle("");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(suggestion: ChoreSuggestion) {
    await fetch(`/api/support/responsibility/suggestions/${suggestion.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !suggestion.active }),
    });
    await load();
  }

  async function remove(suggestion: ChoreSuggestion) {
    if (!window.confirm(`Delete suggestion "${suggestion.title}"?`)) {
      return;
    }
    await fetch(`/api/support/responsibility/suggestions/${suggestion.id}`, {
      method: "DELETE",
    });
    await load();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900">Suggested Chores</h3>
      <p className="text-sm text-slate-500">
        Curated catalog behind future age/pillar recommendations and SEO content pages.
      </p>
      {error ? <Alert className="mt-2">{error}</Alert> : null}

      <form onSubmit={create} className="mt-3 grid gap-2 sm:grid-cols-6">
        <input
          type="text"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Chore title"
          className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-800 sm:col-span-2"
        />
        <select
          value={pillar}
          onChange={(event) => setPillar(event.target.value as ResponsibilityPillar | "")}
          className="h-10 rounded-md border border-slate-300 px-2 text-sm text-slate-800">
          <option value="">No pillar</option>
          {RESPONSIBILITY_PILLARS.map((entry) => (
            <option key={entry} value={entry}>
              {pillarLabel(entry)}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={0}
          max={18}
          value={minAge}
          onChange={(event) => setMinAge(event.target.value)}
          title="Min age"
          className="h-10 rounded-md border border-slate-300 px-2 text-sm text-slate-800"
        />
        <input
          type="number"
          min={0}
          max={18}
          value={maxAge}
          onChange={(event) => setMaxAge(event.target.value)}
          title="Max age"
          className="h-10 rounded-md border border-slate-300 px-2 text-sm text-slate-800"
        />
        <div className="flex gap-2">
          <select
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value as "easy" | "medium" | "hard")}
            className="h-10 flex-1 rounded-md border border-slate-300 px-2 text-sm text-slate-800">
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <input
            type="number"
            min={0}
            value={estimatedMinutes}
            onChange={(event) => setEstimatedMinutes(event.target.value)}
            title="Estimated minutes"
            className="h-10 w-20 rounded-md border border-slate-300 px-2 text-sm text-slate-800"
          />
        </div>
        <Button type="submit" className="btn btn-primary sm:col-span-6 sm:justify-self-start" disabled={busy}>
          Add suggestion
        </Button>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-3">Title</th>
              <th className="py-2 pr-3">Pillar</th>
              <th className="py-2 pr-3">Ages</th>
              <th className="py-2 pr-3">Difficulty</th>
              <th className="py-2 pr-3">Minutes</th>
              <th className="py-2 pr-3">Popularity</th>
              <th className="py-2 pr-3">Active</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {suggestions.map((suggestion) => (
              <tr key={suggestion.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 text-slate-800">{suggestion.title}</td>
                <td className="py-2 pr-3">{pillarLabel(suggestion.pillar)}</td>
                <td className="py-2 pr-3">
                  {suggestion.minAge}–{suggestion.maxAge}
                </td>
                <td className="py-2 pr-3 capitalize">{suggestion.difficulty}</td>
                <td className="py-2 pr-3">{suggestion.estimatedMinutes || "—"}</td>
                <td className="py-2 pr-3">{suggestion.popularity}</td>
                <td className="py-2 pr-3">{suggestion.active ? "Yes" : "No"}</td>
                <td className="py-2 text-right">
                  <Button
                    className="btn btn-secondary btn-sm mr-2"
                    onClick={() => void toggleActive(suggestion)}>
                    {suggestion.active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button className="btn btn-secondary btn-sm" onClick={() => void remove(suggestion)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
            {suggestions.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-3 text-slate-500">
                  No suggestions yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CommunityRoutinesCard() {
  const [routines, setRoutines] = useState<CommunityRoutine[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [pillar, setPillar] = useState<ResponsibilityPillar | "">("");
  const [stepsText, setStepsText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/support/responsibility/community-routines", {
        cache: "no-store",
      });
      const data = (await response.json()) as {
        routines?: CommunityRoutine[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Community routines unavailable");
      }
      setRoutines(data.routines ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Community routines unavailable",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const steps = stepsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((title, index) => ({ id: `step_${index + 1}`, title }));
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/support/responsibility/community-routines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, pillar, steps, status: "approved" }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Create failed");
      }
      setName("");
      setStepsText("");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function patch(routine: CommunityRoutine, patchBody: Record<string, unknown>) {
    await fetch(`/api/support/responsibility/community-routines/${routine.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    await load();
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900">Community Routine Library</h3>
      <p className="text-sm text-slate-500">
        Approve, feature, and categorize shared routines. Parent publishing is not exposed yet;
        seed the library here.
      </p>
      {error ? <Alert className="mt-2">{error}</Alert> : null}

      <form onSubmit={create} className="mt-3 grid gap-2 sm:grid-cols-3">
        <input
          type="text"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Routine name"
          className="h-10 rounded-md border border-slate-300 px-3 text-sm text-slate-800"
        />
        <select
          value={pillar}
          onChange={(event) => setPillar(event.target.value as ResponsibilityPillar | "")}
          className="h-10 rounded-md border border-slate-300 px-2 text-sm text-slate-800">
          <option value="">No pillar</option>
          {RESPONSIBILITY_PILLARS.map((entry) => (
            <option key={entry} value={entry}>
              {pillarLabel(entry)}
            </option>
          ))}
        </select>
        <textarea
          required
          value={stepsText}
          onChange={(event) => setStepsText(event.target.value)}
          placeholder={"One step per line\nClear table\nLoad dishwasher"}
          rows={3}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 sm:col-span-3"
        />
        <Button type="submit" className="btn btn-primary sm:justify-self-start" disabled={busy}>
          Add approved routine
        </Button>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Pillar</th>
              <th className="py-2 pr-3">Steps</th>
              <th className="py-2 pr-3">Ages</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Featured</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {routines.map((routine) => (
              <tr key={routine.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 text-slate-800">{routine.name}</td>
                <td className="py-2 pr-3">{pillarLabel(routine.pillar)}</td>
                <td className="py-2 pr-3">{routine.steps.length}</td>
                <td className="py-2 pr-3">
                  {routine.minAge}–{routine.maxAge}
                </td>
                <td className="py-2 pr-3 capitalize">{routine.status}</td>
                <td className="py-2 pr-3">{routine.featured ? "★" : "—"}</td>
                <td className="py-2 text-right">
                  {routine.status !== "approved" ? (
                    <Button
                      className="btn btn-secondary btn-sm mr-2"
                      onClick={() => void patch(routine, { status: "approved" })}>
                      Approve
                    </Button>
                  ) : (
                    <Button
                      className="btn btn-secondary btn-sm mr-2"
                      onClick={() => void patch(routine, { featured: !routine.featured })}>
                      {routine.featured ? "Unfeature" : "Feature"}
                    </Button>
                  )}
                  {routine.status === "pending" ? (
                    <Button
                      className="btn btn-secondary btn-sm"
                      onClick={() => void patch(routine, { status: "rejected" })}>
                      Reject
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {routines.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-3 text-slate-500">
                  No community routines yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AnalyticsCard() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch("/api/support/responsibility/analytics", {
          cache: "no-store",
        });
        const data = (await response.json()) as { analytics?: Analytics; error?: string };
        if (!response.ok || !data.analytics) {
          throw new Error(data.error || "Analytics unavailable");
        }
        setAnalytics(data.analytics);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Analytics unavailable");
      }
    }
    void load();
  }, []);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900">Analytics</h3>
      <p className="text-sm text-slate-500">
        Aggregated from the most recent XP events across all families (capped scan). Age-based
        distribution arrives once player ages are captured.
      </p>
      {error ? <Alert className="mt-2">{error}</Alert> : null}
      {analytics ? (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <h4 className="text-sm font-semibold text-slate-700">XP by pillar</h4>
            <ul className="mt-1 text-sm text-slate-600">
              {Object.entries(analytics.xpByPillar).map(([pillar, xp]) => (
                <li key={pillar} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{pillarLabel(pillar as ResponsibilityPillar)}</span>
                  <span>{xp} XP</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-700">Events by type</h4>
            <ul className="mt-1 text-sm text-slate-600">
              {Object.entries(analytics.eventsByType).map(([type, count]) => (
                <li key={type} className="flex justify-between border-b border-slate-100 py-1">
                  <span>{type}</span>
                  <span>{count}</span>
                </li>
              ))}
              {Object.keys(analytics.eventsByType).length === 0 ? (
                <li className="py-1 text-slate-500">No XP events yet.</li>
              ) : null}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-700">Most completed routines</h4>
            <ul className="mt-1 text-sm text-slate-600">
              {analytics.mostCompletedRoutines.map((entry) => (
                <li
                  key={entry.routineId}
                  className="flex justify-between border-b border-slate-100 py-1">
                  <span className="truncate">{entry.routineId}</span>
                  <span>{entry.completions}</span>
                </li>
              ))}
              {analytics.mostCompletedRoutines.length === 0 ? (
                <li className="py-1 text-slate-500">No routine completions yet.</li>
              ) : null}
            </ul>
          </div>
          {analytics.familyRoutines ? (
            <div>
              <h4 className="text-sm font-semibold text-slate-700">Family routines</h4>
              <ul className="mt-1 text-sm text-slate-600">
                <li className="flex justify-between border-b border-slate-100 py-1">
                  <span>Total routines</span>
                  <span>{analytics.familyRoutines.total}</span>
                </li>
                <li className="flex justify-between border-b border-slate-100 py-1">
                  <span>Active</span>
                  <span>{analytics.familyRoutines.active}</span>
                </li>
                <li className="flex justify-between border-b border-slate-100 py-1">
                  <span>Assignments (completed / total)</span>
                  <span>
                    {analytics.familyRoutines.assignments.completed} /{" "}
                    {analytics.familyRoutines.assignments.total}
                  </span>
                </li>
                <li className="flex justify-between border-b border-slate-100 py-1">
                  <span>Completion rate</span>
                  <span>
                    {Math.round(analytics.familyRoutines.assignments.completionRate * 100)}%
                  </span>
                </li>
                <li className="flex justify-between border-b border-slate-100 py-1">
                  <span>Abandoned (&gt;14 days active)</span>
                  <span>{analytics.familyRoutines.assignments.abandoned}</span>
                </li>
                {Object.entries(analytics.familyRoutines.byPillar).map(([pillar, count]) => (
                  <li key={pillar} className="flex justify-between border-b border-slate-100 py-1">
                    <span>{pillarLabel(pillar as ResponsibilityPillar)}</span>
                    <span>{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {analytics.familyRoutines && analytics.familyRoutines.mostUsed.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-slate-700">Most used routines</h4>
              <ul className="mt-1 text-sm text-slate-600">
                {analytics.familyRoutines.mostUsed.map((entry) => (
                  <li
                    key={entry.name}
                    className="flex justify-between gap-2 border-b border-slate-100 py-1">
                    <span className="truncate">{entry.name}</span>
                    <span className="shrink-0">
                      {entry.timesUsed} used · {Math.round(entry.completionRate * 100)}% done
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div>
            <h4 className="text-sm font-semibold text-slate-700">Community library</h4>
            <ul className="mt-1 text-sm text-slate-600">
              <li className="flex justify-between border-b border-slate-100 py-1">
                <span>Total routines</span>
                <span>{analytics.communityLibrary.total}</span>
              </li>
              <li className="flex justify-between border-b border-slate-100 py-1">
                <span>Featured</span>
                <span>{analytics.communityLibrary.featured}</span>
              </li>
              {Object.entries(analytics.communityLibrary.byStatus).map(([status, count]) => (
                <li key={status} className="flex justify-between border-b border-slate-100 py-1">
                  <span className="capitalize">{status}</span>
                  <span>{count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : !error ? (
        <p className="mt-2 text-sm text-slate-500">Loading…</p>
      ) : null}
    </section>
  );
}
