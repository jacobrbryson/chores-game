import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  fetchKioskStatus,
  fetchMobileFamilySummary,
  memberAvatarUrl,
  stopKiosk,
  switchKioskPlayer,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { AvatarBadge } from "@/components/ui/AvatarBadge";
import { Button } from "@/components/ui/Button";
import { switchAccountStyles as styles } from "@/components/MobileSwitchAccountModal";
import { colors } from "@/theme";

function normalizePin(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

type RosterMember = {
  id: string;
  name: string;
  avatarUrl: string;
  primaryColor: string;
  isActive: boolean;
};

type Props = {
  visible: boolean;
  // The member id of the currently active kiosk player, so it can be highlighted
  // and excluded from the "switch to" tap target.
  activeMemberId?: string;
  onClose: () => void;
  // Called after switching the active player or exiting kiosk so the host can
  // refresh the session and reset navigation.
  onChanged: () => void;
};

// In-kiosk controls surfaced from the mobile profile menu (the web equivalent
// lives on the dedicated /kiosk page): switch the active player within the
// approved roster (no PIN) or exit Kiosk Mode (PIN when configured).
export function MobileKioskControlsModal({ visible, activeMemberId, onClose, onChanged }: Props) {
  const { t } = useMobileLocale();
  const [step, setStep] = React.useState<"roster" | "exit">("roster");
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [roster, setRoster] = React.useState<RosterMember[]>([]);
  const [pinRequired, setPinRequired] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [status, summary] = await Promise.all([fetchKioskStatus(), fetchMobileFamilySummary()]);
      setPinRequired(status.pinRequired);
      const byId = new Map(summary.members.map((member) => [member.id, member]));
      setRoster(
        status.playerIds
          .map((id) => {
            const member = byId.get(id);
            if (!member) {
              return null;
            }
            return {
              id,
              name: member.name,
              avatarUrl: memberAvatarUrl(member),
              primaryColor: member.dashboardPrimaryColor ?? "",
              isActive: id === activeMemberId,
            } satisfies RosterMember;
          })
          .filter((entry): entry is RosterMember => entry !== null),
      );
    } catch (loadErr) {
      setRoster([]);
      setLoadError(loadErr instanceof Error ? loadErr.message : "kiosk_status_failed");
    } finally {
      setLoading(false);
    }
  }, [activeMemberId]);

  React.useEffect(() => {
    if (visible) {
      setStep("roster");
      setPin("");
      setError("");
      void load();
    }
  }, [visible, load]);

  async function onSwitchPlayer(memberId: string) {
    if (pending || memberId === activeMemberId) {
      return;
    }
    setPending(true);
    setError("");
    try {
      await switchKioskPlayer(memberId);
      onChanged();
    } catch (switchErr) {
      setError(switchErr instanceof Error ? switchErr.message : "kiosk_switch_failed");
    } finally {
      setPending(false);
    }
  }

  async function onExit() {
    if (pending) {
      return;
    }
    setPending(true);
    setError("");
    try {
      await stopKiosk(pin);
      onChanged();
    } catch (exitErr) {
      setError(exitErr instanceof Error ? exitErr.message : "kiosk_stop_failed");
    } finally {
      setPending(false);
    }
  }

  function onExitPressed() {
    if (pinRequired) {
      setPin("");
      setError("");
      setStep("exit");
    } else {
      void onExit();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>{t("kiosk.badge")}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          {step === "roster" ? (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
              <Text style={styles.intro}>{t("kiosk.selectPlayerBody")}</Text>
              {loadError ? (
                <Text style={styles.error}>{t("kiosk.loadError", { error: loadError })}</Text>
              ) : null}
              {error ? <Text style={styles.error}>{t("kiosk.switchError", { error })}</Text> : null}
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.brand} />
                  <Text style={styles.loadingText}>{t("kiosk.loadingPlayers")}</Text>
                </View>
              ) : null}
              {!loading && roster.length === 0 && !loadError ? (
                <Text style={styles.intro}>{t("kiosk.noPlayers")}</Text>
              ) : null}
              {!loading
                ? roster.map((member) => (
                    <Pressable
                      key={member.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: member.isActive, disabled: member.isActive }}
                      disabled={member.isActive || pending}
                      onPress={() => onSwitchPlayer(member.id)}
                      style={({ pressed }) => [
                        styles.memberRow,
                        member.isActive && styles.memberRowSelected,
                        pressed && styles.memberRowPressed,
                      ]}>
                      <AvatarBadge
                        name={member.name}
                        imageUrl={member.avatarUrl}
                        color={member.primaryColor || colors.brand}
                        size={36}
                      />
                      <View style={styles.memberCopy}>
                        <Text style={styles.memberName}>{member.name}</Text>
                        <Text style={styles.memberMeta}>
                          {member.isActive ? t("profileMenu.readyToSwitch") : t("kiosk.switchPlayer")}
                        </Text>
                      </View>
                      {member.isActive ? (
                        <View style={[styles.check, styles.checkOn]}>
                          <Text style={styles.checkMark}>✓</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ))
                : null}
            </ScrollView>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
              <Text style={styles.intro}>{t("kiosk.exitBody")}</Text>
              <Text style={styles.label}>{t("kiosk.pinLabel")}</Text>
              <TextInput
                value={pin}
                onChangeText={(value) => setPin(normalizePin(value))}
                keyboardType="number-pad"
                secureTextEntry
                maxLength={4}
                autoFocus
                placeholder="••••"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
              {error ? <Text style={styles.error}>{t("kiosk.exitError", { error })}</Text> : null}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button
                label={step === "exit" ? t("common.actions.back") : t("common.actions.close")}
                variant="secondary"
                disabled={pending}
                onPress={() => (step === "exit" ? setStep("roster") : onClose())}
              />
            </View>
            <View style={styles.actionButton}>
              {step === "exit" ? (
                <Button
                  label={pending ? t("kiosk.checking") : t("kiosk.exit")}
                  variant="danger"
                  onPress={() => void onExit()}
                  disabled={pending || pin.length < 4}
                />
              ) : (
                <Button
                  label={pending ? t("kiosk.checking") : t("kiosk.exit")}
                  variant="danger"
                  onPress={onExitPressed}
                  disabled={pending}
                />
              )}
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
