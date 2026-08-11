import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileFamilyMember } from "@/lib/api";
import { colors, radius, spacing, typography } from "@/theme";

type Props = {
  label: string;
  helperText?: string;
  members: MobileFamilyMember[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

export function MobileMemberMultiSelect({
  label,
  helperText,
  members,
  selectedIds,
  onChange,
}: Props) {
  function toggle(memberId: string) {
    onChange(
      selectedIds.includes(memberId)
        ? selectedIds.filter((id) => id !== memberId)
        : [...selectedIds, memberId],
    );
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
      <View style={styles.chipRow}>
        {members.map((member) => {
          const selected = selectedIds.includes(member.id);
          return (
            <Pressable
              key={member.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              onPress={() => toggle(member.id)}
              style={[styles.chip, selected ? styles.chipActive : null]}>
              <Text style={[styles.chipText, selected ? styles.chipTextActive : null]}>
                {member.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  helperText: { color: colors.muted, fontSize: typography.tiny, fontWeight: "700" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    minHeight: 38,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  chipActive: { borderColor: colors.brandStrong, backgroundColor: colors.brandStrong },
  chipText: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  chipTextActive: { color: colors.surface },
});
