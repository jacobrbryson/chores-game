import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button, Card } from "@/components/ui";
import {
  fetchMobileFamilySummary,
  joinFamilyWithInviteCode,
  ServerUnreachableError,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import type { TranslationKey } from "@packages/locales";
import { colors, radius, spacing, typography } from "@/theme";

const CODE_LENGTH = 12;
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Mirrors `lib/family/invite-code-format` on the web. Duplicated rather than
 * shared because the mobile app does not depend on the web package, and the
 * server re-normalizes anyway — this only shapes what the user sees as they type.
 */
function normalizeCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .slice(0, CODE_LENGTH);
}

function formatCode(value: string) {
  return (normalizeCode(value).match(/.{1,4}/g) ?? []).join("-");
}

function isCompleteCode(value: string) {
  const normalized = normalizeCode(value);
  return (
    normalized.length === CODE_LENGTH &&
    [...normalized].every((character) => CODE_ALPHABET.includes(character))
  );
}

/** Maps the API's stable error codes onto localized copy. */
const ERROR_KEY_BY_CODE = {
  invalid_code: "joinFamily.errors.invalidCode",
  invite_not_found: "joinFamily.errors.inviteNotFound",
  invite_already_used: "joinFamily.errors.inviteAlreadyUsed",
  invite_revoked: "joinFamily.errors.inviteRevoked",
  invite_expired: "joinFamily.errors.inviteExpired",
  invite_locked: "joinFamily.errors.inviteLocked",
  already_in_another_family: "joinFamily.errors.alreadyInAnotherFamily",
  family_member_limit_reached: "joinFamily.errors.familyMemberLimitReached",
  unauthorized: "joinFamily.errors.unauthorized",
} as const satisfies Record<string, TranslationKey>;

/**
 * Shown on the dashboard when the signed-in account did not resolve to a
 * family. Without it, an Apple Hide My Email sign-in has no way into the family
 * that invited them.
 */
export function MobileJoinFamilyPanel({ onJoined }: { onJoined?: () => void }) {
  const { t } = useMobileLocale();
  const [visible, setVisible] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const checkFamily = useCallback(async () => {
    try {
      const summary = await fetchMobileFamilySummary();
      setVisible(Boolean(summary.noFamily));
    } catch {
      // A failed summary fetch is the chores panel's error to report, not this
      // panel's; staying hidden avoids showing two errors for one failure.
      setVisible(false);
    }
  }, []);

  useEffect(() => {
    void checkFamily();
  }, [checkFamily]);

  async function onSubmit() {
    if (submitting || !isCompleteCode(code)) return;
    setSubmitting(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const result = await joinFamilyWithInviteCode(normalizeCode(code));
      setSuccessMessage(
        result.alreadyMember
          ? t("joinFamily.alreadyMember")
          : result.familyName
            ? t("joinFamily.success", { family: result.familyName })
            : t("joinFamily.successGeneric"),
      );
      setVisible(false);
      onJoined?.();
    } catch (error) {
      if (error instanceof ServerUnreachableError) {
        setErrorMessage(t("auth.serverUnreachable"));
      } else {
        const reason = error instanceof Error ? error.message : "";
        setErrorMessage(
          t(
            ERROR_KEY_BY_CODE[reason as keyof typeof ERROR_KEY_BY_CODE] ??
              "joinFamily.errors.failed",
          ),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (successMessage) {
    return (
      <Card>
        <Text style={styles.success}>{successMessage}</Text>
      </Card>
    );
  }

  if (!visible) {
    return null;
  }

  return (
    <Card>
      <Text style={styles.title}>{t("joinFamily.title")}</Text>
      <Text style={styles.description}>{t("joinFamily.description")}</Text>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <Text style={styles.label}>{t("joinFamily.codeLabel")}</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(value) => setCode(formatCode(value))}
        placeholder={t("joinFamily.codePlaceholder")}
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={14}
        editable={!submitting}
        accessibilityLabel={t("joinFamily.codeLabel")}
      />
      <Button
        label={submitting ? t("joinFamily.submitting") : t("joinFamily.submit")}
        onPress={() => void onSubmit()}
        disabled={submitting || !isCompleteCode(code)}
      />
      <Text style={styles.help}>{t("joinFamily.help")}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.title, fontWeight: "800", color: colors.text },
  description: { fontSize: typography.body, color: colors.muted },
  label: { fontSize: typography.small, fontWeight: "700", color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.title,
    letterSpacing: 3,
    textAlign: "center",
    color: colors.text,
  },
  help: { fontSize: typography.small, color: colors.muted },
  error: { fontSize: typography.body, color: colors.danger, fontWeight: "600" },
  success: { fontSize: typography.body, color: colors.text, fontWeight: "700" },
});
