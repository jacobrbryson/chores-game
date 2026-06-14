import React from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";
import { colors } from "@/theme";

// Lightweight celebratory confetti burst built on the RN Animated API so it
// needs no native module — works in Expo Go, dev builds, and web. Render it
// (keyed, so each completion remounts a fresh burst) and it self-plays once.
// Pass `label` to overlay a big celebratory headline (used for "All Done!").

const COLORS = ["#0072b2", "#56b4e9", "#16a34a", "#fbbf24", "#dc2626", "#9333ea", "#ec4899"];
export const CONFETTI_DURATION_MS = 1600;
const PIECE_COUNT = 64;

type Piece = {
  color: string;
  size: number;
  dx: number; // horizontal travel
  up: number; // initial upward pop
  down: number; // gravity fall
  rotateTo: string;
};

function buildPieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, () => {
    const angle = Math.random() * Math.PI; // fan out to both sides and up
    const distance = 140 + Math.random() * 240;
    return {
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 11 + Math.random() * 13,
      dx: Math.cos(angle) * distance * (Math.random() < 0.5 ? -1 : 1),
      up: 100 + Math.random() * 240,
      down: 420 + Math.random() * 340,
      rotateTo: `${Math.random() < 0.5 ? "-" : ""}${180 + Math.floor(Math.random() * 720)}deg`,
    };
  });
}

export function MobileConfetti({
  originX,
  originY,
  label,
}: {
  originX?: number;
  originY?: number;
  label?: string;
}) {
  const { width, height } = Dimensions.get("window");
  const ox = originX ?? width / 2;
  const oy = originY ?? height / 3;
  const progress = React.useRef(new Animated.Value(0)).current;
  const labelPop = React.useRef(new Animated.Value(0)).current;
  const pieces = React.useRef<Piece[]>(buildPieces()).current;

  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: CONFETTI_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    if (label) {
      Animated.spring(labelPop, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }).start();
    }
  }, [progress, labelPop, label]);

  const labelScale = labelPop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const labelOpacity = progress.interpolate({
    inputRange: [0, 0.12, 0.8, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.origin, { left: ox, top: oy }]}>
        {pieces.map((piece, index) => {
          const translateX = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, piece.dx],
          });
          const translateY = progress.interpolate({
            inputRange: [0, 0.3, 1],
            outputRange: [0, -piece.up, piece.down],
          });
          const rotate = progress.interpolate({
            inputRange: [0, 1],
            outputRange: ["0deg", piece.rotateTo],
          });
          const opacity = progress.interpolate({
            inputRange: [0, 0.75, 1],
            outputRange: [1, 1, 0],
          });
          return (
            <Animated.View
              key={index}
              style={[
                styles.piece,
                {
                  width: piece.size,
                  height: piece.size * 0.6,
                  backgroundColor: piece.color,
                  opacity,
                  transform: [{ translateX }, { translateY }, { rotate }],
                },
              ]}
            />
          );
        })}
      </View>
      {label ? (
        <View style={styles.labelWrap}>
          <Animated.Text
            style={[styles.label, { opacity: labelOpacity, transform: [{ scale: labelScale }] }]}>
            {label}
          </Animated.Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  origin: { position: "absolute", width: 0, height: 0 },
  piece: { position: "absolute", borderRadius: 2 },
  labelWrap: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  label: {
    fontSize: 56,
    fontWeight: "900",
    color: colors.brandStrong,
    textAlign: "center",
    paddingHorizontal: 16,
    textShadowColor: "rgba(255,255,255,0.9)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
});
