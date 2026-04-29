"use client";

import {
  type CSSProperties,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { Alert } from "@/components/alert";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { ModalShell } from "@/components/modal-shell";
import {
  dispatchConfettiSelectionChanged,
  triggerPartyConfetti,
} from "@/lib/confetti/party";
import {
  isAllowedDashboardColor,
  normalizeColor,
  type StoreCategory,
  type StoreOption,
} from "@/lib/store/catalog";
import {
  DEFAULT_THEME_PREFERENCE,
  applyThemePreference,
  dispatchThemeChanged,
  isThemePreference,
  type ThemePreference,
} from "@/lib/theme/preferences";
import { findFamilyRewardImageOption } from "@/lib/family/rewards";

type StoreSummaryResponse = {
  balance: number;
  ownedOptionIds: string[];
  questItemQuantities: Record<string, number>;
  dashboardPrimaryColor: string;
  themeOptionId: string;
  themePrimaryColor: string;
  themeSecondaryColor: string;
  themeTertiaryColor: string;
  avatarId: string;
  avatarPhotoUrl?: string;
  googlePhotoUrl?: string;
  selectedConfettiOptionId: string;
  viewerRole?: "admin" | "player";
  categories: StoreCategory[];
};

function toThemePreference(option: StoreOption) {
  if (!option.theme) {
    return null;
  }
  const preference = {
    optionId: option.id,
    primary: option.theme.primary,
    secondary: option.theme.secondary,
    tertiary: option.theme.tertiary,
  };
  return isThemePreference(preference) ? preference : null;
}

function getOptionPrice(category: StoreCategory, option: StoreOption) {
  return Math.max(0, Math.floor(option.price ?? category.price));
}

export function StorePageClient() {
  const [summary, setSummary] = useState<StoreSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [modalSearchQuery, setModalSearchQuery] = useState("");
  const [pendingOptionId, setPendingOptionId] = useState("");
  const [previewOptionId, setPreviewOptionId] = useState("");
  const [previewConfettiOptionId, setPreviewConfettiOptionId] = useState("");
  const previewActiveRef = useRef(false);
  const confettiPreviewResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistedThemeRef = useRef<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const deepLinkHandledRef = useRef(false);

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
  const normalizedModalSearchQuery = modalSearchQuery.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!activeCategory) {
      return [];
    }
    if (!normalizedModalSearchQuery) {
      return activeCategory.options;
    }
    return activeCategory.options.filter((option) => {
      const searchableText = [option.label, option.value, option.itemDescription]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchableText.includes(normalizedModalSearchQuery);
    });
  }, [activeCategory, normalizedModalSearchQuery]);

  const persistedThemePreference = useMemo(() => {
    if (!summary) {
      return DEFAULT_THEME_PREFERENCE;
    }
    const fromSummary = {
      optionId: summary.themeOptionId?.trim(),
      primary: summary.themePrimaryColor?.trim().toLowerCase(),
      secondary: summary.themeSecondaryColor?.trim().toLowerCase(),
      tertiary: summary.themeTertiaryColor?.trim().toLowerCase(),
    };
    if (isThemePreference(fromSummary)) {
      return fromSummary;
    }
    if (isAllowedDashboardColor(summary.dashboardPrimaryColor)) {
      const colorCategory = summary.categories.find((entry) => entry.id === "customize_colors");
      const matched =
        colorCategory?.options.find(
          (entry) => normalizeColor(entry.value) === normalizeColor(summary.dashboardPrimaryColor),
        ) ?? null;
      const fromOption = matched ? toThemePreference(matched) : null;
      if (fromOption) {
        return fromOption;
      }
    }
    return DEFAULT_THEME_PREFERENCE;
  }, [summary]);

  useEffect(() => {
    persistedThemeRef.current = persistedThemePreference;
  }, [persistedThemePreference]);

  useEffect(() => {
    if (!summary || deepLinkHandledRef.current) {
      return;
    }
    const categoryParam =
      typeof window === "undefined"
        ? ""
        : new URLSearchParams(window.location.search).get("category")?.trim() ?? "";
    if (!categoryParam) {
      deepLinkHandledRef.current = true;
      return;
    }
    const category = summary.categories.find((entry) => entry.id === categoryParam);
    if (!category) {
      deepLinkHandledRef.current = true;
      return;
    }
    setActiveCategoryId(category.id);
    deepLinkHandledRef.current = true;
  }, [summary]);

  const clearPreview = useCallback((nextPreference?: ThemePreference) => {
    if (!previewActiveRef.current) {
      return;
    }
    previewActiveRef.current = false;
    setPreviewOptionId("");
    applyThemePreference(nextPreference ?? persistedThemeRef.current);
  }, []);

  useEffect(() => {
    return () => {
      clearPreview();
      if (confettiPreviewResetRef.current) {
        clearTimeout(confettiPreviewResetRef.current);
      }
    };
  }, [clearPreview]);

  function previewThemeOption(option: StoreOption) {
    const preference = toThemePreference(option);
    if (!preference) {
      return;
    }
    previewActiveRef.current = true;
    setPreviewOptionId(option.id);
    applyThemePreference(preference);
  }

  function previewConfettiOption(
    option: StoreOption,
    event?: MouseEvent<HTMLElement>,
  ) {
    setPreviewConfettiOptionId(option.id);
    triggerPartyConfetti({
      optionId: option.id,
      intensity: 1.4,
      durationMs: 960,
      sourceClientX: event?.clientX,
      sourceClientY: event?.clientY,
    });
    if (confettiPreviewResetRef.current) {
      clearTimeout(confettiPreviewResetRef.current);
    }
    confettiPreviewResetRef.current = setTimeout(() => {
      setPreviewConfettiOptionId("");
    }, 980);
  }

  function isOptionApplied(category: StoreCategory, option: StoreOption) {
    if (!summary) {
      return false;
    }
    if (category.kind === "color") {
      if (summary.themeOptionId) {
        return summary.themeOptionId === option.id;
      }
      return normalizeColor(summary.dashboardPrimaryColor) === normalizeColor(option.value);
    }
    if (category.kind === "avatar") {
      return summary.avatarId === option.value;
    }
    if (category.kind === "confetti") {
      return summary.selectedConfettiOptionId === option.id;
    }
    return false;
  }

  async function applyOption(category: StoreCategory, option: StoreOption, bypassPending = false) {
    if (pendingOptionId && !bypassPending) {
      return;
    }
    setPendingOptionId(option.id);
    setActionError("");
    setActionSuccess("");
    try {
      if (category.kind === "reward") {
        return;
      }
      const body =
        category.kind === "color"
          ? { action: "set_theme", optionId: option.id }
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
      if (category.kind === "color") {
        const themePreference = toThemePreference(option);
        if (themePreference) {
          dispatchThemeChanged(themePreference);
          clearPreview(themePreference);
        } else {
          clearPreview();
        }
      } else if (category.kind === "confetti") {
        dispatchConfettiSelectionChanged(option.id);
      }
      await loadSummary();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("profile-avatar:refresh"));
      }
    } catch (applyError) {
      setActionError(applyError instanceof Error ? applyError.message : "apply_failed");
    } finally {
      setPendingOptionId("");
    }
  }

  async function onPurchaseOption(category: StoreCategory, option: StoreOption) {
    if (!summary || pendingOptionId) {
      return;
    }
    const optionPrice = getOptionPrice(category, option);
    if (summary.balance < optionPrice) {
      setActionError("insufficient_funds");
      return;
    }
    setPendingOptionId(option.id);
    setActionError("");
    setActionSuccess("");
    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "purchase_option",
          categoryId: category.id,
          optionId: option.id,
        }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `PURCHASE_OPTION_HTTP_${response.status}`);
      }
      await loadSummary();
      if (category.kind === "quest_item") {
        setActionSuccess(`${option.label} added to inventory`);
      }
      window.dispatchEvent(new Event("wallet:refresh"));
      window.dispatchEvent(new Event("profile-avatar:refresh"));
      if (
        category.kind === "color" &&
        option.theme &&
        typeof window !== "undefined" &&
        window.confirm("Purchase complete. Set this theme now?")
      ) {
        await applyOption(category, option, true);
      }
    } catch (purchaseError) {
      if (typeof window !== "undefined") {
        console.error("[STORE_PURCHASE_CLIENT_ERROR]", {
          categoryId: category.id,
          optionId: option.id,
          error: purchaseError instanceof Error ? purchaseError.message : "purchase_failed",
        });
      }
      setActionError(purchaseError instanceof Error ? purchaseError.message : "purchase_failed");
    } finally {
      setPendingOptionId("");
    }
  }

  async function onApplyGoogleAvatar() {
    if (!summary || pendingOptionId) {
      return;
    }
    setPendingOptionId("google-avatar");
    setActionError("");
    setActionSuccess("");
    try {
      const response = await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_google_avatar" }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `SET_GOOGLE_AVATAR_HTTP_${response.status}`);
      }
      await loadSummary();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("profile-avatar:refresh"));
      }
    } catch (applyError) {
      setActionError(applyError instanceof Error ? applyError.message : "apply_failed");
    } finally {
      setPendingOptionId("");
    }
  }

  return (
    <main className="panel family-page">
      <div className="page-header-row">
        <div className="page-header-inline">
          <BackLink className="page-back-link" fallbackHref="/" />
          <h1>Store</h1>
        </div>
      </div>
      {isLoading ? <p className="small">Loading store...</p> : null}
      {!isLoading && error ? <Alert>Could not load store: {error}</Alert> : null}
      {!isLoading && !error && summary ? (
        <>
          {actionError ? <Alert className="mb-3">Store update failed: {actionError}</Alert> : null}
          {actionSuccess && !activeCategory ? (
            <Alert tone="success" role="status" className="mb-3">
              {actionSuccess}
            </Alert>
          ) : null}
          <div className="store-grid">
            {summary.categories.map((category) => (
              <article key={category.id} className="store-card">
                <Image
                  src={category.imagePath}
                  alt=""
                  width={640}
                  height={320}
                  loading={category.imagePath === "/store3/avatar.png" ? "eager" : "lazy"}
                  priority={category.imagePath === "/store3/avatar.png"}
                  className="store-card-image"
                />
                <h3>{category.name}</h3>
                <p>{category.description}</p>
                <Button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setActionError("");
                    setModalSearchQuery("");
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
                clearPreview();
                setPreviewConfettiOptionId("");
                setModalSearchQuery("");
                setActiveCategoryId(null);
              }
            }}>
            {activeCategory ? (
              <section className="store-options-modal">
                <header className="store-options-modal-header">
                  <div className="store-options-modal-title-row modal-dialog-title-row">
                    <h3>{activeCategory.name}</h3>
                    <p className="small">Balance: {summary.balance} coins</p>
                    <Button
                      type="button"
                      className="modal-close-button"
                      onClick={() => {
                        if (!pendingOptionId) {
                          clearPreview();
                          setPreviewConfettiOptionId("");
                          setModalSearchQuery("");
                          setActiveCategoryId(null);
                        }
                      }}
                      aria-label="Close dialog"
                      title="Close dialog">
                      X
                    </Button>
                  </div>
                  <div className="store-options-search">
                    <input
                      type="search"
                      className="table-search-input w-full"
                      value={modalSearchQuery}
                      onChange={(event) => setModalSearchQuery(event.target.value)}
                      placeholder={`Search ${activeCategory.name.toLowerCase()}...`}
                      aria-label={`Search ${activeCategory.name}`}
                    />
                  </div>
                  {actionError ? <Alert className="mt-2">Store update failed: {actionError}</Alert> : null}
                  {actionSuccess ? (
                    <Alert tone="success" role="status" className="mt-2">
                      {actionSuccess}
                    </Alert>
                  ) : null}
                </header>
                <div className="store-options-grid">
                  {activeCategory.kind === "avatar" &&
                  summary.googlePhotoUrl &&
                  (!normalizedModalSearchQuery ||
                    "google avatar".includes(normalizedModalSearchQuery)) ? (
                    <article className="store-option-card">
                      <div className="store-option-preview">
                        <Avatar
                          className="store-option-avatar"
                          size={72}
                          borderWidth={2}
                          name="Google Avatar"
                          photoUrl={summary.googlePhotoUrl}
                          alt="Google avatar"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <h4>Google Avatar</h4>
                      <p className="small">Always available</p>
                      <Button
                        type="button"
                        className="btn btn-primary"
                        disabled={pendingOptionId.length > 0}
                        onClick={() => void onApplyGoogleAvatar()}>
                        {pendingOptionId === "google-avatar"
                          ? "Saving..."
                          : summary.avatarId
                            ? "Use Google avatar"
                            : summary.avatarPhotoUrl
                              ? "Applied"
                              : "Use Google avatar"}
                      </Button>
                    </article>
                  ) : null}
                  {activeCategory.kind === "reward" && activeCategory.options.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-left">
                      {summary.viewerRole === "admin" ? (
                        <div className="small space-y-2">
                          <p>No family awards are available right now.</p>
                          <p>
                            <Link href="/family" className="font-semibold text-sky-700 underline">
                              Manage rewards
                            </Link>
                          </p>
                        </div>
                      ) : (
                        <p className="small">
                          No family awards are available right now. Ask a parent or guardian to add
                          more rewards or raise the current limits.
                        </p>
                      )}
                    </div>
                  ) : null}
                  {activeCategory.options.length > 0 && filteredOptions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-left small">
                      No items match "{modalSearchQuery.trim()}".
                    </div>
                  ) : null}
                  {filteredOptions.map((option) => {
                    const isRewardOption = activeCategory.kind === "reward";
                    const rewardImage = isRewardOption ? findFamilyRewardImageOption(option.value) : null;
                    const optionPrice = getOptionPrice(activeCategory, option);
                    const questItemQuantity = summary.questItemQuantities?.[option.id] ?? 0;
                    const questItemOwned = questItemQuantity > 0;
                    const owned = isRewardOption
                      ? false
                      : activeCategory.kind === "quest_item"
                        ? questItemOwned
                        : ownedSet.has(option.id);
                    const applied = isRewardOption ? false : isOptionApplied(activeCategory, option);
                    const canAfford = summary.balance >= optionPrice;
                    const isDefaultConfettiOption =
                      activeCategory.kind === "confetti" && option.isDefault === true;
                    const questItemCanBuy =
                      activeCategory.kind === "quest_item" &&
                      (option.itemStackable === true || !questItemOwned);
                    const requiresPurchase = isRewardOption
                      ? true
                      : activeCategory.kind === "quest_item"
                        ? questItemCanBuy
                        : !owned && !isDefaultConfettiOption;
                    const disabled =
                      pendingOptionId.length > 0 ||
                      (requiresPurchase && !canAfford) ||
                      (activeCategory.kind === "quest_item" && !questItemCanBuy);
                    const isPending = pendingOptionId === option.id;
                    const canThemePreview = activeCategory.kind === "color" && Boolean(option.theme);
                    const canConfettiPreview = activeCategory.kind === "confetti";
                    const previewing = previewOptionId === option.id;
                    const previewingConfetti = previewConfettiOptionId === option.id;
                    const isActiveThemeCard =
                      activeCategory.kind === "color" && applied && !previewing;
                    const isPreviewThemeCard = activeCategory.kind === "color" && previewing;
                    const primaryColor = option.theme?.primary ?? option.value;
                    const secondaryColor = option.theme?.secondary ?? primaryColor;
                    const tertiaryColor = option.theme?.tertiary ?? primaryColor;
                    const confettiColors = option.confetti?.colors ?? ["#94a3b8", "#64748b", "#cbd5e1"];
                    const confettiShapes = option.confetti?.shapes ?? ["rect", "circle", "streamer"];
                    const primaryTooltip = `Primary: ${primaryColor.toUpperCase()}`;
                    const secondaryTooltip = `Secondary: ${secondaryColor.toUpperCase()}`;
                    const tertiaryTooltip = `Tertiary (Tiernary): ${tertiaryColor.toUpperCase()}`;
                    return (
                      <article
                        key={option.id}
                        className={`store-option-card${
                          isActiveThemeCard ? " is-active" : ""
                        }${isPreviewThemeCard || previewingConfetti ? " is-previewing" : ""}`}>
                        <div className={`store-option-preview${activeCategory.kind === "reward" ? " store-option-preview-reward" : ""}`}>
                          {activeCategory.kind === "color" ? (
                            <div className="store-option-theme-preview">
                              <span
                                className="store-option-color"
                                style={{ backgroundColor: primaryColor }}
                                title={primaryTooltip}
                                aria-label={primaryTooltip}
                              />
                              <span
                                className="store-option-color store-option-color-secondary"
                                style={{ backgroundColor: secondaryColor }}
                                title={secondaryTooltip}
                                aria-label={secondaryTooltip}
                              />
                              <span
                                className="store-option-color store-option-color-tertiary"
                                style={{ backgroundColor: tertiaryColor }}
                                title={tertiaryTooltip}
                                aria-label={tertiaryTooltip}
                              />
                            </div>
                          ) : null}
                          {activeCategory.kind === "avatar" ? (
                            <Avatar
                              className="store-option-avatar"
                              size={72}
                              borderWidth={2}
                              name={option.label}
                              avatarId={option.value}
                              alt={option.label}
                            />
                          ) : null}
                          {activeCategory.kind === "confetti" ? (
                            <div
                              className={`store-option-confetti-preview${
                                isDefaultConfettiOption ? " is-disabled" : ""
                              }`}
                              style={
                                {
                                  "--confetti-color-a": confettiColors[0] ?? "#60a5fa",
                                  "--confetti-color-b": confettiColors[1] ?? "#f97316",
                                } as CSSProperties
                              }>
                              {isDefaultConfettiOption ? (
                                <span className="store-option-confetti-disabled-label">
                                  Disabled
                                </span>
                              ) : (
                                Array.from({ length: 10 }, (_unused, chipIndex) => {
                                  const chipShape = confettiShapes[chipIndex % confettiShapes.length] ?? "rect";
                                  const chipColor = confettiColors[chipIndex % confettiColors.length] ?? "#60a5fa";
                                  return (
                                    <span
                                      key={`${option.id}-chip-${chipIndex}`}
                                      className={`store-option-confetti-chip ${
                                        chipShape === "circle"
                                          ? "store-option-confetti-chip-circle"
                                          : chipShape === "streamer"
                                            ? "store-option-confetti-chip-streamer"
                                            : ""
                                      }`}
                                      style={
                                        {
                                          left: `${10 + ((chipIndex * 9) % 80)}%`,
                                          top: `${14 + ((chipIndex * 17) % 64)}%`,
                                          "--chip-color": chipColor,
                                          animationDelay: `${(chipIndex % 5) * 70}ms`,
                                        } as CSSProperties
                                      }
                                    />
                                  );
                                })
                              )}
                            </div>
                          ) : null}
                          {activeCategory.kind === "reward" ? (
                            <div className="store-option-reward-image-wrap">
                              <Image
                                src={
                                  rewardImage?.imagePath ??
                                  "/rewards/screens.png"
                                }
                                alt={rewardImage?.label ?? option.label}
                                width={128}
                                height={128}
                                className="store-option-reward-image"
                              />
                            </div>
                          ) : null}
                          {activeCategory.kind === "quest_item" ? (
                            <div className="store-option-reward-image-wrap">
                              <Image
                                src={option.itemImage || "/assets/items/placeholder.png"}
                                alt={option.label}
                                width={96}
                                height={96}
                                className="store-option-reward-image"
                              />
                            </div>
                          ) : null}
                          {canThemePreview ? (
                            <Button
                              type="button"
                              className="btn btn-secondary store-preview-btn store-preview-btn-floating"
                              disabled={pendingOptionId.length > 0}
                              onClick={() => previewThemeOption(option)}>
                              {previewing ? "Previewing" : "Preview"}
                            </Button>
                          ) : null}
                          {canConfettiPreview ? (
                            <Button
                              type="button"
                              className="btn btn-secondary store-preview-btn store-preview-btn-floating"
                              onClick={(event) => previewConfettiOption(option, event)}>
                              {previewingConfetti ? "Previewing" : "Preview"}
                            </Button>
                          ) : null}
                        </div>
                        <h4>{option.label}</h4>
                        {activeCategory.kind === "quest_item" ? (
                          <p className="small">{option.itemDescription || "Usable in quests."}</p>
                        ) : null}
                        <p className="small">
                          {isRewardOption ? (
                            <>
                              <CoinIcon size={14} /> {optionPrice} coins
                            </>
                          ) : activeCategory.kind === "quest_item" ? (
                            <>
                              <CoinIcon size={14} /> {optionPrice} coins
                              {questItemQuantity > 0 ? ` - Owned: ${questItemQuantity}` : ""}
                            </>
                          ) : owned || isDefaultConfettiOption ? (
                            "Owned"
                          ) : (
                            <>
                              <CoinIcon size={14} /> {optionPrice} coins
                            </>
                          )}
                        </p>
                        <Button
                          type="button"
                          className="btn btn-primary"
                          disabled={disabled}
                          onClick={() => {
                            if (isRewardOption) {
                              void onPurchaseOption(activeCategory, option);
                              return;
                            }
                            if (activeCategory.kind === "quest_item") {
                              if (questItemCanBuy) {
                                void onPurchaseOption(activeCategory, option);
                              }
                              return;
                            }
                            if (owned || isDefaultConfettiOption) {
                              void applyOption(activeCategory, option);
                              return;
                            }
                            void onPurchaseOption(activeCategory, option);
                          }}>
                          {isRewardOption
                            ? isPending
                              ? "Redeeming..."
                              : canAfford
                                ? "Redeem"
                                : "Not enough coins"
                            : activeCategory.kind === "quest_item"
                              ? isPending
                                ? "Buying..."
                                : questItemCanBuy
                                  ? canAfford
                                    ? "Buy"
                                    : "Not enough coins"
                                  : "Owned"
                            : isPending
                              ? "Saving..."
                              : owned
                                ? applied
                                  ? activeCategory.kind === "color"
                                    ? "Theme active"
                                    : activeCategory.kind === "confetti" && isDefaultConfettiOption
                                      ? "Confetti off"
                                    : "Applied"
                                  : activeCategory.kind === "color"
                                    ? "Set theme"
                                    : activeCategory.kind === "confetti" && isDefaultConfettiOption
                                      ? "Disable confetti"
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
                    onClick={() => {
                      clearPreview();
                      setPreviewConfettiOptionId("");
                      setModalSearchQuery("");
                      setActiveCategoryId(null);
                    }}>
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


