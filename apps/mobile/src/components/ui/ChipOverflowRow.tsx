import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme";

export type ChipOverflowItem = {
  id: string;
  label: string;
  active?: boolean;
  onPress: () => void;
};

type Props = {
  items: ChipOverflowItem[];
  maxVisible?: number;
};

export function ChipOverflowRow({ items, maxVisible = 3 }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleItems = useMemo(() => items.slice(0, maxVisible), [items, maxVisible]);
  const overflowItems = useMemo(() => items.slice(maxVisible), [items, maxVisible]);
  const overflowActive = overflowItems.some((item) => item.active);

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        {visibleItems.map((item) => (
          <ChipButton key={item.id} label={item.label} active={Boolean(item.active)} onPress={item.onPress} />
        ))}
        {overflowItems.length > 0 ? (
          <View style={[styles.menuAnchor, menuOpen && styles.menuAnchorOpen]}>
            <ChipButton
              label={`+${overflowItems.length} more...`}
              active={menuOpen || overflowActive}
              onPress={() => setMenuOpen((current) => !current)}
            />
            {menuOpen ? (
              <View style={styles.menu}>
                {overflowItems.map((item) => (
                  <ChipButton
                    key={item.id}
                    label={item.label}
                    active={Boolean(item.active)}
                    compact
                    onPress={() => {
                      setMenuOpen(false);
                      item.onPress();
                    }}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ChipButton({
  label,
  active,
  onPress,
  compact = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        compact && styles.compactChip,
        pressed && styles.chipPressed,
      ]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    minWidth: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  menuAnchor: {
    position: "relative",
  },
  menuAnchorOpen: {
    zIndex: 40,
    elevation: 40,
  },
  chip: {
    minHeight: 40,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    paddingHorizontal: spacing.md,
  },
  compactChip: {
    minHeight: 38,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: {
    color: colors.brandStrong,
    fontSize: typography.small,
    fontWeight: "900",
  },
  chipTextActive: {
    color: "#fff",
  },
  chipPressed: {
    transform: [{ scale: 0.98 }],
  },
  menu: {
    position: "absolute",
    top: 46,
    right: 0,
    minWidth: 170,
    gap: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    padding: spacing.sm,
    shadowColor: "#173b67",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 50,
    zIndex: 50,
  },
});
