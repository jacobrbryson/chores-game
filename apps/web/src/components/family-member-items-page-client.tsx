"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/alert";
import { AppMenu } from "@/components/app-menu";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { MenuActionButton } from "@/components/menu-action-button";
import { ModalShell } from "@/components/modal-shell";

type FamilyMemberItemsPageClientProps = {
  memberId: string;
};

type OwnedItem = {
  id: string;
  name: string;
  description: string;
  image: string;
  category: string;
  quantity: number;
  source: "inventory" | "store_unlock";
  paidValue: number;
  acquisitionLabel: string;
};

type FamilyMemberItemsResponse = {
  member: {
    id: string;
    name: string;
  };
  viewerRole: "admin" | "player";
  ownedItems: OwnedItem[];
};

const NON_REMOVABLE_OWNED_ITEM_IDS = new Set(["confetti_option_01", "color_option_01"]);

function isOwnedItemRemovable(item: OwnedItem) {
  return !NON_REMOVABLE_OWNED_ITEM_IDS.has(item.id);
}

function toItemActionErrorMessage(error: string) {
  if (error === "default_option_locked") {
    return "Default starter options cannot be removed.";
  }
  if (error === "invalid_quantity") {
    return "Quantity must be a whole number greater than or equal to 0.";
  }
  return error;
}

function categoryTone(category: string) {
  const key = category.trim().toLowerCase();
  if (key.includes("confetti")) return "violet" as const;
  if (key.includes("avatar")) return "indigo" as const;
  if (key.includes("color")) return "teal" as const;
  if (key.includes("quest")) return "amber" as const;
  if (key.includes("reward")) return "rose" as const;
  if (key.includes("inventory")) return "green" as const;
  return "blue" as const;
}

function categoryChipStyle(category: string, active: boolean) {
  const key = category.trim().toLowerCase();
  let bg = "#eff6ff";
  let border = "#bfdbfe";
  let text = "#1e3a8a";
  if (key.includes("confetti")) {
    bg = "#f5f3ff";
    border = "#ddd6fe";
    text = "#5b21b6";
  } else if (key.includes("avatar")) {
    bg = "#eef2ff";
    border = "#c7d2fe";
    text = "#3730a3";
  } else if (key.includes("color")) {
    bg = "#f0fdfa";
    border = "#99f6e4";
    text = "#0f766e";
  } else if (key.includes("quest")) {
    bg = "#fffbeb";
    border = "#fde68a";
    text = "#92400e";
  } else if (key.includes("reward")) {
    bg = "#fff1f2";
    border = "#fecdd3";
    text = "#9f1239";
  } else if (key.includes("inventory")) {
    bg = "#f0fdf4";
    border = "#bbf7d0";
    text = "#166534";
  }
  return {
    backgroundColor: bg,
    borderColor: border,
    color: text,
    boxShadow: active ? `inset 0 0 0 2px ${text}` : "none",
  } as const;
}

