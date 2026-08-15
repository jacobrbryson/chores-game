import React from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  fetchKioskStatus,
  fetchSwitchableMembers,
  selectableKioskMembers,
  selectableSwitchMembers,
  setupAccountSwitchPin,
  startAccountSwitch,
  startKiosk,
  stopAccountSwitch,
  type SwitchableMember,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { useFamilyResponsibilityIdentities } from "@/lib/responsibility-identity";
import { MobileIdentitySummaryStrip } from "@/components/MobileIdentitySummaryStrip";
import { AvatarBadge } from "@/components/ui/AvatarBadge";
import { Button } from "@/components/ui/Button";
import { colors, radius, spacing, typography } from "@/theme";

function normalizePin(value: string) {
  return value.replace(/\D/g, "").slice(0, 4);
}

type PickerMode = "switch" | "kiosk";

type SwitchProps = {
  visible: boolean;
  onClose: () => void;
  // Called after a successful switch / kiosk launch so the host can refresh the
  // session and navigate back to the dashboard.
  onSwitched: () => void;
};

// "Switch To..." + "Kiosk Mode" — mirrors the web ProfileMenu picker. The
// "Switch To" tab swaps the session into a single child profile (guardian PIN,
// with first-time setup). The "Kiosk Mode" tab multi-selects a roster of players
// for a shared-tablet session that any family member can run.
export function MobileSwitchAccountModal({ visible, onClose, onSwitched }: SwitchProps) {
  const { t } = useMobileLocale();
  const [mode, setMode] = React.useState<PickerMode>("switch");
  const [step, setStep] = React.useState<"list" | "pin">("list");
  const [members, setMembers] = React.useState<SwitchableMember[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [kioskInFamily, setKioskInFamily] = React.useState(false);
  const [kioskPinRequired, setKioskPinRequired] = React.useState(false);
  const [kioskSelectedIds, setKioskSelectedIds] = React.useState<string[]>([]);
  const [selected, setSelected] = React.useState<SwitchableMember | null>(null);
  // Earned pillar titles per member, so each tile shows who that child is
  // becoming — the same recognition chips the web profile menu renders.
  const identitiesByUid = useFamilyResponsibilityIdentities(visible);
  // "Switch To..." only accepts child profiles; Kiosk Mode accepts parents too,
  // so each tab renders its own eligible roster off the same fetch.
  const visibleMembers = React.useMemo(
    () => (mode === "kiosk" ? selectableKioskMembers(members) : selectableSwitchMembers(members)),
    [members, mode],
  );
  const [pin, setPin] = React.useState("");
  const [confirmPin, setConfirmPin] = React.useState("");
  const [requiresPinSetup, setRequiresPinSetup] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [memberList, kiosk] = await Promise.all([
        fetchSwitchableMembers(),
        fetchKioskStatus().catch(() => null),
      ]);
      setMembers(memberList);
      setKioskInFamily(kiosk?.inFamily ?? false);
      setKioskPinRequired(kiosk?.pinRequired ?? false);
    } catch (loadErr) {
      setMembers([]);
      setLoadError(loadErr instanceof Error ? loadErr.message : "switchable_members_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (visible) {
      setMode("switch");
      setStep("list");
      setSelected(null);
      setKioskSelectedIds([]);
      setPin("");
      setConfirmPin("");
      setRequiresPinSetup(false);
      setError("");
      void load();
    }
  }, [visible, load]);

  function openSwitchPinStep(member: SwitchableMember) {
    setSelected(member);
    setPin("");
    setConfirmPin("");
    setRequiresPinSetup(false);
    setError("");
    setStep("pin");
  }

  function toggleKioskSelection(memberId: string) {
    setKioskSelectedIds((current) =>
      current.includes(memberId) ? current.filter((id) => id !== memberId) : [...current, memberId],
    );
  }

  async function launchKiosk(kioskPin: string) {
    if (kioskSelectedIds.length === 0 || pending) {
      return;
    }
    setPending(true);
    setError("");
    try {
      await startKiosk(kioskSelectedIds, kioskPin);
      onSwitched();
    } catch (kioskErr) {
      setError(kioskErr instanceof Error ? kioskErr.message : "kiosk_start_failed");
    } finally {
      setPending(false);
    }
  }

  function onStartKioskPressed() {
    if (kioskSelectedIds.length === 0) {
      return;
    }
    if (kioskPinRequired) {
      setPin("");
      setError("");
      setStep("pin");
    } else {
      void launchKiosk("");
    }
  }

  async function onConfirmSwitch() {
    if (!selected || pending) {
      return;
    }
    setPending(true);
    setError("");
    try {
      if (requiresPinSetup) {
        await setupAccountSwitchPin(pin, confirmPin);
      }
      await startAccountSwitch(selected.id, pin);
      onSwitched();
    } catch (switchErr) {
      const code = switchErr instanceof Error ? switchErr.message : "switch_account_failed";
      if (code === "pin_not_configured") {
        setRequiresPinSetup(true);
        setError("");
      } else {
        setError(code);
      }
    } finally {
      setPending(false);
    }
  }

  // PIN step is shared by the two flows; `mode` decides which action it confirms.
  const isKioskPin = mode === "kiosk";
  const confirmLabel = pending
    ? isKioskPin
      ? t("kiosk.checking")
      : t("profileMenu.checking")
    : isKioskPin
      ? t("kiosk.enterAction")
      : requiresPinSetup
        ? t("profileMenu.setupAndSwitchAction")
        : t("profileMenu.switchAction");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>{t("nav.switchTo")}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          {step === "list" ? (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
              {kioskInFamily ? (
                <View style={styles.tabs}>
                  {(["switch", "kiosk"] as const).map((value) => {
                    const active = mode === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                        onPress={() => {
                          setMode(value);
                          setError("");
                        }}
                        style={[styles.tab, active && styles.tabActive]}>
                        <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                          {value === "switch" ? t("nav.switchTo") : t("nav.kioskMode")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <Text style={styles.intro}>
                {mode === "kiosk" ? t("kiosk.selectPlayerBody") : t("profileMenu.switchChildBody")}
              </Text>

              {loadError ? (
                <Text style={styles.error}>{t("profileMenu.switchLoadError", { error: loadError })}</Text>
              ) : null}
              {mode === "kiosk" && error ? (
                <Text style={styles.error}>{t("kiosk.startError", { error })}</Text>
              ) : null}
              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.brand} />
                  <Text style={styles.loadingText}>{t("profileMenu.loadingChildProfiles")}</Text>
                </View>
              ) : null}
              {!loading && !loadError && visibleMembers.length === 0 ? (
                <Text style={styles.intro}>
                  {mode === "kiosk" ? t("kiosk.noPlayers") : t("profileMenu.noChildProfiles")}
                </Text>
              ) : null}
              {!loading
                ? visibleMembers.map((member) => {
                    const checked = kioskSelectedIds.includes(member.id);
                    return (
                      <Pressable
                        key={member.id}
                        accessibilityRole="button"
                        accessibilityState={mode === "kiosk" ? { selected: checked } : undefined}
                        onPress={() =>
                          mode === "kiosk" ? toggleKioskSelection(member.id) : openSwitchPinStep(member)
                        }
                        style={({ pressed }) => [
                          styles.memberRow,
                          mode === "kiosk" && checked && styles.memberRowSelected,
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
                            {member.status === "active"
                              ? t("profileMenu.readyToSwitch")
                              : t("profileMenu.invitePending")}
                          </Text>
                          {member.uid && identitiesByUid[member.uid] ? (
                            <MobileIdentitySummaryStrip
                              identities={identitiesByUid[member.uid]}
                              limit={2}
                              variant="chips"
                            />
                          ) : null}
                        </View>
                        {mode === "kiosk" ? (
                          <View style={[styles.check, checked && styles.checkOn]}>
                            <Text style={styles.checkMark}>{checked ? "✓" : ""}</Text>
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })
                : null}
            </ScrollView>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
              <Text style={styles.intro}>
                {isKioskPin
                  ? t("kiosk.enterBody")
                  : requiresPinSetup
                    ? t("profileMenu.setupPinPrompt", { name: selected?.name ?? "" })
                    : t("profileMenu.switchPinPrompt", { name: selected?.name ?? "" })}
              </Text>
              <Text style={styles.label}>{t("profileMenu.pinLabel")}</Text>
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
              {!isKioskPin && requiresPinSetup ? (
                <>
                  <Text style={styles.label}>{t("profileMenu.confirmPinLabel")}</Text>
                  <TextInput
                    value={confirmPin}
                    onChangeText={(value) => setConfirmPin(normalizePin(value))}
                    keyboardType="number-pad"
                    secureTextEntry
                    maxLength={4}
                    placeholder="••••"
                    placeholderTextColor={colors.muted}
                    style={styles.input}
                  />
                </>
              ) : null}
              {error ? (
                <Text style={styles.error}>
                  {isKioskPin
                    ? t("kiosk.startError", { error })
                    : t("profileMenu.switchError", { error })}
                </Text>
              ) : null}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button
                label={step === "pin" ? t("common.actions.back") : t("common.actions.close")}
                variant="secondary"
                disabled={pending}
                onPress={() => (step === "pin" ? setStep("list") : onClose())}
              />
            </View>
            {step === "pin" ? (
              <View style={styles.actionButton}>
                <Button
                  label={confirmLabel}
                  onPress={() => (isKioskPin ? void launchKiosk(pin) : void onConfirmSwitch())}
                  disabled={pending || pin.length < 4}
                />
              </View>
            ) : mode === "kiosk" ? (
              <View style={styles.actionButton}>
                <Button
                  label={pending ? t("kiosk.checking") : t("kiosk.enterAction")}
                  onPress={onStartKioskPressed}
                  disabled={pending || kioskSelectedIds.length === 0}
                />
              </View>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type ReturnProps = {
  visible: boolean;
  parentName: string;
  onClose: () => void;
  onReturned: () => void;
};

// "Return to Parent" — exit a switched (single child) session back to the
// original guardian account by re-entering the guardian PIN.
export function MobileReturnToParentModal({ visible, parentName, onClose, onReturned }: ReturnProps) {
  const { t } = useMobileLocale();
  const [pin, setPin] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (visible) {
      setPin("");
      setError("");
    }
  }, [visible]);

  async function onConfirm() {
    if (pending) {
      return;
    }
    setPending(true);
    setError("");
    try {
      await stopAccountSwitch(pin);
      onReturned();
    } catch (returnErr) {
      setError(returnErr instanceof Error ? returnErr.message : "restore_account_failed");
    } finally {
      setPending(false);
    }
  }

  const account = parentName || t("profile.accountFallback");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>{t("nav.returnToParent")}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
            <Text style={styles.intro}>{t("profileMenu.returnToParentBody", { account })}</Text>
            <Text style={styles.label}>{t("profileMenu.pinLabel")}</Text>
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
            {error ? <Text style={styles.error}>{t("profileMenu.returnError", { error })}</Text> : null}
          </ScrollView>
          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button
                label={t("common.actions.cancel")}
                variant="secondary"
                disabled={pending}
                onPress={onClose}
              />
            </View>
            <View style={styles.actionButton}>
              <Button
                label={pending ? t("profileMenu.checking") : t("nav.returnToParent")}
                onPress={onConfirm}
                disabled={pending || pin.length < 4}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const switchAccountStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.35)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  sheet: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "88%",
    borderRadius: radius.lg,
    backgroundColor: "#ffffff",
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.text, fontSize: typography.h3, fontWeight: "900", flex: 1 },
  close: { color: colors.muted, fontSize: 26, fontWeight: "700", paddingHorizontal: spacing.xs },
  body: { flexGrow: 0 },
  intro: { color: colors.muted, fontSize: typography.body, marginBottom: spacing.sm },
  label: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "700",
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    color: colors.text,
    fontSize: typography.body,
    letterSpacing: 6,
  },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  loadingText: { color: colors.muted, fontSize: typography.body },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.accentSoft,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.xs,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  tabActive: { backgroundColor: colors.brand, borderWidth: 1, borderColor: colors.brand },
  tabLabel: { fontSize: typography.small, fontWeight: "800", color: colors.muted },
  tabLabelActive: { color: "#ffffff" },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
    backgroundColor: colors.accentSoft,
  },
  memberRowSelected: { borderColor: colors.brand, backgroundColor: "#e8f5ff" },
  memberRowPressed: { backgroundColor: "#eef6ff" },
  memberCopy: { flex: 1, gap: 2 },
  memberName: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  memberMeta: { color: colors.muted, fontSize: typography.tiny },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkMark: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  error: { color: "#b91c1c", fontSize: typography.small, marginTop: spacing.sm, fontWeight: "700" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  actionButton: { flex: 1 },
});

const styles = switchAccountStyles;
