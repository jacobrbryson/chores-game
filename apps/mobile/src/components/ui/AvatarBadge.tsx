import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

export function AvatarBadge({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  return (
    <View style={styles.avatar}>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.image} /> : <Text style={styles.text}>{initial}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  text: { color: colors.brandStrong, fontSize: typography.body, fontWeight: "800" },
});