export function FamilyMemberItemsPageClient({ memberId }: FamilyMemberItemsPageClientProps) {
  const [summary, setSummary] = useState<FamilyMemberItemsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [itemActionError, setItemActionError] = useState("");
  const [itemActionPendingId, setItemActionPendingId] = useState("");
  const [openItemMenuId, setOpenItemMenuId] = useState("");
  const [removeItemCandidate, setRemoveItemCandidate] = useState<OwnedItem | null>(null);
  const [editItemCandidate, setEditItemCandidate] = useState<OwnedItem | null>(null);
  const [editQuantityInput, setEditQuantityInput] = useState("");
  const [lockedRemoveInfoItemName, setLockedRemoveInfoItemName] = useState("");
  const [creditPaidValueOnRemove, setCreditPaidValueOnRemove] = useState(true);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState("");

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/family/members/${encodeURIComponent(memberId)}/profile`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `FAMILY_MEMBER_ITEMS_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as {
        member: { id: string; name: string };
        viewerRole: "admin" | "player";
        ownedItems: OwnedItem[];
      };
      setSummary(payload);
    } catch (errorValue) {
      setSummary(null);
      setError(errorValue instanceof Error ? errorValue.message : "member_items_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const category = new URLSearchParams(window.location.search).get("category")?.trim() ?? "";
    setActiveCategoryFilter(category);
  }, []);

  const ownedItems = useMemo(() => {
    const items = summary?.ownedItems ?? [];
    if (!activeCategoryFilter) {
      return items;
    }
    const normalized = activeCategoryFilter.toLowerCase();
    return items.filter((item) => item.category.trim().toLowerCase() === normalized);
  }, [summary?.ownedItems, activeCategoryFilter]);

  const categoryCounts = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const item of summary?.ownedItems ?? []) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + Math.max(0, item.quantity));
    }
    return Array.from(byCategory.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
  }, [summary?.ownedItems]);

  function setCategoryFilter(nextCategory: string) {
    setActiveCategoryFilter(nextCategory);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextCategory) {
        url.searchParams.set("category", nextCategory);
      } else {
        url.searchParams.delete("category");
      }
      window.history.replaceState({}, "", url.toString());
    }
  }

  function startEditOwnedItem(item: OwnedItem) {
    if (!summary || summary.viewerRole !== "admin" || itemActionPendingId) return;
    setOpenItemMenuId("");
    setEditItemCandidate(item);
    setEditQuantityInput(String(item.quantity));
  }

  function startRemoveOwnedItem(item: OwnedItem) {
    if (!summary || summary.viewerRole !== "admin" || itemActionPendingId) return;
    if (!isOwnedItemRemovable(item)) {
      setOpenItemMenuId("");
      setLockedRemoveInfoItemName(item.name);
      return;
    }
    setOpenItemMenuId("");
    setCreditPaidValueOnRemove(true);
    setRemoveItemCandidate(item);
  }

  async function onConfirmEditOwnedItem() {
    if (!editItemCandidate || !summary || summary.viewerRole !== "admin" || itemActionPendingId) return;
    const parsed = Number(editQuantityInput.trim());
    if (!Number.isFinite(parsed) || parsed < 0) {
      setItemActionError("invalid_quantity");
      return;
    }
    const quantity = Math.floor(parsed);
    setItemActionError("");
    setItemActionPendingId(editItemCandidate.id);
    try {
      const response = await fetch(
        `/api/family/members/${encodeURIComponent(memberId)}/owned-items/${encodeURIComponent(editItemCandidate.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `FAMILY_MEMBER_OWNED_ITEM_PATCH_HTTP_${response.status}`);
      }
      await loadSummary();
      setEditItemCandidate(null);
      setEditQuantityInput("");
    } catch (errorValue) {
      setItemActionError(errorValue instanceof Error ? errorValue.message : "owned_item_update_failed");
    } finally {
      setItemActionPendingId("");
    }
  }

  async function onConfirmRemoveOwnedItem() {
    if (!removeItemCandidate || !summary || summary.viewerRole !== "admin" || itemActionPendingId) return;
    setItemActionError("");
    setItemActionPendingId(removeItemCandidate.id);
    try {
      const response = await fetch(
        `/api/family/members/${encodeURIComponent(memberId)}/owned-items/${encodeURIComponent(removeItemCandidate.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ creditPaidValue: creditPaidValueOnRemove }),
        },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `FAMILY_MEMBER_OWNED_ITEM_DELETE_HTTP_${response.status}`);
      }
      await loadSummary();
      setRemoveItemCandidate(null);
    } catch (errorValue) {
      setItemActionError(errorValue instanceof Error ? errorValue.message : "owned_item_remove_failed");
    } finally {
      setItemActionPendingId("");
    }
  }

  return (
    <main className="panel family-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref={`/family/${encodeURIComponent(memberId)}`} />
          <h1>{summary?.member.name ? `${summary.member.name} Items` : "Owned Items"}</h1>
        </div>
      </div>
      <p className="small family-page-subhead">Full owned-items inventory for this family member.</p>
      {summary ? (
        <section className="family-page-card" aria-label="Items filters">
          <div className="family-category-chip-row items-filter-chip-row">
            <Button
              type="button"
              className="family-category-chip items-filter-chip"
              style={categoryChipStyle("all", activeCategoryFilter === "")}
              onClick={() => setCategoryFilter("")}>
              All Items ({summary.ownedItems.length})
            </Button>
            {categoryCounts.map(({ category, count }) => (
              <Button
                key={category}
                type="button"
                className="family-category-chip items-filter-chip"
                style={categoryChipStyle(category, activeCategoryFilter.trim().toLowerCase() === category.trim().toLowerCase())}
                onClick={() => setCategoryFilter(category)}>
                {humanizeEnum(category)} ({count})
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {isLoading ? (
        <>
          <section className="family-page-card" aria-label="Loading item filters" aria-hidden="true">
            <div className="family-skeleton-chip-row">
              <div className="family-skeleton family-skeleton-chip" />
              <div className="family-skeleton family-skeleton-chip" />
              <div className="family-skeleton family-skeleton-chip" />
              <div className="family-skeleton family-skeleton-chip" />
            </div>
          </section>
          <section className="family-page-card profile-owned-items-card" aria-label="Loading items" aria-hidden="true">
            <div className="family-page-card-header">
              <div className="family-skeleton family-skeleton-title" />
            </div>
            <div className="family-skeleton-stack">
              <div className="family-skeleton family-skeleton-row" />
              <div className="family-skeleton family-skeleton-row" />
              <div className="family-skeleton family-skeleton-row" />
              <div className="family-skeleton family-skeleton-row" />
            </div>
          </section>
        </>
      ) : null}
      {!isLoading && error ? <Alert>Could not load items: {error}</Alert> : null}

      {!isLoading && !error && summary ? (
        <section className="family-page-card profile-owned-items-card" aria-label="Owned items">
          {itemActionError ? <Alert>Could not update owned item: {toItemActionErrorMessage(itemActionError)}</Alert> : null}
          {ownedItems.length === 0 ? (
              <p className="small">No owned items{activeCategoryFilter ? " for this category" : ""} yet.</p>
          ) : (
            <>
            <div className="family-table-wrap items-table-desktop">
              <table className="family-table" aria-label="Owned items">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Source</th>
                    <th>Category</th>
                    <th>Quantity</th>
                    {summary.viewerRole === "admin" ? <th aria-label="Actions" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {ownedItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="table-assignee-cell">
                          <img
                            src={item.image || "/assets/items/placeholder.png"}
                            alt={item.name}
                            className="profile-owned-item-image"
                            onError={(event) => {
                              event.currentTarget.src = "/assets/items/placeholder.png";
                            }}
                          />
                          <div>
                            <div>{item.name}</div>
                            <div className="small">{item.description}</div>
                          </div>
                        </div>
                      </td>
                      <td>{item.source === "inventory" ? "Inventory" : "Store unlock"}</td>
                      <td>
                        <EnumChip label={humanizeEnum(item.category)} tone={categoryTone(item.category)} />
                      </td>
                      <td>{item.quantity}</td>
                      {summary.viewerRole === "admin" ? (
                        <td>
                          <AppMenu
                            open={openItemMenuId === item.id}
                            onOpenChange={(open) => setOpenItemMenuId(open ? item.id : "")}
                            trigger={
                              <span className="action-menu-dots" aria-hidden="true">
                                <span />
                                <span />
                                <span />
                              </span>
                            }
                            triggerClassName="btn btn-secondary member-action-btn"
                            triggerAriaLabel={`Manage ${item.name}`}
                            triggerTitle={`Manage ${item.name}`}
                            triggerDisabled={itemActionPendingId.length > 0}
                            panelClassName="app-menu-panel family-action-dropdown">
                            <MenuActionButton fullWidth onClick={() => startEditOwnedItem(item)} disabled={itemActionPendingId.length > 0}>
                              Edit
                            </MenuActionButton>
                            <MenuActionButton
                              fullWidth
                              className="menu-action-link-danger"
                              onClick={() => startRemoveOwnedItem(item)}
                              disabled={itemActionPendingId.length > 0}>
                              Remove
                            </MenuActionButton>
                          </AppMenu>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="items-mobile-cards">
              {ownedItems.map((item) => (
                <article key={`mobile-${item.id}`} className="family-member-card items-mobile-card">
                  <div className="family-member-card-head">
                    <div className="family-member-identity">
                      <img
                        src={item.image || "/assets/items/placeholder.png"}
                        alt={item.name}
                        className="profile-owned-item-image"
                        onError={(event) => {
                          event.currentTarget.src = "/assets/items/placeholder.png";
                        }}
                      />
                      <div>
                        <h3 className="family-member-name">{item.name}</h3>
                        <p className="family-member-email">{item.description}</p>
                      </div>
                    </div>
                    {summary.viewerRole === "admin" ? (
                      <AppMenu
                        open={openItemMenuId === `mobile:${item.id}`}
                        onOpenChange={(open) => setOpenItemMenuId(open ? `mobile:${item.id}` : "")}
                        wrapperClassName="items-mobile-card-menu"
                        trigger={
                          <span className="action-menu-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                        }
                        triggerClassName="btn btn-secondary member-action-btn"
                        triggerAriaLabel={`Manage ${item.name}`}
                        triggerTitle={`Manage ${item.name}`}
                        triggerDisabled={itemActionPendingId.length > 0}
                        panelClassName="app-menu-panel family-action-dropdown">
                        <MenuActionButton fullWidth onClick={() => startEditOwnedItem(item)} disabled={itemActionPendingId.length > 0}>
                          Edit
                        </MenuActionButton>
                        <MenuActionButton
                          fullWidth
                          className="menu-action-link-danger"
                          onClick={() => startRemoveOwnedItem(item)}
                          disabled={itemActionPendingId.length > 0}>
                          Remove
                        </MenuActionButton>
                      </AppMenu>
                    ) : null}
                  </div>
                  <div className="family-member-meta">
                    <div className="family-member-meta-item">
                      <span>Source</span>
                      <strong>{item.source === "inventory" ? "Inventory" : "Store unlock"}</strong>
                    </div>
                    <div className="family-member-meta-item">
                      <span>Category</span>
                      <EnumChip label={humanizeEnum(item.category)} tone={categoryTone(item.category)} />
                    </div>
                    <div className="family-member-meta-item">
                      <span>Quantity</span>
                      <strong>{item.quantity}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            </>
          )}
        </section>
      ) : null}

      <ModalShell
        open={Boolean(editItemCandidate)}
        onRequestClose={() => {
          if (!itemActionPendingId) {
            setEditItemCandidate(null);
            setEditQuantityInput("");
          }
        }}>
        {editItemCandidate ? (
          <section className="store-options-modal">
            <header className="store-options-modal-header">
              <div className="store-options-modal-title-row modal-dialog-title-row">
                <h3>Edit Owned Item</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => {
                    if (!itemActionPendingId) {
                      setEditItemCandidate(null);
                      setEditQuantityInput("");
                    }
                  }}
                  aria-label="Close dialog"
                  title="Close dialog">
                  X
                </Button>
              </div>
            </header>
            <p className="small">Set quantity for "{editItemCandidate.name}".</p>
            <label className="small" htmlFor="owned-item-quantity-input">Quantity</label>
            <input
              id="owned-item-quantity-input"
              type="number"
              min={0}
              step={1}
              className="table-search-input w-full"
              value={editQuantityInput}
              onChange={(event) => setEditQuantityInput(event.target.value)}
              disabled={itemActionPendingId.length > 0}
            />
            <div className="store-options-actions">
              <Button
                type="button"
                className="btn btn-secondary"
                disabled={itemActionPendingId.length > 0}
                onClick={() => {
                  setEditItemCandidate(null);
                  setEditQuantityInput("");
                }}>
                Cancel
              </Button>
              <Button type="button" className="btn btn-primary" disabled={itemActionPendingId.length > 0} onClick={() => void onConfirmEditOwnedItem()}>
                {itemActionPendingId === editItemCandidate.id ? "Saving..." : "Save"}
              </Button>
            </div>
          </section>
        ) : null}
      </ModalShell>

      <ModalShell
        open={Boolean(lockedRemoveInfoItemName)}
        onRequestClose={() => {
          if (!itemActionPendingId) {
            setLockedRemoveInfoItemName("");
          }
        }}>
        {lockedRemoveInfoItemName ? (
          <section className="store-options-modal">
            <header className="store-options-modal-header">
              <div className="store-options-modal-title-row modal-dialog-title-row">
                <h3>Item Locked</h3>
              </div>
            </header>
            <p className="small">"{lockedRemoveInfoItemName}" is a default item and cannot be removed.</p>
            <div className="store-options-actions">
              <Button type="button" className="btn btn-primary" onClick={() => setLockedRemoveInfoItemName("")}>
                OK
              </Button>
            </div>
          </section>
        ) : null}
      </ModalShell>

      <ModalShell
        open={Boolean(removeItemCandidate)}
        onRequestClose={() => {
          if (!itemActionPendingId) {
            setRemoveItemCandidate(null);
          }
        }}>
        {removeItemCandidate ? (
          <section className="store-options-modal">
            <header className="store-options-modal-header">
              <div className="store-options-modal-title-row modal-dialog-title-row">
                <h3>Remove Owned Item</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => {
                    if (!itemActionPendingId) {
                      setRemoveItemCandidate(null);
                    }
                  }}
                  aria-label="Close dialog"
                  title="Close dialog">
                  X
                </Button>
              </div>
            </header>
            <p className="small">Remove "{removeItemCandidate.name}" from this member&apos;s owned items?</p>
            <p className="small">{removeItemCandidate.acquisitionLabel}</p>
            <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
              <input
                type="checkbox"
                checked={creditPaidValueOnRemove}
                onChange={(event) => setCreditPaidValueOnRemove(event.target.checked)}
                disabled={itemActionPendingId.length > 0}
              />
              Credit paid value back ({removeItemCandidate.paidValue} coins)
            </label>
            <div className="store-options-actions">
              <Button type="button" className="btn btn-secondary" disabled={itemActionPendingId.length > 0} onClick={() => setRemoveItemCandidate(null)}>
                Cancel
              </Button>
              <Button type="button" className="btn btn-danger" disabled={itemActionPendingId.length > 0} onClick={() => void onConfirmRemoveOwnedItem()}>
                {itemActionPendingId === removeItemCandidate.id ? "Removing..." : "Remove"}
              </Button>
            </div>
          </section>
        ) : null}
      </ModalShell>
    </main>
  );
}
