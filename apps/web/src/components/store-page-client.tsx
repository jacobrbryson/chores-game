"use client";

import { useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import type { StoreItem } from "@/lib/store/catalog";

type StoreSummaryResponse = {
  balance: number;
  ownedItemIds: string[];
  dashboardPrimaryColor: string;
  avatarId: string;
  unavailableColors: string[];
  catalog: StoreItem[];
  avatarOptions: string[];
};

export function StorePageClient() {
  const [summary, setSummary] = useState<StoreSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingItemId, setPendingItemId] = useState("");
  const [selectedColor, setSelectedColor] = useState("#1f78d1");
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [actionError, setActionError] = useState("");

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
      setSelectedColor(payload.dashboardPrimaryColor || "#1f78d1");
      setSelectedAvatarId(payload.avatarId || payload.avatarOptions?.[0] || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "store_unavailable");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  const ownedSet = useMemo(() => new Set(summary?.ownedItemIds ?? []), [summary?.ownedItemIds]);

  async function onPurchase(itemId: string) {
    if (pendingItemId) {
      return;
    }
    setPendingItemId(itemId);
    setActionError("");
    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "purchase", itemId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `PURCHASE_HTTP_${response.status}`);
      }
      await loadSummary();
      window.dispatchEvent(new Event("wallet:refresh"));
    } catch (purchaseError) {
      setActionError(purchaseError instanceof Error ? purchaseError.message : "purchase_failed");
    } finally {
      setPendingItemId("");
    }
  }

  async function onSaveColor() {
    setActionError("");
    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_color", color: selectedColor }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `SET_COLOR_HTTP_${response.status}`);
      }
      await loadSummary();
    } catch (saveError) {
      setActionError(saveError instanceof Error ? saveError.message : "set_color_failed");
    }
  }

  async function onSaveAvatar() {
    setActionError("");
    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_avatar", avatarId: selectedAvatarId }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `SET_AVATAR_HTTP_${response.status}`);
      }
      await loadSummary();
    } catch (saveError) {
      setActionError(saveError instanceof Error ? saveError.message : "set_avatar_failed");
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
          <p className="small family-page-subhead">
            Balance: <strong>{summary.balance}</strong> coins
          </p>
          {actionError ? <p className="small family-error mb-3">Store update failed: {actionError}</p> : null}
          <div className="store-grid">
            {summary.catalog.map((item) => {
              const owned = ownedSet.has(item.id);
              return (
                <article key={item.id} className="store-card">
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                  <p className="store-price">{item.price} coins</p>
                  <Button
                    type="button"
                    className="btn btn-secondary"
                    disabled={owned || Boolean(pendingItemId) || summary.balance < item.price}
                    onClick={() => onPurchase(item.id)}>
                    {owned ? "Owned" : pendingItemId === item.id ? "Buying..." : "Buy"}
                  </Button>
                </article>
              );
            })}
          </div>
          {ownedSet.has("customize_colors") ? (
            <section className="store-section">
              <h3>Dashboard Color</h3>
              <p className="small">
                Choose your dashboard color. Colors already used by family members are blocked.
              </p>
              <div className="store-color-row">
                <input
                  type="color"
                  value={selectedColor}
                  onChange={(event) => setSelectedColor(event.target.value)}
                  className="store-color-input"
                />
                <Button
                  type="button"
                  className="btn btn-primary"
                  disabled={(summary.unavailableColors ?? []).includes(selectedColor.toLowerCase())}
                  onClick={onSaveColor}>
                  Save color
                </Button>
              </div>
            </section>
          ) : null}
          {ownedSet.has("customize_avatar") ? (
            <section className="store-section">
              <h3>Avatar</h3>
              <p className="small">Default avatar files should be uploaded to `public/avatars/default`.</p>
              <div className="store-avatar-grid">
                {summary.avatarOptions.map((avatarOption) => (
                  <label key={avatarOption} className="store-avatar-option">
                    <input
                      type="radio"
                      name="avatarId"
                      checked={selectedAvatarId === avatarOption}
                      onChange={() => setSelectedAvatarId(avatarOption)}
                    />
                    <span>{avatarOption}</span>
                  </label>
                ))}
              </div>
              <Button type="button" className="btn btn-primary mt-3" onClick={onSaveAvatar}>
                Save avatar
              </Button>
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
