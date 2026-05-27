import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { getMobileBreadcrumbTrail } from "@packages/core/src/breadcrumbs";
import { colors, radius, spacing, typography } from "@/theme";

const brandIcon = require("../../../../web/public/icons/web-app-manifest-192x192.png");

type Props = {
  pageLabel: string;
  subtitle?: string;
  onPressRoot?: () => void;
};

export function AppBreadcrumbs({ pageLabel, subtitle, onPressRoot }: Props) {
  const items = getMobileBreadcrumbTrail(pageLabel);

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          const isRoot = index === 0;

          return (
            <React.Fragment key={`${item.label}-${index}`}>
              {isRoot ? (
                onPressRoot ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Go to dashboard"
                    onPress={onPressRoot}
                    style={({ pressed }) => [styles.rootChip, pressed && styles.rootChipPressed]}>
                    <Image source={brandIcon} style={styles.logo} />
                    <Text style={styles.rootText} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </Pressable>
                ) : (
                  <View style={styles.rootChip}>
                    <Image source={brandIcon} style={styles.logo} />
                    <Text style={styles.rootText} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </View>
                )
              ) : (
                <Text style={styles.currentText} numberOfLines={1}>
                  {item.label}
                </Text>
              )}
              {!isCurrent ? <Text style={styles.separator}>{">"}</Text> : null}
            </React.Fragment>
          );
        })}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.xs,
  },
  row: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  rootChip: {
    minWidth: 0,
    maxWidth: "65%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 1,
  },
  logo: {
    width: 20,
    height: 20,
    borderRadius: 6,
  },
  rootText: {
    flexShrink: 1,
    color: colors.brandStrong,
    fontSize: typography.small,
    fontWeight: "800",
  },
  rootChipPressed: {
    opacity: 0.82,
  },
  separator: {
    color: colors.muted,
    fontSize: typography.small,
    fontWeight: "800",
  },
  currentText: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: typography.h3,
    fontWeight: "800",
  },
  subtitle: {
    paddingLeft: spacing.sm,
    color: colors.muted,
    fontSize: typography.small,
    fontWeight: "700",
  },
});
