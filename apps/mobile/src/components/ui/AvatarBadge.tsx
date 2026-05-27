import React from "react";
import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

function getContrastingTextColor(backgroundColor?: string) {
  const normalized = backgroundColor?.trim() ?? "";
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return colors.brandStrong;
  }

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? colors.text : "#ffffff";
}

function normalizeImageUrl(imageUrl?: string) {
  const normalized = imageUrl?.trim() ?? "";
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("//")) {
    return `https:${normalized}`;
  }
  return normalized;
}

export function AvatarBadge({
  name,
  imageUrl,
  color,
  size = 36,
}: {
  name: string;
  imageUrl?: string;
  color?: string;
  size?: number;
}) {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  const avatarSize = { width: size, height: size, borderRadius: size / 2 };
  const textColor = getContrastingTextColor(color);
  const resolvedImageUrl = normalizeImageUrl(imageUrl);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [resolvedImageUrl]);

  return (
    <View style={[styles.avatar, avatarSize, color ? { backgroundColor: color, borderColor: color } : null]}>
      {resolvedImageUrl && !imageFailed ? (
        <Image source={{ uri: resolvedImageUrl }} style={styles.image} onError={() => setImageFailed(true)} />
      ) : (
        <Text style={[styles.text, color ? { color: textColor } : null]}>{initial}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  image: { width: "100%", height: "100%" },
  text: { color: colors.brandStrong, fontSize: typography.body, fontWeight: "800" },
});
