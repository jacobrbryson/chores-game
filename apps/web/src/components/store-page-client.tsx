"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { ModalShell } from "@/components/modal-shell";
import {
  normalizeColor,
  type StoreCategory,
  type StoreCategoryId,
  type StoreOption,
} from "@/lib/store/catalog";

type StoreSummaryResponse = {
  balance: number;
  ownedOptionIds: string[];
  dashboardPrimaryColor: string;
  avatarId: string;
  selectedConfettiOptionId: string;
  categories: StoreCategory[];
};

export function StorePageClient() {
  const [summary, setSummary] = useState<StoreSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<StoreCategoryId | null>(null);
  const [pendingOptionId, setPendingOptionId] = useState("");

  async function loadSummary() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/store", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `STORE_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as StoreSummaryResponse;
      setSummary(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "store_unavailable");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  const ownedSet = useMemo(() => new Set(summary?.ownedOptionIds ?? []), [summary?.ownedOptionIds]);
  const activeCategory = useMemo(() => {
    if (!summary || !activeCategoryId) {
      return null;
    }
    return summary.categories.find((entry) => entry.id === activeCategoryId) ?? null;
  }, [activeCategoryId, summary]);

  function isOptionApplied(category: StoreCategory, option: StoreOption) {
    if (!summary) {
      return false;
    }
    if (category.kind === "color") {
      return normalizeColor(summary.dashboardPrimaryColor) === normalizeColor(option.value);
    }
    if (category.kind === "avatar") {
      return summary.avatarId === option.value;
    }
    return summary.selectedConfettiOptionId === option.id;
  }

  async function onPurchaseOption(categoryId: StoreCategoryId, optionId: string) {
    if (!summary || pendingOptionId) {
      return;
    }
    const category = summary.categories.find((entry) => entry.id === categoryId);
    if (!category) {
      return;
    }
    if (summary.balance < category.price) {
      setActionError("insufficient_funds");
      return;
    }
    setPendingOptionId(optionId);
    setActionError("");
    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purchase_option", categoryId, optionId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `PURCHASE_OPTION_HTTP_${response.status}`);
      }
      await loadSummary();
      window.dispatchEvent(new Event("wallet:refresh"));
    } catch (purchaseError) {
      setActionError(purchaseError instanceof Error ? purchaseError.message : "purchase_failed");
    } finally {
      setPendingOptionId("");
    }
  }

  async function onApplyOption(category: StoreCategory, option: StoreOption) {
    if (pendingOptionId) {
      return;
    }
    setPendingOptionId(option.id);
    setActionError("");
    try {
      const body =
        category.kind === "color"
          ? { action: "set_color", color: option.value }
          : category.kind === "avatar"
            ? { action: "set_avatar", avatarId: option.value }
            : { action: "set_confetti", optionId: option.id };
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `APPLY_OPTION_HTTP_${response.status}`);
      }
      await loadSummary();
    } catch (applyError) {
      setActionError(applyError instanceof Error ? applyError.message : "apply_failed");
    } finally {
      setPendingOptionId("");
    }
  }

  return (
    <main className="panel family-page">
      <BackLink />
      <h1>Store</h1>
      {isLoading ? <p className="small">Loading store...</p> : null}
      {!isLoading && error ? <p className="small family-error">Could not load store: {error}</p> : null}
      {!isLoading && !error && summary ? (
        <>
          {actionError ? <p className="small family-error mb-3">Store update failed: {actionError}</p> : null}
          <div className="store-grid">
            {summary.categories.map((category) => (
              <article key={category.id} className="store-card">
                <Image
                  src={category.imagePath}
                  alt=""
                  width={640}
                  height={320}
                  className="store-card-image"
                />
                <h3>{category.name}</h3>
                <p>{category.description}</p>
                <Button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setActionError("");
                    setActiveCategoryId(category.id);
                  }}>
                  View options
                </Button>
              </article>
            ))}
          </div>

          <ModalShell
            open={Boolean(activeCategory)}
            onRequestClose={() => {
              if (!pendingOptionId) {
                setActiveCategoryId(null);
              }
            }}>
            {activeCategory ? (
              <section className="store-options-modal">
                <header className="store-options-modal-header">
                  <h3>{activeCategory.name}</h3>
                  <p className="small">
                    {activeCategory.options.length} options · {activeCategory.price} coins each
                  </p>
                  <p className="small">Balance: {summary.balance} coins</p>
                </header>
                <div className="store-options-grid">
                  {activeCategory.options.map((option) => {
                    const owned = ownedSet.has(option.id);
                    const applied = isOptionApplied(activeCategory, option);
                    const canAfford = summary.balance >= activeCategory.price;
                    const disabled = pendingOptionId.length > 0 || (!owned && !canAfford);
                    const isPending = pendingOptionId === option.id;
                    return (
                      <article key={option.id} className="store-option-card">
                        <div className="store-option-preview">
                          {activeCategory.kind === "color" ? (
                            <span
                              className="store-option-color"
                              style={{ backgroundColor: option.value }}
                              aria-hidden
                            />
                          ) : null}
                          {activeCategory.kind === "avatar" ? (
                            <Image
                              src={`/avatars/default/${option.value}`}
                              alt={option.label}
                              width={72}
                              height={72}
                              className="store-option-avatar"
                            />
                          ) : null}
                          {activeCategory.kind === "confetti" ? (
                            <Image
                              src="/store/theme.png"
                              alt=""
                              width={96}
                              height={56}
                              className="store-option-confetti"
                            />
                          ) : null}
                        </div>
                        <h4>{option.label}</h4>
                        <p className="small">{owned ? "Owned" : `${activeCategory.price} coins`}</p>
                        <Button
                          type="button"
                          className="btn btn-primary"
                          disabled={disabled}
                          onClick={() => {
                            if (owned) {
                              void onApplyOption(activeCategory, option);
                              return;
                            }
                            void onPurchaseOption(activeCategory.id, option.id);
                          }}>
                          {isPending
                            ? "Saving..."
                            : owned
                              ? applied
                                ? "Applied"
                                : "Apply"
                              : canAfford
                                ? "Buy"
                                : "Not enough coins"}
                        </Button>
                      </article>
                    );
                  })}
                </div>
                <div className="store-options-actions">
                  <Button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pendingOptionId.length > 0}
                    onClick={() => setActiveCategoryId(null)}>
                    Close
                  </Button>
                </div>
              </section>
            ) : null}
          </ModalShell>
        </>
      ) : null}
    </main>
  );
}
