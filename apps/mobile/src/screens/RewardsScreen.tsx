import React, { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  fetchMobileStoreState,
  postMobileStoreAction,
  toAppAssetUrl,
  type MobileStoreCategory,
  type MobileStoreOption,
  type MobileStoreState,
} from "@/lib/api";
import { colors, radius, spacing, typography } from "@/theme";
import { AppScreen, AvatarBadge, Button, Card, CoinPill, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

const STORE_CATEGORY_ORDER = ["family_awards", "customize_colors", "customize_avatar", "victory_confetti", "quest_items"];
const STORE_CATEGORY_LABELS: Record<string, string> = {
  family_awards: "Family",
  customize_colors: "Colors",
  customize_avatar: "Avatars",
  victory_confetti: "Confetti",
  quest_items: "Quests",
};

const FAMILY_REWARD_IMAGE_PATHS: Record<string, string> = {
  screen_time: "/rewards/screens.png",
  ice_cream: "/rewards/icecream.png",
  candy: "/rewards/candy.png",
  soda: "/rewards/sodas.png",
  zoo_trip: "/rewards/zoo.png",
  museum_trip: "/rewards/museum.png",
  vacation: "/rewards/vacation.png",
  movie_night: "/rewards/movie.png",
  sleepover: "/custom.png",
};

type Props = {
  right?: React.ReactNode;
  onGoDashboard?: () => void;
  onStoreUpdated?: () => void;
};

function getOptionPrice(category: MobileStoreCategory, option: MobileStoreOption) {
  return Math.max(0, Math.floor(option.price ?? category.price));
}

function getRewardImageUrl(option: MobileStoreOption) {
  return toAppAssetUrl(FAMILY_REWARD_IMAGE_PATHS[option.value] ?? "/rewards/screens.png");
}

function getQuestItemImageUrl(option: MobileStoreOption) {
  return toAppAssetUrl(option.itemImage || "/assets/items/placeholder.png");
}

function isOptionApplied(store: MobileStoreState, category: MobileStoreCategory, option: MobileStoreOption) {
  if (category.kind === "color") {
    return store.themeOptionId === option.id;
  }
  if (category.kind === "avatar") {
    return store.avatarId === option.value;
  }
  if (category.kind === "confetti") {
    return store.selectedConfettiOptionId === option.id;
  }
  return false;
}

function getActionLabel(input: {
  store: MobileStoreState;
  category: MobileStoreCategory;
  option: MobileStoreOption;
  pendingOptionId: string;
}) {
  const { store, category, option, pendingOptionId } = input;
  const isPending = pendingOptionId === option.id;
  const optionPrice = getOptionPrice(category, option);
  const canAfford = store.balance >= optionPrice;
  const ownedSet = new Set(store.ownedOptionIds);
  const owned = category.kind === "reward"
    ? false
    : category.kind === "quest_item"
      ? (store.questItemQuantities[option.id] ?? 0) > 0
      : ownedSet.has(option.id);
  const applied = isOptionApplied(store, category, option);
  const isQuestUnlockOption =
    category.kind === "avatar" &&
    option.isPurchasable === false &&
    option.isUnlockable === true &&
    option.unlockSource === "quest";
  const isDefaultConfettiOption = category.kind === "confetti" && option.isDefault === true;
  const questItemCanBuy =
    category.kind === "quest_item" &&
    (option.itemStackable === true || (store.questItemQuantities[option.id] ?? 0) === 0);

  if (category.kind === "reward") {
    if (isPending) return "Redeeming...";
    return canAfford ? "Redeem" : "Not enough coins";
  }
  if (category.kind === "quest_item") {
    if (isPending) return "Buying...";
    if (!questItemCanBuy) return "Owned";
    return canAfford ? "Buy" : "Not enough coins";
  }
  if (isQuestUnlockOption && !owned) {
    return option.unlockLabel || "Quest Award";
  }
  if (isPending) {
    return "Saving...";
  }
  if (owned || isDefaultConfettiOption) {
    if (applied) {
      return category.kind === "color" ? "Theme active" : "Applied";
    }
    if (category.kind === "color") {
      return "Set theme";
    }
    if (category.kind === "confetti" && isDefaultConfettiOption) {
      return "Disable confetti";
    }
    return "Apply";
  }
  return canAfford ? "Buy" : "Not enough coins";
}

export function RewardsScreen({ right, onGoDashboard, onStoreUpdated }: Props) {
  const [store, setStore] = useState<MobileStoreState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [pendingOptionId, setPendingOptionId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  async function loadStore(showLoading = true) {
    if (showLoading) {
      setLoading(true);
    }
    try {
      const nextStore = await fetchMobileStoreState();
      setStore(nextStore);
      setError("");
      setSelectedCategoryId((current) => {
        if (current && nextStore.categories.some((category) => category.id === current)) {
          return current;
        }
        const ordered = [...nextStore.categories].sort(
          (a, b) => STORE_CATEGORY_ORDER.indexOf(a.id) - STORE_CATEGORY_ORDER.indexOf(b.id),
        );
        return ordered[0]?.id ?? "";
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "store_unavailable");
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    void loadStore();
  }, []);

  const orderedCategories = useMemo(() => {
    if (!store) {
      return [];
    }
    return [...store.categories].sort(
      (a, b) => STORE_CATEGORY_ORDER.indexOf(a.id) - STORE_CATEGORY_ORDER.indexOf(b.id),
    );
  }, [store]);

  const selectedCategory = useMemo(() => {
    if (!orderedCategories.length) {
      return null;
    }
    return orderedCategories.find((category) => category.id === selectedCategoryId) ?? orderedCategories[0];
  }, [orderedCategories, selectedCategoryId]);

  async function runStoreAction(
    optionId: string,
    action: () => Promise<void>,
    successMessage?: string,
  ) {
    setPendingOptionId(optionId);
    setActionError("");
    setActionSuccess("");
    try {
      await action();
      await loadStore(false);
      if (successMessage) {
        setActionSuccess(successMessage);
      }
      onStoreUpdated?.();
    } catch (storeActionError) {
      setActionError(storeActionError instanceof Error ? storeActionError.message : "store_update_failed");
    } finally {
      setPendingOptionId("");
    }
  }

  async function handleOptionPress(category: MobileStoreCategory, option: MobileStoreOption) {
    if (!store || pendingOptionId) {
      return;
    }

    const ownedSet = new Set(store.ownedOptionIds);
    const optionPrice = getOptionPrice(category, option);
    const canAfford = store.balance >= optionPrice;
    const isRewardOption = category.kind === "reward";
    const isQuestUnlockOption =
      category.kind === "avatar" &&
      option.isPurchasable === false &&
      option.isUnlockable === true &&
      option.unlockSource === "quest";
    const isDefaultConfettiOption = category.kind === "confetti" && option.isDefault === true;
    const questItemQuantity = store.questItemQuantities[option.id] ?? 0;
    const questItemCanBuy = category.kind === "quest_item" && (option.itemStackable === true || questItemQuantity === 0);
    const owned =
      category.kind === "quest_item"
        ? questItemQuantity > 0
        : isDefaultConfettiOption || ownedSet.has(option.id);

    if (isQuestUnlockOption && !ownedSet.has(option.id)) {
      return;
    }

    if (isRewardOption) {
      if (!canAfford) {
        setActionError("insufficient_funds");
        return;
      }
      await runStoreAction(option.id, async () => {
        await postMobileStoreAction({
          action: "purchase_option",
          categoryId: category.id,
          optionId: option.id,
        });
      }, `${option.label} redeemed`);
      return;
    }

    if (category.kind === "quest_item") {
      if (!questItemCanBuy) {
        return;
      }
      if (!canAfford) {
        setActionError("insufficient_funds");
        return;
      }
      await runStoreAction(option.id, async () => {
        await postMobileStoreAction({
          action: "purchase_option",
          categoryId: category.id,
          optionId: option.id,
        });
      }, `${option.label} added to your quest inventory`);
      return;
    }

    if (owned) {
      const actionBody =
        category.kind === "color"
          ? { action: "set_theme", optionId: option.id }
          : category.kind === "avatar"
            ? { action: "set_avatar", avatarId: option.value }
            : { action: "set_confetti", optionId: option.id };
      await runStoreAction(option.id, async () => {
        await postMobileStoreAction(actionBody);
      }, category.kind === "color" ? `${option.label} is now active` : `${option.label} applied`);
      return;
    }

    if (!canAfford) {
      setActionError("insufficient_funds");
      return;
    }

    await runStoreAction(option.id, async () => {
      await postMobileStoreAction({
        action: "purchase_option",
        categoryId: category.id,
        optionId: option.id,
      });
    }, `${option.label} purchased`);
  }

  async function handleGoogleAvatarPress() {
    await runStoreAction("google-avatar", async () => {
      await postMobileStoreAction({ action: "set_google_avatar" });
    }, "Google avatar applied");
  }

  return (
    <AppScreen title="Store" subtitle="Colors, avatars, confetti, and quest gear" right={right} onPressBreadcrumbRoot={onGoDashboard}>
      {loading ? <LoadingState label="Loading store..." /> : null}
      {error ? <ErrorState message={`Could not load store: ${error}`} /> : null}
      {!loading && !error && store ? (
        <>
          <Card>
            <View style={styles.topRow}>
              <SectionHeader title="Store Categories" />
              <CoinPill value={store.balance} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
              {orderedCategories.map((category) => {
                const active = selectedCategory?.id === category.id;
                return (
                  <Button
                    key={category.id}
                    label={STORE_CATEGORY_LABELS[category.id] ?? category.name}
                    variant={active ? "primary" : "secondary"}
                    onPress={() => {
                      setSelectedCategoryId(category.id);
                      setActionError("");
                      setActionSuccess("");
                    }}
                  />
                );
              })}
            </ScrollView>
          </Card>

          {selectedCategory ? (
            <Card>
              <Image source={{ uri: toAppAssetUrl(selectedCategory.imagePath) }} style={styles.heroImage} />
              <View style={styles.categoryHeader}>
                <Text style={styles.categoryTitle}>{selectedCategory.name}</Text>
                <Text style={styles.categoryDescription}>{selectedCategory.description}</Text>
              </View>
              {actionError ? <ErrorState message={`Store update failed: ${actionError}`} /> : null}
              {actionSuccess ? <Text style={styles.successText}>{actionSuccess}</Text> : null}
              {selectedCategory.kind === "reward" && selectedCategory.options.length === 0 ? (
                <EmptyState
                  message={
                    store.viewerRole === "admin"
                      ? "No family rewards yet. Add them from the Family screen."
                      : "No family rewards are available right now."
                  }
                />
              ) : (
                <View style={styles.optionGrid}>
                  {selectedCategory.kind === "avatar" && store.googlePhotoUrl ? (
                    <View style={styles.optionCard}>
                      <View style={styles.avatarPreviewWrap}>
                        <AvatarBadge name="Google Avatar" imageUrl={store.googlePhotoUrl} size={72} />
                      </View>
                      <Text style={styles.optionTitle}>Google Avatar</Text>
                      <Text style={styles.optionMeta}>Always available</Text>
                      <Button
                        label={pendingOptionId === "google-avatar" ? "Saving..." : "Use Google avatar"}
                        disabled={pendingOptionId.length > 0}
                        onPress={() => void handleGoogleAvatarPress()}
                      />
                    </View>
                  ) : null}
                  {selectedCategory.options.map((option) => {
                    const actionLabel = getActionLabel({ store, category: selectedCategory, option, pendingOptionId });
                    const optionPrice = getOptionPrice(selectedCategory, option);
                    const questCount = store.questItemQuantities[option.id] ?? 0;
                    const isQuestUnlockOption =
                      selectedCategory.kind === "avatar" &&
                      option.isPurchasable === false &&
                      option.isUnlockable === true &&
                      option.unlockSource === "quest";
                    const isApplied = isOptionApplied(store, selectedCategory, option);
                    const isDisabled =
                      pendingOptionId.length > 0 ||
                      (selectedCategory.kind === "quest_item" && option.itemStackable !== true && questCount > 0) ||
                      (isQuestUnlockOption && !store.ownedOptionIds.includes(option.id)) ||
                      (selectedCategory.kind !== "reward" && selectedCategory.kind !== "quest_item" && !store.ownedOptionIds.includes(option.id) && !option.isDefault && store.balance < optionPrice);

                    return (
                      <View key={option.id} style={[styles.optionCard, isApplied ? styles.optionCardActive : null]}>
                        {selectedCategory.kind === "color" ? (
                          <View style={styles.themePreview}>
                            <View style={[styles.colorChip, { backgroundColor: option.theme?.primary || store.themePrimaryColor || colors.brand }]} />
                            <View style={[styles.colorChip, { backgroundColor: option.theme?.secondary || store.themeSecondaryColor || colors.accent }]} />
                            <View style={[styles.colorChip, { backgroundColor: option.theme?.tertiary || store.themeTertiaryColor || colors.text }]} />
                          </View>
                        ) : null}
                        {selectedCategory.kind === "avatar" ? (
                          <View style={styles.avatarPreviewWrap}>
                            <AvatarBadge
                              name={option.label}
                              imageUrl={toAppAssetUrl(`/avatars/default/${encodeURIComponent(option.value)}`)}
                              size={72}
                            />
                          </View>
                        ) : null}
                        {selectedCategory.kind === "confetti" ? (
                          <View style={styles.confettiPreview}>
                            {(option.confetti?.colors ?? [colors.accent, colors.brand, colors.coin]).slice(0, 6).map((color, index) => (
                              <View
                                key={`${option.id}-${index}`}
                                style={[
                                  styles.confettiChip,
                                  index % 3 === 0 ? styles.confettiStreamer : null,
                                  { backgroundColor: color },
                                ]}
                              />
                            ))}
                          </View>
                        ) : null}
                        {selectedCategory.kind === "reward" ? (
                          <Image source={{ uri: getRewardImageUrl(option) }} style={styles.optionImage} />
                        ) : null}
                        {selectedCategory.kind === "quest_item" ? (
                          <Image source={{ uri: getQuestItemImageUrl(option) }} style={styles.optionImage} />
                        ) : null}
                        <Text style={styles.optionTitle}>{option.label}</Text>
                        <Text style={styles.optionMeta}>
                          {selectedCategory.kind === "quest_item"
                            ? option.itemDescription || "Usable in quests."
                            : selectedCategory.kind === "reward"
                              ? `${optionPrice} coins`
                              : selectedCategory.kind === "color" && option.theme
                                ? `${option.theme.primary.toUpperCase()} / ${option.theme.secondary.toUpperCase()}`
                                : selectedCategory.kind === "confetti"
                                  ? option.isDefault
                                    ? "Default celebration"
                                    : `${optionPrice} coins`
                                  : isQuestUnlockOption && !store.ownedOptionIds.includes(option.id)
                                    ? option.unlockLabel || "Quest Award"
                                    : `${optionPrice} coins`}
                        </Text>
                        {selectedCategory.kind === "quest_item" && questCount > 0 ? (
                          <Text style={styles.ownedCount}>Owned: {questCount}</Text>
                        ) : null}
                        <Button
                          label={actionLabel}
                          disabled={isDisabled}
                          onPress={() => void handleOptionPress(selectedCategory, option)}
                        />
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>
          ) : null}
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  categoryRow: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  heroImage: {
    width: "100%",
    height: 160,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
  },
  categoryHeader: {
    gap: spacing.xs,
  },
  categoryTitle: {
    fontSize: typography.h3,
    fontWeight: "800",
    color: colors.text,
  },
  categoryDescription: {
    fontSize: typography.small,
    color: colors.muted,
  },
  successText: {
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: radius.md,
    backgroundColor: "#f0fdf4",
    color: "#166534",
    fontSize: typography.small,
    fontWeight: "700",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionGrid: {
    gap: spacing.sm,
  },
  optionCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    padding: spacing.md,
    gap: spacing.sm,
  },
  optionCardActive: {
    borderColor: colors.brand,
    backgroundColor: "#f5fbff",
  },
  themePreview: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  colorChip: {
    flex: 1,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(27,42,65,0.08)",
  },
  avatarPreviewWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xs,
  },
  confettiPreview: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    minHeight: 56,
    alignItems: "center",
  },
  confettiChip: {
    width: 14,
    height: 14,
    borderRadius: radius.sm,
  },
  confettiStreamer: {
    width: 8,
    height: 20,
    borderRadius: radius.pill,
  },
  optionImage: {
    width: "100%",
    height: 148,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    resizeMode: "cover",
  },
  optionTitle: {
    fontSize: typography.body,
    fontWeight: "800",
    color: colors.text,
  },
  optionMeta: {
    fontSize: typography.small,
    color: colors.muted,
  },
  ownedCount: {
    fontSize: typography.small,
    fontWeight: "700",
    color: colors.brandStrong,
  },
});
