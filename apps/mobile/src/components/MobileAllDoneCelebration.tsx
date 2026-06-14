import React from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";
import { colors, spacing, typography } from "@/theme";

// Big, fun "all done" state for the kiosk checklist: a trophy pops in with a
// springy scale, then gently bounces and wiggles forever. Pure RN Animated, so
// no native module is required.
export function MobileAllDoneCelebration({ title, body }: { title: string; body: string }) {
  const enter = React.useRef(new Animated.Value(0)).current;
  const bounce = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.spring(enter, {
      toValue: 1,
      friction: 4,
      tension: 80,
      useNativeDriver: true,
    }).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bounce, {
          toValue: 0,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, bounce]);

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const translateY = bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -18] });
  const rotate = bounce.interpolate({ inputRange: [0, 0.5, 1], outputRange: ["-7deg", "7deg", "-7deg"] });

  return (
    <Animated.View style={[styles.wrap, { opacity: enter, transform: [{ scale }] }]}>
      <Animated.Text style={[styles.emoji, { transform: [{ translateY }, { rotate }] }]}>
        🏆
      </Animated.Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxxl },
  emoji: { fontSize: 96, lineHeight: 110, textAlign: "center" },
  title: { fontSize: typography.title, fontWeight: "900", color: colors.brandStrong, textAlign: "center" },
  body: { fontSize: typography.body, color: colors.muted, textAlign: "center", paddingHorizontal: spacing.lg },
});
