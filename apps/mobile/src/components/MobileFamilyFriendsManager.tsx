import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  cancelMobileFamilyFriendInvite,
  confirmMobileFamilyFriend,
  fetchMobileFamilyFriends,
  inviteMobileFamilyFriend,
  removeMobileFamilyFriend,
  resendMobileFamilyFriendInvite,
  type MobileFamilyFriend,
  type MobileFamilyFriendInvite,
  type MobileFamilyFriendsState,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { Button, Card, EmptyState, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

type Notice = "sent" | "email_warning" | "accept" | "resend" | "cancel" | "removed" | "";

export function MobileFamilyFriendsManager() {
  const { locale, t } = useMobileLocale();
  const [data, setData] = useState<MobileFamilyFriendsState | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<Notice>("");
  const [removeTarget, setRemoveTarget] = useState<MobileFamilyFriend | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchMobileFamilyFriends());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "family_friends_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const incoming = useMemo(
    () => (data?.incoming || []).filter((invite) => invite.status === "pending"),
    [data?.incoming],
  );
  const outgoing = useMemo(
    () => (data?.outgoing || []).filter((invite) => invite.status === "pending" || invite.status === "expired"),
    [data?.outgoing],
  );

  async function runAction(id: string, action: () => Promise<unknown>, success: Notice) {
    if (pendingId) return;
    setPendingId(id);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "family_friend_action_failed");
    } finally {
      setPendingId("");
    }
  }

  async function invite() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || pendingId) return;
    setPendingId("invite");
    setError("");
    setNotice("");
    try {
      const result = (await inviteMobileFamilyFriend(normalizedEmail)) as { delivery?: { email?: boolean } };
      setEmail("");
      setNotice(result.delivery?.email ? "sent" : "email_warning");
      await load();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "family_friend_invite_failed");
    } finally {
      setPendingId("");
    }
  }

  async function removeFriend() {
    if (!removeTarget) return;
    const target = removeTarget;
    await runAction(target.familyId, () => removeMobileFamilyFriend(target.familyId), "removed");
    setRemoveTarget(null);
  }

  if (loading) return <LoadingState label={t("familyFriends.title")} />;

  return (
    <>
      <Card>
        <SectionHeader title={t("familyFriends.title")} />
        <Text style={styles.description}>{t("familyFriends.description")}</Text>
        {error ? <ErrorState message={t("familyFriends.errors.action", { error })} /> : null}
        {notice ? <Text style={notice === "email_warning" ? styles.warning : styles.success}>{t(`familyFriends.notices.${notice}`)}</Text> : null}

        {data?.viewerRole === "admin" ? (
          <View style={styles.group}>
            <Text style={styles.label}>{t("familyFriends.invite.email")}</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder={t("familyFriends.invite.placeholder")}
              placeholderTextColor={colors.muted}
              style={styles.input}
              editable={!pendingId}
            />
            <Button
              label={pendingId === "invite" ? t("familyFriends.actions.sending") : t("familyFriends.actions.invite")}
              disabled={Boolean(pendingId) || !email.trim()}
              onPress={() => void invite()}
            />
          </View>
        ) : null}

        {incoming.length ? (
          <InviteGroup title={t("familyFriends.incoming.title")} invites={incoming}>
            {(invite) => (
              <Button
                label={pendingId === invite.id ? t("familyFriends.actions.confirming") : t("familyFriends.actions.confirm")}
                disabled={Boolean(pendingId)}
                onPress={() => void runAction(invite.id, () => confirmMobileFamilyFriend(invite.id), "accept")}
              />
            )}
          </InviteGroup>
        ) : null}

        {outgoing.length ? (
          <InviteGroup title={t("familyFriends.outgoing.title")} invites={outgoing} outgoing>
            {(invite) => (
              <View style={styles.actions}>
                <Button
                  label={t("familyFriends.actions.resend")}
                  variant="secondary"
                  disabled={Boolean(pendingId)}
                  onPress={() => void runAction(invite.id, () => resendMobileFamilyFriendInvite(invite.id), "resend")}
                />
                <Button
                  label={t("familyFriends.actions.cancel")}
                  variant="secondary"
                  disabled={Boolean(pendingId)}
                  onPress={() => void runAction(invite.id, () => cancelMobileFamilyFriendInvite(invite.id), "cancel")}
                />
              </View>
            )}
          </InviteGroup>
        ) : null}

        <View style={styles.group}>
          <Text style={styles.groupTitle}>{t("familyFriends.connected.title")}</Text>
          {data?.friends.length ? data.friends.map((friend) => (
            <View key={friend.familyId} style={styles.friendRow}>
              <View style={styles.friendCopy}>
                <Text style={styles.friendName}>{friend.familyName}</Text>
                {friend.connectedAt ? <Text style={styles.meta}>{t("familyFriends.connected.since", { date: new Date(friend.connectedAt).toLocaleDateString(locale) })}</Text> : null}
              </View>
              {data.viewerRole === "admin" ? (
                <Button label={t("familyFriends.actions.remove")} variant="danger" disabled={Boolean(pendingId)} onPress={() => setRemoveTarget(friend)} />
              ) : null}
            </View>
          )) : <EmptyState message={t("familyFriends.connected.empty")} />}
        </View>
      </Card>

      <Modal visible={Boolean(removeTarget)} transparent animationType="fade" onRequestClose={() => setRemoveTarget(null)}>
        <Pressable style={styles.backdrop} onPress={() => setRemoveTarget(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>{t("familyFriends.remove.title")}</Text>
            <Text style={styles.description}>{t("familyFriends.remove.body", { family: removeTarget?.familyName || "" })}</Text>
            <Button label={t("familyFriends.actions.keep")} variant="secondary" disabled={Boolean(pendingId)} onPress={() => setRemoveTarget(null)} />
            <Button label={t("familyFriends.actions.remove")} variant="danger" disabled={Boolean(pendingId)} onPress={() => void removeFriend()} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function InviteGroup({ title, invites, outgoing = false, children }: {
  title: string;
  invites: MobileFamilyFriendInvite[];
  outgoing?: boolean;
  children: (invite: MobileFamilyFriendInvite) => React.ReactNode;
}) {
  const { t } = useMobileLocale();
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {invites.map((invite) => (
        <View key={invite.id} style={styles.inviteRow}>
          <Text style={styles.friendName}>{outgoing ? invite.toEmail : invite.fromFamilyName}</Text>
          {!outgoing ? <Text style={styles.meta}>{t("familyFriends.incoming.from", { name: invite.fromAdminName })}</Text> : null}
          {children(invite)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  description: { color: colors.muted, fontSize: typography.body },
  group: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md, marginTop: spacing.xs },
  groupTitle: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "700" },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.surface },
  inviteRow: { gap: spacing.xs, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md },
  friendRow: { gap: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: spacing.md },
  friendCopy: { flex: 1, gap: 2 },
  friendName: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: typography.small },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  success: { color: "#15803d", fontSize: typography.small, fontWeight: "700" },
  warning: { color: "#92400e", fontSize: typography.small, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.45)", justifyContent: "center", padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  modalTitle: { color: colors.text, fontSize: typography.h3, fontWeight: "800" },
});
