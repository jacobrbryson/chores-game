import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { getMobileBreadcrumbTrail } from "@packages/core/src/breadcrumbs";
import { colors, radius, spacing, typography } from "@/theme";

const brandIcon = require("../../../../web/public/icons/web-app-manifest-192x192.png");

type Props = {
  pageLabel: string;
};

export function AppBreadcrumbs({ pageLabel }: Props) {
  const items = getMobileBreadcrumbTrail(pageLabel);

  return (
    <View style={styles.row}>
      {items.map((item, index) => {
        const isCurrent = index === items.length - 1;
        const isRoot = index === 0;

        return (
          <React.Fragment key={`${item.label}-${index}`}>
            {isRoot ? (
              <View style={styles.rootChip}>
                <Image source={brandIcon} style={styles.logo} />
                <Text style={styles.rootText} numberOfLines={1}>
                  {item.label}
                </Text>
              </View>
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
  );
}

const styles = StyleSheet.create({
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
});
