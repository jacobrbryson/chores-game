import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card } from "@/components/ui";
import { confirmMobileFamilyFriend, fetchMobileFamilyFriends } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, spacing, typography } from "@/theme";

type Invite = { id: string; status: string; fromFamilyName: string; fromAdminName: string };

export function MobileFamilyFriendsHighlights() {
  const { t } = useMobileLocale();
  const [incoming, setIncoming] = useState<Invite[]>([]);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await fetchMobileFamilyFriends();
      setIncoming(
        result.viewerRole === "admin"
          ? (result.incoming || []).filter((invite) => invite.status === "pending")
          : [],
      );
    } catch {
      // Highlights are additive and should not block the chores dashboard.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm(invite: Invite) {
    if (pendingId) return;
    setPendingId(invite.id);
    setError("");
    try {
      await confirmMobileFamilyFriend(invite.id);
      await load();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "family_friend_confirm_failed");
    } finally {
      setPendingId("");
    }
  }

  return (
    <View style={styles.wrap}>
      {incoming.map((invite) => (
        <Card key={invite.id} style={styles.inviteCard}>
          <Text style={styles.title}>{t("familyFriends.incoming.dashboardTitle", { family: invite.fromFamilyName })}</Text>
          <Text style={styles.body}>{t("familyFriends.incoming.from", { name: invite.fromAdminName })}</Text>
          <Button
            label={pendingId === invite.id ? t("familyFriends.actions.confirming") : t("familyFriends.actions.confirm")}
            disabled={Boolean(pendingId)}
            onPress={() => void confirm(invite)}
          />
        </Card>
      ))}
      {error ? <Text style={styles.error}>{t("familyFriends.errors.action", { error })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  inviteCard: { gap: spacing.sm, backgroundColor: "#eff6ff", borderColor: "#bfdbfe" },
  title: { fontSize: typography.h3, fontWeight: "800", color: colors.text },
  body: { fontSize: typography.small, color: colors.muted },
  error: { fontSize: typography.small, color: "#b91c1c", fontWeight: "700" },
});
