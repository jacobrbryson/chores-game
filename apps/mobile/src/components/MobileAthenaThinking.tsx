import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useMobileLocale } from "@/lib/locale";
import { radius, spacing, typography } from "@/theme";

const STAGE_PILLARS_MS = 3000;
const STAGE_PERSONAL_MS = 5000;
const THOUGHT_INTERVAL_MS = 2200;

const CHILD_KEYS = [
  "ghost.thinking.child1",
  "ghost.thinking.child2",
  "ghost.thinking.child3",
  "ghost.thinking.child4",
  "ghost.thinking.child5",
  "ghost.thinking.child6",
];
const PARENT_KEYS = [
  "ghost.thinking.parent1",
  "ghost.thinking.parent2",
  "ghost.thinking.parent3",
  "ghost.thinking.parent4",
  "ghost.thinking.parent5",
  "ghost.thinking.parent6",
];
const PILLAR_KEYS = [
  "home_care",
  "self_care",
  "organization",
  "family_contribution",
  "life_skills",
];

/** Subscribe to the OS "reduce motion" accessibility setting. */
export function useMobileReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => setReduced(value));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Glowing, breathing Athena orb (built-in Animated; still under reduced motion). */
export function MobileAthenaAvatar({ size = 88, animate = true }: { size?: number; animate?: boolean }) {
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, breathe]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const glowOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  return (
    <View style={{ width: size * 1.4, height: size * 1.4, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={[
          styles.glow,
          { width: size * 1.4, height: size * 1.4, borderRadius: size, opacity: animate ? glowOpacity : 0.5 },
        ]}
      />
      <Animated.View
        style={[
          styles.orb,
          { width: size, height: size, borderRadius: size / 2, transform: animate ? [{ scale }] : [] },
        ]}
      >
        <Text style={{ fontSize: size * 0.42 }}>{"✨"}</Text>
      </Animated.View>
    </View>
  );
}

type MobileAthenaThinkingProps = {
  role: "admin" | "player";
  subjectName?: string;
  reducedMotion?: boolean;
};

/**
 * Mobile counterpart of the web AthenaThinkingPanel. Athena's orb breathes/glows
 * while a rotating "thought" fades through, escalating to pillar + personal lines
 * the longer the wait. No spinners, no progress bars.
 */
export function MobileAthenaThinking({ role, subjectName, reducedMotion = false }: MobileAthenaThinkingProps) {
  const { t } = useMobileLocale();
  const [elapsedMs, setElapsedMs] = useState(reducedMotion ? STAGE_PILLARS_MS : 0);
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 300);
    return () => clearInterval(timer);
  }, [reducedMotion]);

  const messages = React.useMemo(() => {
    const list = (role === "admin" ? PARENT_KEYS : CHILD_KEYS).map((key) => t(key));
    if (elapsedMs >= STAGE_PILLARS_MS) {
      for (const pillar of PILLAR_KEYS) {
        list.push(t("ghost.thinking.pillarHighlight", { pillar: t(`responsibility.pillars.${pillar}`) }));
      }
    }
    if (elapsedMs >= STAGE_PERSONAL_MS) {
      list.push(t("ghost.thinking.recentActivity"));
      const name = (subjectName ?? "").trim();
      if (name) {
        list.push(t("ghost.thinking.personalName", { name }));
      }
    }
    return list;
  }, [role, subjectName, elapsedMs, t]);

  useEffect(() => {
    if (reducedMotion || messages.length <= 1) {
      return;
    }
    const timer = setInterval(() => {
      // Fade out, swap, fade in.
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setIndex((current) => (current + 1) % messages.length);
        Animated.timing(fade, { toValue: 1, duration: 280, useNativeDriver: true }).start();
      });
    }, THOUGHT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [messages.length, reducedMotion, fade]);

  const message = messages[index % Math.max(messages.length, 1)] ?? "";

  return (
    <View style={styles.wrap} accessibilityRole="text" accessibilityLiveRegion="polite">
      <MobileAthenaAvatar animate={!reducedMotion} />
      <Animated.Text style={[styles.thought, { opacity: reducedMotion ? 1 : fade }]}>{message}</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", gap: spacing.md, paddingVertical: spacing.xl },
  glow: { position: "absolute", backgroundColor: "rgba(217, 70, 239, 0.28)" },
  orb: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#8b5cf6",
    borderRadius: radius.pill,
    shadowColor: "#8b5cf6",
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  thought: {
    minHeight: 20,
    textAlign: "center",
    color: "#6d28d9",
    fontSize: typography.body,
    fontWeight: "700",
    paddingHorizontal: spacing.lg,
  },
});
