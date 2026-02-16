"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AddChoresDialog } from "@/components/add-chores-dialog";

type ChoreRow = {
  id: string;
  title: string;
  status: string;
  assigneeName: string;
  dueDate: string;
  coinValue: number;
};

type ChoresResponse = {
  chores: ChoreRow[];
};

export default function ChoresPage() {
  const [chores, setChores] = useState<ChoreRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [removingChoreId, setRemovingChoreId] = useState("");

  async function loadChores() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/chores", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `CHORES_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as ChoresResponse;
      setChores(payload.chores ?? []);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "chores_unavailable";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadChores();
  }, []);

  async function onRemoveChore(choreId: string) {
    if (removingChoreId) {
      return;
    }
    setRemovingChoreId(choreId);
    setError("");
    try {
      const response = await fetch(`/api/chores/${choreId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `REMOVE_CHORE_HTTP_${response.status}`);
      }
      await loadChores();
    } catch (removeError) {
      const message =
        removeError instanceof Error ? removeError.message : "remove_chore_failed";
      setError(message);
    } finally {
      setRemovingChoreId("");
    }
  }

  return (
    <div className="shell">
      <div className="container">
        <main className="panel family-page">
          <Link href="/" className="family-back-link">
            Back
          </Link>
          <h1>All Chores</h1>
          {isLoading ? <p className="small">Loading chores...</p> : null}
          {!isLoading && error ? (
            <p className="small family-error">Could not load chores: {error}</p>
          ) : null}
          {!isLoading && !error ? (
            <>
              {chores.length === 0 ? (
                <div className="flex flex-col gap-3">
                  <p className="small">No chores found.</p>
                  <div className="chores-empty-cta">
                    <AddChoresDialog onCreated={loadChores} />
                  </div>
                </div>
              ) : (
                <>
                  <p className="small family-page-subhead">
                    {chores.length} chore{chores.length === 1 ? "" : "s"}
                  </p>
                  <div className="family-table-wrap">
                    <table className="family-table">
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Status</th>
                          <th>Assignee</th>
                          <th>Due Date</th>
                          <th>Coins</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {chores.map((chore) => (
                          <tr key={chore.id}>
                            <td>{chore.title}</td>
                            <td>{chore.status}</td>
                            <td>{chore.assigneeName || "-"}</td>
                            <td>{chore.dueDate || "-"}</td>
                            <td>
                              <span className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600">
                                <span aria-hidden="true">🪙</span>
                                {chore.coinValue}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                title="Remove chore"
                                aria-label="Remove chore"
                                className="chore-remove-btn"
                                disabled={Boolean(removingChoreId)}
                                onClick={() => onRemoveChore(chore.id)}>
                                {removingChoreId === chore.id ? "…" : "×"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="chores-empty-cta chores-add-more-cta">
                    <AddChoresDialog triggerLabel="Add more chores" onCreated={loadChores} />
                  </div>
                </>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

