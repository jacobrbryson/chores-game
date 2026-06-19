import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import {
  addMobileGhostSuggestion,
  dismissMobileGhostSuggestion,
  fetchMobileGhostSuggestions,
  type MobileGhostSuggestion,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { Badge, Button, CoinPill } from "@/components/ui";
import { radius, spacing, typography } from "@/theme";
import {
  MobileAthenaAvatar,
  MobileAthenaThinking,
  useMobileReducedMotion,
} from "@/components/MobileAthenaThinking";

const MAX_SUGGESTIONS = 3;
/** Even on an instant response, let Athena "think" briefly so it feels intentional. */
const MIN_THINK_MS = 600;
const REVEAL_STEP_MS = 300;

type Phase = "thinking" | "revealing" | "empty" | "failed" | "hidden";

function reasonKey(source: string) {
  if (source === "recent_chore") {
    return "ghost.reasonRecent";
  }
  if (source === "family_history") {
    return "ghost.reasonHistory";
  }
  return "ghost.reasonBuiltin";
}

function difficultyKey(difficulty: "easy" | "medium" | "hard") {
  if (difficulty === "medium") return "ghost.difficultyMedium";
  if (difficulty === "hard") return "ghost.difficultyHard";
  return "ghost.difficultyEasy";
}

function suggestionTypeKey(type: "repeat" | "next_step" | "skill_building" | "novelty") {
  if (type === "repeat") return "ghost.typeRepeat";
  if (type === "next_step") return "ghost.typeNextStep";
  if (type === "skill_building") return "ghost.typeSkillBuilding";
  return "ghost.typeNovelty";
}

/** A single suggestion card that animates itself in (staggered by index). */
function RevealItem({
  index,
  reducedMotion,
  children,
}: {
  index: number;
  reducedMotion: boolean;
  children: React.ReactNode;
}) {
  const value = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    const anim = Animated.timing(value, {
      toValue: 1,
      duration: 380,
      delay: 200 + index * REVEAL_STEP_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [index, reducedMotion, value]);
  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  return <Animated.View style={{ opacity: value, transform: [{ translateY }] }}>{children}</Animated.View>;
}

type MobileGhostChoresProps = {
  assigneeId?: string;
  assigneeName?: string;
  viewerRole?: "admin" | "player";
  onAdded?: () => Promise<void> | void;
};

/**
 * Smart Ghost Chores (mobile) with the magical Athena experience. Athena "thinks"
 * about the family (breathing/glowing orb + rotating thoughts), then reveals her
 * ideas one at a time. Empty/failure states speak in Athena's encouraging voice —
 * never technical errors. Honors the OS reduce-motion setting.
 */
export function MobileGhostChores({ assigneeId, assigneeName, viewerRole = "player", onAdded }: MobileGhostChoresProps) {
  const { t } = useMobileLocale();
  const reducedMotion = useMobileReducedMotion();
  const [phase, setPhase] = useState<Phase>("thinking");
  const [pool, setPool] = useState<MobileGhostSuggestion[]>([]);
  const [source, setSource] = useState<"athena" | "local">("local");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const suggestions = pool.slice(0, MAX_SUGGESTIONS);

  useEffect(() => {
    let active = true;
    setPhase("thinking");
    setError("");
    const startedAt = Date.now();
    void (async () => {
      let data: Awaited<ReturnType<typeof fetchMobileGhostSuggestions>> | null = null;
      let failed = false;
      try {
        data = await fetchMobileGhostSuggestions();
      } catch {
        failed = true;
      }
      if (!active) {
        return;
      }
      const minThink = reducedMotionRef.current ? 0 : MIN_THINK_MS;
      const wait = Math.max(0, minThink - (Date.now() - startedAt));
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      if (!active) {
        return;
      }
      if (failed || !data) {
        setPhase("failed");
        return;
      }
      setSource(data.source);
      setPool(data.suggestions);
      if (data.suggestions.length > 0) {
        setPhase("revealing");
      } else if (!data.eligible) {
        setPhase("hidden");
      } else {
        setPhase("empty");
      }
    })();
    return () => {
      active = false;
    };
  }, [assigneeId]);

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

  if (phase === "hidden") {
    return null;
  }

  if (phase === "thinking") {
    return (
      <View style={styles.wrap}>
        <MobileAthenaThinking role={viewerRole} subjectName={assigneeName} reducedMotion={reducedMotion} />
      </View>
    );
  }

  if (phase === "empty" || phase === "failed") {
    return (
      <View style={styles.wrap}>
        <View style={styles.fallback}>
          <MobileAthenaAvatar size={44} animate={false} />
          <Text style={styles.fallbackText}>
            {phase === "empty" ? t("ghost.thinking.empty") : t("ghost.thinking.failure")}
          </Text>
        </View>
      </View>
    );
  }

  const isAthena = source === "athena";

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <MobileAthenaAvatar size={32} animate={false} />
        <Text style={styles.headline}>
          {isAthena ? t("ghost.thinking.celebrationAthena") : t("ghost.thinking.celebrationSaved")}
        </Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.list}>
        {suggestions.map((suggestion, index) => {
          const isBusy = busyId === suggestion.id;
          const meta = suggestion.athena;
          const reason = meta?.reason || t(reasonKey(suggestion.source));
          return (
            <RevealItem key={suggestion.id} index={index} reducedMotion={reducedMotion}>
              <View style={[styles.card, isAthena && styles.cardAthena]}>
                <View style={styles.cardTop}>
                  <View style={[styles.ghostAvatar, isAthena && styles.ghostAvatarAthena]}>
                    <Text style={styles.ghostAvatarGlyph}>{isAthena ? "✨" : "👻"}</Text>
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.title} accessibilityLabel={`${suggestion.suggestedTitle}. ${reason}`}>
                      {suggestion.suggestedTitle}
                    </Text>
                    <View style={styles.badgeRow}>
                      <Badge label={isAthena ? t("ghost.athenaBadge") : t("ghost.badge")} />
                      {meta ? <Badge label={t(suggestionTypeKey(meta.suggestionType))} /> : null}
                    </View>
                    {suggestion.suggestedDescription ? (
                      <Text style={styles.subtitle}>{suggestion.suggestedDescription}</Text>
                    ) : (
                      <Text style={styles.subtitle}>{t("ghost.notAssigned")}</Text>
                    )}
                  </View>
                  <CoinPill value={suggestion.suggestedCoinValue > 0 ? suggestion.suggestedCoinValue : "-"} />
                </View>

                {meta ? (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaPill}>{t(difficultyKey(meta.difficulty))}</Text>
                    {meta.estimatedMinutes ? (
                      <Text style={styles.metaPill}>{t("ghost.minutes", { minutes: String(meta.estimatedMinutes) })}</Text>
                    ) : null}
                    {meta.requiresParentReview ? (
                      <Text style={[styles.metaPill, styles.metaPillReview]}>{t("ghost.parentReview")}</Text>
                    ) : null}
                  </View>
                ) : null}

                <Text style={styles.reason}>{isAthena ? `✨ ${reason}` : reason}</Text>

                {meta?.safetyNotes ? (
                  <Text style={styles.safety}>
                    {t("ghost.safetyPrefix")} {meta.safetyNotes}
                  </Text>
                ) : null}

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
            </RevealItem>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.md, gap: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  headline: { flex: 1, color: "#6d28d9", fontSize: typography.body, fontWeight: "800" },
  error: { color: "#b0405a", fontSize: typography.small, fontWeight: "700" },
  list: { gap: spacing.sm },
  fallback: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#f5f3ff",
    borderWidth: 1,
    borderColor: "#ede9fe",
  },
  fallbackText: { flex: 1, color: "#5b21b6", fontSize: typography.body, fontWeight: "700" },
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
  cardAthena: { borderColor: "#c4b5fd", borderLeftColor: "#a78bfa", backgroundColor: "#faf8ff" },
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
  ghostAvatarAthena: { borderStyle: "solid", borderColor: "#ddd6fe", backgroundColor: "#ede9fe" },
  ghostAvatarGlyph: { fontSize: 16 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  title: { color: "#233149", fontSize: typography.body, fontWeight: "900" },
  subtitle: { color: "#7a89a3", fontSize: typography.small, fontStyle: "italic" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaPill: {
    color: "#475569",
    backgroundColor: "#eef2f7",
    fontSize: typography.tiny,
    fontWeight: "700",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  metaPillReview: { color: "#6d28d9", backgroundColor: "#ede9fe" },
  reason: { color: "#64748b", fontSize: typography.small, lineHeight: 18 },
  safety: {
    color: "#9a3412",
    backgroundColor: "#fff7ed",
    fontSize: typography.small,
    padding: 6,
    borderRadius: radius.sm,
  },
  actions: { flexDirection: "row", alignItems: "stretch", gap: spacing.sm },
  actionPrimary: { flex: 1 },
});
