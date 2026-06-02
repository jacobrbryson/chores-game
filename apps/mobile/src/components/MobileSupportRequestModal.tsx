import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { apiFetch } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { Button } from "@/components/ui/Button";
import { colors, radius, spacing, typography } from "@/theme";

type SupportRequestType = "bug" | "feature";
type Severity = "low" | "medium" | "high";

const SEVERITIES: Severity[] = ["low", "medium", "high"];
const MAX_SUBJECT = 150;
const MAX_DESCRIPTION = 4000;

type Props = {
  visible: boolean;
  type: SupportRequestType;
  currentRoute?: string;
  onClose: () => void;
};

export function MobileSupportRequestModal({ visible, type, currentRoute = "", onClose }: Props) {
  const { t } = useMobileLocale();
  const isBug = type === "bug";
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [severity, setSeverity] = React.useState<Severity>("medium");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    if (visible) {
      setSubject("");
      setDescription("");
      setSeverity("medium");
      setError("");
      setSuccess(false);
    }
  }, [visible]);

  function localizedError(code: string) {
    const key = `support.errors.${code}`;
    const message = t(key);
    return message === key ? t("support.errors.generic") : message;
  }

  async function onSubmit() {
    if (submitting) {
      return;
    }
    const trimmedSubject = subject.trim();
    const trimmedDescription = description.trim();
    if (!trimmedSubject) {
      setError(localizedError("subject_required"));
      return;
    }
    if (!trimmedDescription) {
      setError(localizedError("description_required"));
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      await apiFetch("/support/requests", {
        method: "POST",
        body: JSON.stringify({
          type,
          subject: trimmedSubject,
          description: trimmedDescription,
          severity: isBug ? severity : undefined,
          pageUrl: currentRoute,
        }),
      });
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (submitError) {
      const code = submitError instanceof Error ? submitError.message : "generic";
      setError(localizedError(code));
    } finally {
      setSubmitting(false);
    }
  }

  const title = isBug ? t("support.bug.title") : t("support.feature.title");
  const intro = isBug ? t("support.bug.intro") : t("support.feature.intro");

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
            <Text style={styles.intro}>{intro}</Text>

            <Text style={styles.label}>{t("support.subjectLabel")}</Text>
            <TextInput
              value={subject}
              onChangeText={setSubject}
              maxLength={MAX_SUBJECT}
              placeholder={t("support.subjectPlaceholder")}
              placeholderTextColor={colors.muted}
              style={styles.input}
            />

            {isBug ? (
              <>
                <Text style={styles.label}>{t("support.severityLabel")}</Text>
                <View style={styles.severityRow}>
                  {SEVERITIES.map((value) => {
                    const selected = severity === value;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="button"
                        onPress={() => setSeverity(value)}
                        style={[styles.severityChip, selected && styles.severityChipSelected]}>
                        <Text
                          style={[styles.severityText, selected && styles.severityTextSelected]}>
                          {t(`support.severity.${value}`)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <Text style={styles.label}>{t("support.descriptionLabel")}</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              maxLength={MAX_DESCRIPTION}
              placeholder={t("support.descriptionPlaceholder")}
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={5}
              style={[styles.input, styles.textarea]}
            />

            {currentRoute ? (
              <>
                <Text style={styles.label}>{t("support.currentPageLabel")}</Text>
                <Text style={styles.routeText}>{currentRoute}</Text>
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {success ? <Text style={styles.success}>{t("support.successToast")}</Text> : null}
          </ScrollView>
          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button label={t("common.actions.cancel")} variant="secondary" onPress={onClose} disabled={submitting} />
            </View>
            <View style={styles.actionButton}>
              <Button
                label={submitting ? t("support.submitting") : t("support.submit")}
                onPress={onSubmit}
                disabled={submitting || success}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  },
  textarea: { minHeight: 110, textAlignVertical: "top" },
  severityRow: { flexDirection: "row", gap: spacing.xs },
  severityChip: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  severityChipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  severityText: { color: colors.brandStrong, fontWeight: "800", fontSize: typography.small },
  severityTextSelected: { color: "#ffffff" },
  routeText: { color: colors.muted, fontSize: typography.small },
  error: { color: "#b91c1c", fontSize: typography.small, marginTop: spacing.sm, fontWeight: "700" },
  success: { color: "#15803d", fontSize: typography.small, marginTop: spacing.sm, fontWeight: "700" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  actionButton: { flex: 1 },
});
