import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  addMobileGhostSuggestion,
  dismissMobileGhostSuggestion,
  fetchMobileGhostSuggestions,
  type MobileGhostSuggestion,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { Badge, Button, CoinPill } from "@/components/ui";
import { radius, spacing, typography } from "@/theme";

const MAX_SUGGESTIONS = 3;

function reasonKey(source: string) {
  if (source === "recent_chore") {
    return "ghost.reasonRecent";
  }
  if (source === "family_history") {
    return "ghost.reasonHistory";
  }
  return "ghost.reasonBuiltin";
}

type MobileGhostChoresProps = {
  assigneeId?: string;
  assigneeName?: string;
  onAdded?: () => Promise<void> | void;
};

/**
 * Smart Ghost Chores (mobile). Shown inside the dashboard empty state, under the
 * "Add Chore" button. Up to three deterministic, safe suggestions. "Add Chore" creates a
 * real chore (a `see_and_do` chore for players, a normal chore for admins) and upvotes
 * the suggestion; "Dismiss" hides it and downvotes it. Admin review/approval is web-only.
 */
export function MobileGhostChores({ assigneeId, assigneeName, onAdded }: MobileGhostChoresProps) {
  const { t } = useMobileLocale();
  // Hold more than we show so adding/dismissing one refills from the next idea.
  const [pool, setPool] = useState<MobileGhostSuggestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const suggestions = pool.slice(0, MAX_SUGGESTIONS);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await fetchMobileGhostSuggestions();
        if (active) {
          setPool(result.suggestions);
        }
      } catch {
        if (active) {
          setPool([]);
        }
      } finally {
        if (active) {
          setLoaded(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function add(suggestion: MobileGhostSuggestion) {
    setBusyId(suggestion.id);
    setError("");
    try {
      await addMobileGhostSuggestion(suggestion.id, {
        assigneeId: assigneeId ?? "",
        assigneeName: assigneeName ?? "",
      });
      setPool((prev) => prev.filter((entry) => entry.id !== suggestion.id));
      await onAdded?.();
    } catch {
      setError(t("ghost.addError"));
    } finally {
      setBusyId("");
    }
  }

  async function dismiss(suggestion: MobileGhostSuggestion) {
    setBusyId(suggestion.id);
    try {
      await dismissMobileGhostSuggestion(suggestion.id);
      setPool((prev) => prev.filter((entry) => entry.id !== suggestion.id));
    } catch {
      // Leave the card so the player can retry.
    } finally {
      setBusyId("");
    }
  }

  if (!loaded || suggestions.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>{t("ghost.suggestedDivider")}</Text>
        <View style={styles.dividerLine} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.list}>
        {suggestions.map((suggestion) => {
          const isBusy = busyId === suggestion.id;
          return (
            <View key={suggestion.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.ghostAvatar}>
                  <Text style={styles.ghostAvatarGlyph}>{"👻"}</Text>
                </View>
                <View style={styles.cardCopy}>
                  <Text
                    style={styles.title}
                    accessibilityLabel={`${suggestion.suggestedTitle}. ${t(reasonKey(suggestion.source))}`}
                    accessibilityHint={t(reasonKey(suggestion.source))}>
                    {suggestion.suggestedTitle}
                  </Text>
                  <View style={styles.badgeRow}>
                    <Badge label={t("ghost.badge")} />
                  </View>
                  <Text style={styles.subtitle}>{t("ghost.notAssigned")}</Text>
                </View>
                <CoinPill value={suggestion.suggestedCoinValue > 0 ? suggestion.suggestedCoinValue : "-"} />
              </View>
              <View style={styles.actions}>
                <View style={styles.actionPrimary}>
                  <Button
                    label={isBusy ? t("ghost.adding") : t("ghost.addChore")}
                    onPress={() => void add(suggestion)}
                    disabled={isBusy}
                  />
                </View>
                <Button
                  label={t("ghost.dismiss")}
                  variant="secondary"
                  onPress={() => void dismiss(suggestion)}
                  disabled={isBusy}
                />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, gap: spacing.sm },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#d6deea" },
  dividerText: {
    color: "#7a89a3",
    fontSize: typography.small,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  error: { color: "#b0405a", fontSize: typography.small, fontWeight: "700" },
  list: { gap: spacing.sm },
  card: {
    gap: spacing.sm,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#c2ccdd",
    borderLeftWidth: 5,
    borderRadius: radius.lg,
    padding: spacing.sm,
    backgroundColor: "#f7f9fc",
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardCopy: { flex: 1, gap: 2 },
  ghostAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#c2ccdd",
    backgroundColor: "#e7ecf5",
    alignItems: "center",
    justifyContent: "center",
  },
  ghostAvatarGlyph: { fontSize: 16 },
  badgeRow: { flexDirection: "row" },
  title: { color: "#233149", fontSize: typography.body, fontWeight: "900" },
  subtitle: { color: "#7a89a3", fontSize: typography.small, fontStyle: "italic" },
  actions: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm },
  actionPrimary: { flex: 1 },
});
