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
import { useRouter } from "next/navigation";
import { Alert } from "@/components/alert";
import Link from "next/link";
import { AppTabs, type AppTabItem } from "@/components/app-tabs";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { CoinIcon } from "@/components/coin-icon";
import { useLocale } from "@/components/locale-provider";
import { DiscoveryBadge } from "@/components/discovery-badge";
import { getSectionCount, markDiscoverySeen, useDiscoverySummary } from "@/lib/hooks/use-discovery";
import { MODAL_EXIT_MS, ModalShell } from "@/components/modal-shell";
import { TailwindSelect } from "@/components/tailwind-select";
import {
  dispatchConfettiSelectionChanged,
  triggerPartyConfetti,
} from "@/lib/confetti/party";
import {
  getStoreColorName,
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

const STORE_ACTION_TIMEOUT_MS = 12000;
const STORE_TAB_ORDER = ["family_awards", "customize_colors", "customize_avatar", "victory_confetti", "quest_items"];
const MODAL_HANDOFF_DELAY_MS = MODAL_EXIT_MS + 40;

type StoreSummaryResponse = {
  viewerUid: string;
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
  redemptionMembers?: Array<{
    id: string;
    uid: string;
    name: string;
    email: string;
    balance: number;
    availableRewardIds: string[];
  }>;
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
  const { t } = useLocale();
  const router = useRouter();
  const [summary, setSummary] = useState<StoreSummaryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [modalSearchQuery, setModalSearchQuery] = useState("");
  const [pendingOptionId, setPendingOptionId] = useState("");
  const [previewOptionId, setPreviewOptionId] = useState("");
  const [previewConfettiOptionId, setPreviewConfettiOptionId] = useState("");
  const [purchaseSuccess, setPurchaseSuccess] = useState<{
    category: StoreCategory;
    option: StoreOption;
    recipientMemberId?: string;
    recipientName?: string;
    consumed?: boolean;
  } | null>(null);
  const [rewardRedemption, setRewardRedemption] = useState<{
    category: StoreCategory;
    option: StoreOption;
  } | null>(null);
  const [redemptionMemberId, setRedemptionMemberId] = useState("");
  const [consumeReward, setConsumeReward] = useState(false);
  const previewActiveRef = useRef(false);
  const confettiPreviewResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistedThemeRef = useRef<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const deepLinkHandledRef = useRef(false);
  const lastConfettiPreviewAtRef = useRef(0);

  async function postStoreAction(body: Record<string, unknown>) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STORE_ACTION_TIMEOUT_MS);
    try {
      return await fetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function loadSummary(options?: { showLoading?: boolean; clearError?: boolean }) {
    const showLoading = options?.showLoading ?? true;
    const clearError = options?.clearError ?? true;
    if (showLoading) {
      setIsLoading(true);
    }
    if (clearError) {
      setError("");
    }
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
      if (showLoading) {
        setIsLoading(false);
      }
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
  const orderedCategories = useMemo(() => {
    if (!summary) {
      return [];
    }
    const orderIndex = new Map(STORE_TAB_ORDER.map((id, index) => [id, index]));
    return [...summary.categories].sort(
      (a, b) => (orderIndex.get(a.id) ?? 999) - (orderIndex.get(b.id) ?? 999),
    );
  }, [summary]);
  const selectedCategory = activeCategory ?? orderedCategories[0] ?? null;
  // Discovery (What's New) per-category counts so each store tab shows how many
  // new items it has.
  const { summary: discoverySummary } = useDiscoverySummary();
  const storeTabs = useMemo<AppTabItem<string>[]>(
    () =>
      orderedCategories.map((category) => {
        const labelText =
          {
            family_awards: t("store.tabs.family"),
            customize_colors: t("store.tabs.colors"),
            customize_avatar: t("store.tabs.avatar"),
            victory_confetti: t("store.tabs.confetti"),
            quest_items: t("store.tabs.quest"),
          }[category.id] ?? category.name;
        return {
          id: category.id,
          label: (
            <span className="store-tab-label">
              {labelText}
              <DiscoveryBadge count={getSectionCount(discoverySummary, `store:${category.id}`)} />
            </span>
          ),
        };
      }),
    [orderedCategories, t, discoverySummary],
  );
  const normalizedModalSearchQuery = modalSearchQuery.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!selectedCategory) {
      return [];
    }
    if (!normalizedModalSearchQuery) {
      return selectedCategory.options;
    }
    return selectedCategory.options.filter((option) => {
      const searchableText = [option.label, option.value, option.itemDescription]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchableText.includes(normalizedModalSearchQuery);
    });
  }, [selectedCategory, normalizedModalSearchQuery]);

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

  // Viewing a store category (the visible tab — which on first load is the
  // fallback-selected first category, before activeCategoryId is set) marks that
  // category's discovery section seen, clearing its tab badge. Keyed off the
  // effectively-selected category so the already-shown tab clears on load, not
  // only after an explicit click.
  const selectedCategoryId = selectedCategory?.id;
  useEffect(() => {
    if (selectedCategoryId) {
      void markDiscoverySeen([`store:${selectedCategoryId}`]);
    }
  }, [selectedCategoryId]);

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
    const now = Date.now();
    if (now - lastConfettiPreviewAtRef.current < 240) {
      return;
    }
    lastConfettiPreviewAtRef.current = now;
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
      const response = await postStoreAction(body);
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
      await loadSummary({ showLoading: false, clearError: false });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("profile-avatar:refresh"));
      }
    } catch (applyError) {
      setActionError(applyError instanceof Error ? applyError.message : "apply_failed");
    } finally {
      setPendingOptionId("");
    }
  }

  async function onPurchaseOption(
    category: StoreCategory,
    option: StoreOption,
    redemption?: { recipientMemberId: string; consumeReward: boolean },
  ) {
    if (!summary || pendingOptionId) {
      return;
    }
    const optionPrice = getOptionPrice(category, option);
    const recipient = redemption
      ? summary.redemptionMembers?.find((member) => member.id === redemption.recipientMemberId)
      : null;
    const purchaseBalance = recipient?.balance ?? summary.balance;
    if (purchaseBalance < optionPrice) {
      setActionError("insufficient_funds");
      return;
    }
    setPendingOptionId(option.id);
    setActionError("");
    try {
      const response = await postStoreAction({
        action: "purchase_option",
        categoryId: category.id,
        optionId: option.id,
        ...(redemption ?? {}),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `PURCHASE_OPTION_HTTP_${response.status}`);
      }
      await loadSummary({ showLoading: false, clearError: false });
      window.dispatchEvent(new Event("wallet:refresh"));
      window.dispatchEvent(new Event("profile-avatar:refresh"));
      const nextPurchaseSuccess = {
        category,
        option,
        recipientMemberId: recipient?.id,
        recipientName: recipient?.name,
        consumed: redemption?.consumeReward,
      };
      if (redemption) {
        setRewardRedemption(null);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, MODAL_HANDOFF_DELAY_MS);
        });
      }
      setPurchaseSuccess(nextPurchaseSuccess);
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
    try {
      const response = await postStoreAction({ action: "set_google_avatar" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `SET_GOOGLE_AVATAR_HTTP_${response.status}`);
      }
      await loadSummary({ showLoading: false, clearError: false });
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
    <main className="family-page store-page">
      {isLoading ? (
        <section aria-label={t("store.loading")} aria-hidden="true" className="space-y-3">
          <div className="store-grid">
            <article className="store-card">
              <div className="family-skeleton family-skeleton-reward" />
              <div className="family-skeleton family-skeleton-title mt-3" />
              <div className="family-skeleton family-skeleton-subtitle mt-2" />
              <div className="family-skeleton family-skeleton-button mt-3" />
            </article>
            <article className="store-card">
              <div className="family-skeleton family-skeleton-reward" />
              <div className="family-skeleton family-skeleton-title mt-3" />
              <div className="family-skeleton family-skeleton-subtitle mt-2" />
              <div className="family-skeleton family-skeleton-button mt-3" />
            </article>
            <article className="store-card">
              <div className="family-skeleton family-skeleton-reward" />
              <div className="family-skeleton family-skeleton-title mt-3" />
              <div className="family-skeleton family-skeleton-subtitle mt-2" />
              <div className="family-skeleton family-skeleton-button mt-3" />
            </article>
            <article className="store-card">
              <div className="family-skeleton family-skeleton-reward" />
              <div className="family-skeleton family-skeleton-title mt-3" />
              <div className="family-skeleton family-skeleton-subtitle mt-2" />
              <div className="family-skeleton family-skeleton-button mt-3" />
            </article>
          </div>
        </section>
      ) : null}
      {!isLoading && error ? <Alert>{t("store.loadError", { error })}</Alert> : null}
      {!isLoading && !error && summary ? (
        <>
          <section className="app-tab-panel">
            <div className="app-tab-panel-header px-5 pt-4">
              <AppTabs
                ariaLabel={t("nav.store")}
                tabs={storeTabs}
                activeTab={selectedCategory?.id ?? storeTabs[0]?.id ?? ""}
                onChange={(categoryId) => {
                  if (pendingOptionId) {
                    return;
                  }
                  clearPreview();
                  setPreviewConfettiOptionId("");
                  setModalSearchQuery("");
                  setActiveCategoryId(categoryId);
                  setActionError("");
                              }}
              />
            </div>

            {selectedCategory ? (
              <section className="app-tab-panel-body store-tab-panel p-5" role="tabpanel">
              <div className="store-tab-hero">
                <Image
                  src={selectedCategory.imagePath}
                  alt=""
                  width={640}
                  height={320}
                  loading={selectedCategory.imagePath === "/store3/avatar.png" ? "eager" : "lazy"}
                  priority={selectedCategory.imagePath === "/store3/avatar.png"}
                  className="store-tab-hero-image"
                />
                <div className="store-tab-hero-copy">
                  <h3>{selectedCategory.name}</h3>
                  <p>{selectedCategory.description}</p>
                  <p className="small">{t("store.balance", { coins: summary.balance })}</p>
                </div>
              </div>
              <section className="store-options-panel">
                <header className="store-options-panel-header">
                  <div className="store-options-search">
                    <input
                      type="search"
                      className="table-search-input w-full"
                      value={modalSearchQuery}
                      onChange={(event) => setModalSearchQuery(event.target.value)}
                      placeholder={t("store.searchPlaceholder", { category: selectedCategory.name.toLowerCase() })}
                      aria-label={t("store.searchLabel", { category: selectedCategory.name })}
                    />
                  </div>
                  {actionError ? <Alert className="mt-2">{t("store.updateError", { error: actionError })}</Alert> : null}
                </header>
                <div className="store-options-grid">
                  {selectedCategory.kind === "avatar" &&
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
                      <h4>{t("store.googleAvatar")}</h4>
                      <p className="small">{t("store.alwaysAvailable")}</p>
                      <Button
                        type="button"
                        className="btn btn-primary"
                        disabled={pendingOptionId.length > 0}
                        onClick={() => void onApplyGoogleAvatar()}>
                        {pendingOptionId === "google-avatar"
                          ? t("family.memberLanguageSaving")
                          : summary.avatarId
                            ? t("store.useGoogleAvatar")
                            : summary.avatarPhotoUrl
                              ? t("store.applied")
                              : t("store.useGoogleAvatar")}
                      </Button>
                    </article>
                  ) : null}
                  {selectedCategory.kind === "reward" && selectedCategory.options.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-left">
                      {summary.viewerRole === "admin" ? (
                        <div className="small space-y-2">
                          <p>{t("store.noFamilyAwards")}</p>
                          <p>
                            <Link href="/family" className="font-semibold text-sky-700 underline">
                              {t("store.manageRewards")}
                            </Link>
                          </p>
                        </div>
                      ) : (
                        <p className="small">
                          {t("store.noFamilyAwardsPlayer")}
                        </p>
                      )}
                    </div>
                  ) : null}
                  {selectedCategory.options.length > 0 && filteredOptions.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-left small">
                      {t("store.noItemsMatch", { query: modalSearchQuery.trim() })}
                    </div>
                  ) : null}
                  {filteredOptions.map((option) => {
                    const isRewardOption = selectedCategory.kind === "reward";
                    const rewardImage = isRewardOption ? findFamilyRewardImageOption(option.value) : null;
                    const optionPrice = getOptionPrice(selectedCategory, option);
                    const questItemQuantity = summary.questItemQuantities?.[option.id] ?? 0;
                    const questItemOwned = questItemQuantity > 0;
                    const owned = isRewardOption
                      ? false
                      : selectedCategory.kind === "quest_item"
                        ? questItemOwned
                        : ownedSet.has(option.id);
                    const isQuestUnlockOption =
                      selectedCategory.kind === "avatar" &&
                      option.isPurchasable === false &&
                      option.isUnlockable === true &&
                      option.unlockSource === "quest";
                    const applied = isRewardOption ? false : isOptionApplied(selectedCategory, option);
                    const canAfford = isRewardOption && summary.viewerRole === "admin"
                      ? (summary.redemptionMembers ?? []).some(
                          (member) => member.balance >= optionPrice && member.availableRewardIds.includes(option.id),
                        )
                      : summary.balance >= optionPrice;
                    const isDefaultConfettiOption =
                      selectedCategory.kind === "confetti" && option.isDefault === true;
                    const questItemCanBuy =
                      selectedCategory.kind === "quest_item" &&
                      (option.itemStackable === true || !questItemOwned);
                    const requiresPurchase = isRewardOption
                      ? true
                      : selectedCategory.kind === "quest_item"
                        ? questItemCanBuy
                        : isQuestUnlockOption
                          ? false
                        : !owned && !isDefaultConfettiOption;
                    const disabled =
                      pendingOptionId.length > 0 ||
                      (isQuestUnlockOption && !owned) ||
                      (requiresPurchase && !canAfford) ||
                      (selectedCategory.kind === "quest_item" && !questItemCanBuy);
                    const isPending = pendingOptionId === option.id;
                    const canThemePreview = selectedCategory.kind === "color" && Boolean(option.theme);
                    const canConfettiPreview = selectedCategory.kind === "confetti";
                    const previewing = previewOptionId === option.id;
                    const previewingConfetti = previewConfettiOptionId === option.id;
                    const isActiveThemeCard =
                      selectedCategory.kind === "color" && applied && !previewing;
                    const isPreviewThemeCard = selectedCategory.kind === "color" && previewing;
                    const primaryColor = option.theme?.primary ?? option.value;
                    const secondaryColor = option.theme?.secondary ?? primaryColor;
                    const tertiaryColor = option.theme?.tertiary ?? primaryColor;
                    const confettiColors = option.confetti?.colors ?? ["#94a3b8", "#64748b", "#cbd5e1"];
                    const confettiShapes = option.confetti?.shapes ?? ["rect", "circle", "streamer"];
                    const primaryTooltip = getStoreColorName(primaryColor);
                    const secondaryTooltip = getStoreColorName(secondaryColor);
                    const tertiaryTooltip = getStoreColorName(tertiaryColor);
                    return (
                      <article
                        key={option.id}
                        className={`store-option-card${
                          isActiveThemeCard ? " is-active" : ""
                        }${isPreviewThemeCard || previewingConfetti ? " is-previewing" : ""}`}>
                        <div className={`store-option-preview${selectedCategory.kind === "reward" ? " store-option-preview-reward" : ""}`}>
                          {selectedCategory.kind === "color" ? (
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
                          {selectedCategory.kind === "avatar" ? (
                            <Avatar
                              className="store-option-avatar"
                              size={72}
                              borderWidth={2}
                              name={option.label}
                              avatarId={option.value}
                              alt={option.label}
                            />
                          ) : null}
                          {selectedCategory.kind === "confetti" ? (
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
                                <span className="store-option-confetti-disabled-label">{t("store.disabled")}</span>
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
                          {selectedCategory.kind === "reward" ? (
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
                          {selectedCategory.kind === "quest_item" ? (
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
                              {previewing ? t("store.previewing") : t("store.preview")}
                            </Button>
                          ) : null}
                          {canConfettiPreview ? (
                            <Button
                              type="button"
                              className="btn btn-secondary store-preview-btn store-preview-btn-floating"
                              onClick={(event) => previewConfettiOption(option, event)}>
                              {previewingConfetti ? t("store.previewing") : t("store.preview")}
                            </Button>
                          ) : null}
                        </div>
                        <h4>{option.label}</h4>
                        {selectedCategory.kind === "quest_item" ? (
                          <p className="small">{option.itemDescription || t("store.usableInQuests")}</p>
                        ) : null}
                        <p className="small">
                          {isRewardOption ? (
                            <>
                              <CoinIcon size={14} /> {optionPrice} coins
                            </>
                          ) : selectedCategory.kind === "quest_item" ? (
                            <>
                              <CoinIcon size={14} /> {optionPrice} coins
                              {questItemQuantity > 0 ? ` - ${t("store.ownedQuantity", { count: questItemQuantity })}` : ""}
                            </>
                          ) : isQuestUnlockOption && !owned ? (
                            option.unlockLabel || t("store.questAward")
                          ) : owned || isDefaultConfettiOption ? (
                            t("store.owned")
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
                              if (summary.viewerRole === "admin") {
                                const eligibleMembers = (summary.redemptionMembers ?? []).filter(
                                  (member) => member.availableRewardIds.includes(option.id),
                                );
                                const viewerMember = eligibleMembers.find((member) => member.uid === summary.viewerUid);
                                setRedemptionMemberId((viewerMember ?? eligibleMembers[0])?.id ?? "");
                                setConsumeReward(false);
                                setActionError("");
                                setRewardRedemption({ category: selectedCategory, option });
                                return;
                              }
                              void onPurchaseOption(selectedCategory, option);
                              return;
                            }
                            if (selectedCategory.kind === "quest_item") {
                              if (questItemCanBuy) {
                                void onPurchaseOption(selectedCategory, option);
                              }
                              return;
                            }
                            if (isQuestUnlockOption && !owned) {
                              return;
                            }
                            if (owned || isDefaultConfettiOption) {
                              void applyOption(selectedCategory, option);
                              return;
                            }
                            void onPurchaseOption(selectedCategory, option);
                          }}>
                          {isRewardOption
                            ? isPending
                              ? t("store.redeeming")
                              : canAfford
                                ? t("store.redeem")
                                : t("store.notEnoughCoins")
                            : selectedCategory.kind === "quest_item"
                              ? isPending
                                ? t("store.buying")
                                : questItemCanBuy
                                  ? canAfford
                                    ? t("store.buy")
                                    : t("store.notEnoughCoins")
                                  : t("store.owned")
                            : isQuestUnlockOption && !owned
                              ? option.unlockLabel || t("store.questAward")
                            : isPending
                              ? t("family.memberLanguageSaving")
                              : owned
                                ? applied
                                  ? selectedCategory.kind === "color"
                                    ? t("store.themeActive")
                                    : selectedCategory.kind === "confetti" && isDefaultConfettiOption
                                      ? t("store.confettiOff")
                                    : t("store.applied")
                                  : selectedCategory.kind === "color"
                                    ? t("store.setTheme")
                                    : selectedCategory.kind === "confetti" && isDefaultConfettiOption
                                      ? t("store.disableConfetti")
                                    : t("store.apply")
                                : canAfford
                                  ? t("store.buy")
                                  : t("store.notEnoughCoins")}
                        </Button>
                      </article>
                    );
                  })}
                </div>
              </section>
              </section>
            ) : null}
          </section>

          <ModalShell
            open={Boolean(rewardRedemption)}
            onRequestClose={() => {
              if (!pendingOptionId) setRewardRedemption(null);
            }}>
            {rewardRedemption ? (() => {
              const { category, option } = rewardRedemption;
              const optionPrice = getOptionPrice(category, option);
              const rewardImage = findFamilyRewardImageOption(option.value);
              const members = (summary.redemptionMembers ?? []).filter(
                (member) => member.availableRewardIds.includes(option.id),
              );
              const selectedMember = members.find((member) => member.id === redemptionMemberId);
              const insufficientFunds = Boolean(selectedMember && selectedMember.balance < optionPrice);
              const submitDisabled = !selectedMember || insufficientFunds || pendingOptionId.length > 0;
              const disabledReason = !selectedMember
                ? t("store.rewardRecipientRequired")
                : insufficientFunds
                  ? t("store.rewardRecipientInsufficientFunds", { name: selectedMember.name })
                  : pendingOptionId
                    ? t("store.redeeming")
                    : "";
              return (
                <section className="family-modal-card max-w-lg" aria-labelledby="reward-redemption-title">
                  <div className="modal-dialog-title-row family-modal-title-row">
                    <div className="min-w-0">
                      <p className="eyebrow">{t("store.familyReward")}</p>
                      <h2 id="reward-redemption-title" className="family-modal-title break-words">
                        {t("store.redeemRewardTitle", { reward: option.label })}
                      </h2>
                    </div>
                    <span title={pendingOptionId ? t("store.redeeming") : undefined}>
                      <Button
                        type="button"
                        className="modal-close-button"
                        disabled={pendingOptionId.length > 0}
                        onClick={() => setRewardRedemption(null)}
                        aria-label={t("common.actions.close")}
                        title={pendingOptionId ? undefined : t("common.actions.close")}>
                        X
                      </Button>
                    </span>
                  </div>
                  <div className="space-y-5">
                    <div className="flex items-center gap-4 rounded-xl border border-sky-100 bg-sky-50 p-4">
                      <Image
                        src={rewardImage?.imagePath ?? "/rewards/screens.png"}
                        alt=""
                        width={80}
                        height={80}
                        className="h-20 w-20 shrink-0 rounded-lg object-contain"
                      />
                      <div className="min-w-0">
                        <p className="break-words font-bold text-slate-900">{option.label}</p>
                        <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-slate-600">
                          <CoinIcon size={16} /> {optionPrice} coins
                        </p>
                      </div>
                    </div>
                    <label className="block space-y-2">
                      <span className="font-semibold text-slate-800">{t("store.redeemFor")}</span>
                      <span
                        className="block"
                        title={pendingOptionId ? t("store.redeeming") : undefined}>
                        <TailwindSelect
                          ariaLabel={t("store.redeemFor")}
                          value={redemptionMemberId}
                          onChange={setRedemptionMemberId}
                          options={members.map((member) => ({
                            value: member.id,
                            label: t("store.rewardRecipientOption", { name: member.name, coins: member.balance }),
                          }))}
                          className="w-full"
                          buttonClassName="w-full"
                          disabled={pendingOptionId.length > 0}
                        />
                      </span>
                    </label>
                    <label
                      className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4${
                        pendingOptionId ? " cursor-not-allowed opacity-60" : " cursor-pointer"
                      }`}
                      title={pendingOptionId ? t("store.redeeming") : undefined}>
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4"
                        checked={consumeReward}
                        disabled={pendingOptionId.length > 0}
                        onChange={(event) => setConsumeReward(event.target.checked)}
                      />
                      <span>
                        <strong className="block text-slate-900">{t("store.consumeRewardNow")}</strong>
                        <span className="small">{t("store.consumeRewardNowHelp")}</span>
                      </span>
                    </label>
                    {actionError ? <Alert>{t("store.updateError", { error: actionError })}</Alert> : null}
                    {insufficientFunds && selectedMember ? (
                      <Alert>{t("store.rewardRecipientInsufficientFunds", { name: selectedMember.name })}</Alert>
                    ) : null}
                    <div className="family-modal-actions">
                      <span title={pendingOptionId ? t("store.redeeming") : undefined}>
                        <Button
                          type="button"
                          className="btn btn-secondary"
                          disabled={pendingOptionId.length > 0}
                          onClick={() => setRewardRedemption(null)}>
                          {t("common.cancel")}
                        </Button>
                      </span>
                      <span title={submitDisabled ? disabledReason : undefined}>
                        <Button
                          type="button"
                          className="btn btn-primary"
                          disabled={submitDisabled}
                          onClick={() => {
                            if (!selectedMember || submitDisabled) return;
                            void onPurchaseOption(category, option, {
                              recipientMemberId: selectedMember.id,
                              consumeReward,
                            });
                          }}>
                          {pendingOptionId ? t("store.redeeming") : t("store.confirmRedemption")}
                        </Button>
                      </span>
                    </div>
                  </div>
                </section>
              );
            })() : null}
          </ModalShell>

          <ModalShell
            open={Boolean(purchaseSuccess)}
            onRequestClose={() => {
              if (!pendingOptionId) {
                setPurchaseSuccess(null);
              }
            }}>
            {purchaseSuccess ? (() => {
              const { category, option, recipientMemberId, recipientName, consumed } = purchaseSuccess;
              const rewardImage = category.kind === "reward" ? findFamilyRewardImageOption(option.value) : null;
              const isAdmin = summary?.viewerRole === "admin";
              const primaryColor = option.theme?.primary ?? option.value;
              const secondaryColor = option.theme?.secondary ?? primaryColor;
              const tertiaryColor = option.theme?.tertiary ?? primaryColor;
              const confettiColors = option.confetti?.colors ?? ["#94a3b8", "#64748b", "#cbd5e1"];
              const confettiShapes = option.confetti?.shapes ?? ["rect", "circle", "streamer"];
              const destLabel =
                category.kind === "quest_item"
                  ? t("store.purchaseSuccessInventory")
                  : category.kind === "reward"
                    ? t("store.purchaseSuccessAwards")
                    : t("store.purchaseSuccessProfile");
              const destHref =
                category.kind === "quest_item"
                  ? "/profile?tab=inventory"
                  : category.kind === "reward" && recipientMemberId
                    ? `/family/${encodeURIComponent(recipientMemberId)}`
                  : "/profile";
              return (
                <section className="store-success-modal">
                  <div className="store-success-modal-header">
                    <h3>{t("store.purchaseSuccessTitle")}</h3>
                    <Button
                      type="button"
                      className="modal-close-button"
                      onClick={() => { if (!pendingOptionId) setPurchaseSuccess(null); }}
                      aria-label={t("common.actions.close")}
                      title={t("common.actions.close")}>
                      X
                    </Button>
                  </div>
                  <div className="store-success-preview">
                    {category.kind === "reward" ? (
                      <Image
                        src={rewardImage?.imagePath ?? "/rewards/screens.png"}
                        alt={option.label}
                        width={120}
                        height={120}
                        className="store-option-reward-image"
                      />
                    ) : category.kind === "quest_item" ? (
                      <Image
                        src={option.itemImage || "/assets/items/placeholder.png"}
                        alt={option.label}
                        width={96}
                        height={96}
                        className="store-option-reward-image"
                      />
                    ) : category.kind === "avatar" ? (
                      <Avatar
                        size={80}
                        borderWidth={2}
                        name={option.label}
                        avatarId={option.value}
                        alt={option.label}
                      />
                    ) : category.kind === "color" ? (
                      <div className="store-option-theme-preview">
                        <span
                          className="store-option-color"
                          style={{ backgroundColor: primaryColor }}
                          aria-hidden="true"
                        />
                        <span
                          className="store-option-color store-option-color-secondary"
                          style={{ backgroundColor: secondaryColor }}
                          aria-hidden="true"
                        />
                        <span
                          className="store-option-color store-option-color-tertiary"
                          style={{ backgroundColor: tertiaryColor }}
                          aria-hidden="true"
                        />
                      </div>
                    ) : category.kind === "confetti" ? (
                      <div
                        className="store-option-confetti-preview"
                        style={
                          {
                            "--confetti-color-a": confettiColors[0] ?? "#60a5fa",
                            "--confetti-color-b": confettiColors[1] ?? "#f97316",
                            width: "100%",
                          } as CSSProperties
                        }>
                        {Array.from({ length: 10 }, (_unused, chipIndex) => {
                          const chipShape = confettiShapes[chipIndex % confettiShapes.length] ?? "rect";
                          const chipColor = confettiColors[chipIndex % confettiColors.length] ?? "#60a5fa";
                          return (
                            <span
                              key={`success-chip-${chipIndex}`}
                              className={`store-option-confetti-chip${
                                chipShape === "circle" ? " store-option-confetti-chip-circle" : chipShape === "streamer" ? " store-option-confetti-chip-streamer" : ""
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
                        })}
                      </div>
                    ) : null}
                  </div>
                  {category.kind === "reward" && recipientName ? (
                    <p className="store-success-message">
                      <strong>{option.label}</strong>{" "}
                      {consumed
                        ? t("store.rewardRedeemedAndConsumedFor", { name: recipientName })
                        : t("store.rewardRedeemedFor", { name: recipientName })}
                      {!consumed ? <> <Link href={destHref}>{t("store.viewMemberAwards")}</Link>.</> : null}
                    </p>
                  ) : (
                    <p className="store-success-message">
                      <strong>{option.label}</strong>{" "}
                      {t("store.purchaseSuccessHasBeenAdded")}{" "}
                      <Link href={destHref}>{destLabel}</Link>.
                    </p>
                  )}
                  <div className="store-success-actions">
                    {category.kind === "quest_item" ? (
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => { router.push("/quests"); }}>
                        {t("store.purchaseSuccessBackToQuests")}
                      </Button>
                    ) : category.kind === "reward" && isAdmin && !consumed ? (
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => { router.push(destHref); }}>
                        {t("store.purchaseSuccessClaimNow")}
                      </Button>
                    ) : (category.kind === "color" || category.kind === "avatar" || category.kind === "confetti") ? (
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={pendingOptionId.length > 0}
                        onClick={async () => {
                          if (pendingOptionId) return;
                          await applyOption(category, option, true);
                          setPurchaseSuccess(null);
                        }}>
                        {pendingOptionId.length > 0 ? t("store.applying") : t("store.purchaseSuccessEquipNow")}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      className="btn btn-primary"
                      disabled={pendingOptionId.length > 0}
                      onClick={() => { if (!pendingOptionId) setPurchaseSuccess(null); }}>
                      {t("store.purchaseSuccessContinueShopping")}
                    </Button>
                  </div>
                </section>
              );
            })() : null}
          </ModalShell>
        </>
      ) : null}
    </main>
  );
}


