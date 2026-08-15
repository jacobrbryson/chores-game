import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  RESPONSIBILITY_PILLAR_EMOJI,
  responsibilityTitleLabel,
  topEarnedIdentities,
  type PillarIdentity,
} from "@packages/core";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";

// Compact, presentational list of a child's earned identities — "who they are".
// The mobile counterpart of web's IdentitySummaryStrip: takes already-loaded
// identities so it never fetches, and renders nothing when the child hasn't
// started any pillar.
export function MobileIdentitySummaryStrip({
  identities,
  limit = 3,
  variant = "rows",
}: {
  identities: PillarIdentity[];
  limit?: number;
  // "rows": stacked emoji + title lines (profile). "chips": inline pills
  // (selection tiles, family growth).
  variant?: "rows" | "chips";
}) {
  const { t } = useMobileLocale();
  const top = topEarnedIdentities(identities, limit);
  if (top.length === 0) {
    return null;
  }

  return (
    <View style={variant === "chips" ? styles.chipWrap : styles.rowWrap}>
      {top.map((entry) => (
        <View key={entry.pillar} style={variant === "chips" ? styles.chip : styles.row}>
          <Text style={styles.emoji}>{RESPONSIBILITY_PILLAR_EMOJI[entry.pillar]}</Text>
          <Text style={variant === "chips" ? styles.chipText : styles.rowText} numberOfLines={1}>
            {responsibilityTitleLabel(entry.pillar, entry.titleTier, t)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rowWrap: { gap: spacing.xs },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowText: { flex: 1, color: colors.text, fontSize: typography.body, fontWeight: "800" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipText: { color: colors.brandStrong, fontSize: typography.tiny, fontWeight: "800" },
  emoji: { fontSize: typography.body },
});
