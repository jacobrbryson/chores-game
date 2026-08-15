import React, { useCallback, useEffect, useState } from "react";
import { Modal, Share, StyleSheet, Text, View } from "react-native";
import {
  cancelMobileFamilyDeletion,
  fetchMobileFamilyDataExport,
  fetchMobileFamilyPrivacy,
  recordMobileFamilyConsent,
  requestMobileFamilyDeletion,
  type MobilePrivacyState,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, radius, spacing, typography } from "@/theme";
import { Button, Card, ErrorState, LoadingState, SectionHeader } from "@/components/ui";

function formatDateTime(value: string, locale: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString(locale);
}

function formatDate(value: string, locale: string) {
  if (!value) {
    return "-";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString(locale);
}

// Privacy & consent for the mobile Manage Family screen — the counterpart of
// web's FamilyPrivacyTab. Covers the consent overview, the stored-data summary,
// recording/updating parental consent, the data export, and the 30-day-grace
// deletion request.
//
// One deliberate difference from web: mobile has no download destination, so the
// export is handed to the OS share sheet instead of saving a .json file.
export function MobileFamilyPrivacyPanel({ isAdmin }: { isAdmin: boolean }) {
  const { locale, t } = useMobileLocale();
  const [data, setData] = useState<MobilePrivacyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"" | "export" | "deletion" | "consent">("");
  const [pendingDeletion, setPendingDeletion] = useState(false);
  const [consentPrompt, setConsentPrompt] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await fetchMobileFamilyPrivacy());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "privacy_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function shareExport() {
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const payload = await fetchMobileFamilyDataExport();
      await Share.share({ message: JSON.stringify(payload, null, 2) });
      setNotice(t("family.privacy.exportStarted"));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "export_failed");
    } finally {
      setBusy("");
    }
  }

  async function recordConsent() {
    setConsentPrompt(false);
    setBusy("consent");
    setError("");
    setNotice("");
    try {
      await recordMobileFamilyConsent();
      setNotice(t("family.privacy.consentRecorded"));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "consent_failed");
    } finally {
      setBusy("");
    }
  }

  async function requestDeletion() {
    setPendingDeletion(false);
    setBusy("deletion");
    setError("");
    setNotice("");
    try {
      await requestMobileFamilyDeletion();
      setNotice(t("family.privacy.deletionScheduledNotice"));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "request_deletion_failed");
    } finally {
      setBusy("");
    }
  }

  async function cancelDeletion() {
    setBusy("deletion");
    setError("");
    setNotice("");
    try {
      await cancelMobileFamilyDeletion();
      setNotice(t("family.privacy.deletionCanceledNotice"));
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "cancel_deletion_failed");
    } finally {
      setBusy("");
    }
  }

  if (!isAdmin) {
    return (
      <Card>
        <Text style={styles.help}>{t("family.privacy.adminOnly")}</Text>
      </Card>
    );
  }

  if (loading) {
    return <LoadingState label={t("common.actions.loading")} />;
  }

  if (error && !data) {
    return <ErrorState message={t("family.privacy.loadError", { error })} />;
  }

  if (!data) {
    return null;
  }

  const { overview, dataSummary } = data;
  const deletionRequested = Boolean(overview.deletionRequestedAt);
  const hasPreviousVersionedConsent = Boolean(
    overview.parentalConsentAt || overview.acceptedTermsVersion || overview.acceptedPrivacyVersion,
  );

  return (
    <>
      {error ? <ErrorState message={error} /> : null}
      {notice ? (
        <Card style={styles.noticeCard}>
          <Text style={styles.noticeText}>{notice}</Text>
        </Card>
      ) : null}

      {/* 1. Privacy Overview */}
      <Card>
        <SectionHeader title={t("family.privacy.overviewTitle")} />
        {!overview.consentUpToDate ? (
          <View style={styles.warnBanner}>
            <Text style={styles.warnText}>{t("family.privacy.consentNeeded")}</Text>
          </View>
        ) : null}
        <View style={styles.fieldList}>
          <Field label={t("family.privacy.acceptedVersion")} value={overview.acceptedLegalVersion || "-"} />
          <Field label={t("family.privacy.currentVersion")} value={overview.currentLegalVersion || "-"} />
          <Field
            label={t("family.privacy.acceptedAt")}
            value={formatDateTime(overview.parentalConsentAt, locale)}
          />
          <Field
            label={t("family.privacy.parentalConsentBy")}
            value={overview.parentalConsentByDisplayName || overview.parentalConsentByUserId || "-"}
          />
          <Field
            label={t("family.privacy.familyCreatedAt")}
            value={formatDate(overview.familyCreatedAt, locale)}
          />
          <Field
            label={t("family.privacy.lastActivityAt")}
            value={formatDateTime(overview.lastActivityAt, locale)}
          />
          <Field
            label={t("family.privacy.consentStatus")}
            value={
              overview.consentUpToDate
                ? t("family.privacy.consentStatusCurrent")
                : t("family.privacy.consentStatusOutdated")
            }
          />
        </View>
        {!overview.consentUpToDate ? (
          <Button
            label={t(
              busy === "consent"
                ? "family.privacy.saving"
                : hasPreviousVersionedConsent
                  ? "family.privacy.updateConsent"
                  : "family.privacy.recordConsent",
            )}
            disabled={busy === "consent"}
            onPress={() => setConsentPrompt(true)}
          />
        ) : null}
      </Card>

      {/* 2. Family Data Summary */}
      <Card>
        <SectionHeader title={t("family.privacy.summaryTitle")} />
        <Text style={styles.help}>{t("family.privacy.summaryHelp")}</Text>
        <View style={styles.summaryList}>
          {dataSummary.categories.map((category) => (
            <View key={category.key} style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t(`family.privacy.summary.${category.key}`)}</Text>
              <Text style={styles.summaryValue}>
                {category.count === null ? t("family.privacy.summaryTracked") : category.count}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {/* 3. Export Family Data */}
      <Card>
        <SectionHeader title={t("family.privacy.downloadTitle")} />
        <Text style={styles.help}>{t("family.privacy.shareExportHelp")}</Text>
        <Button
          label={t(busy === "export" ? "family.privacy.preparing" : "family.privacy.shareExport")}
          variant="secondary"
          disabled={busy === "export"}
          onPress={() => void shareExport()}
        />
      </Card>

      {/* 4. Delete Family Data Request */}
      <Card>
        <SectionHeader title={t("family.privacy.deletionTitle")} />
        {deletionRequested ? (
          <>
            <View style={styles.warnBanner}>
              <Text style={styles.warnText}>
                {t("family.privacy.deletionScheduled", {
                  date: formatDate(overview.deletionScheduledFor, locale),
                })}
              </Text>
            </View>
            <Button
              label={t(busy === "deletion" ? "family.privacy.saving" : "family.privacy.cancelDeletion")}
              variant="secondary"
              disabled={busy === "deletion"}
              onPress={() => void cancelDeletion()}
            />
          </>
        ) : (
          <>
            <Text style={styles.help}>{t("family.privacy.deletionHelp")}</Text>
            <Button
              label={t("family.privacy.requestDeletionAction")}
              variant="secondary"
              disabled={busy === "deletion"}
              onPress={() => setPendingDeletion(true)}
            />
          </>
        )}
      </Card>

      <Modal
        visible={consentPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setConsentPrompt(false)}>
        <View style={styles.backdrop}>
          <View style={styles.confirmSheet}>
            <Text style={styles.sheetTitle}>
              {t(hasPreviousVersionedConsent ? "family.privacy.updateConsent" : "family.privacy.recordConsent")}
            </Text>
            <Text style={styles.confirmText}>{t("family.privacy.consentIntro")}</Text>
            <View style={styles.versionRow}>
              <Text style={styles.versionChip}>
                {`${t("family.privacy.currentTermsVersion")}: ${overview.currentTermsVersion}`}
              </Text>
              <Text style={styles.versionChip}>
                {`${t("family.privacy.currentPrivacyVersion")}: ${overview.currentPrivacyVersion}`}
              </Text>
            </View>
            <Button
              label={t("common.actions.cancel")}
              variant="secondary"
              onPress={() => setConsentPrompt(false)}
            />
            <Button
              label={t(hasPreviousVersionedConsent ? "family.privacy.updateConsent" : "family.privacy.recordConsent")}
              disabled={busy === "consent"}
              onPress={() => void recordConsent()}
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={pendingDeletion}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDeletion(false)}>
        <View style={styles.backdrop}>
          <View style={styles.confirmSheet}>
            <Text style={styles.sheetTitle}>{t("family.privacy.requestDeletion")}</Text>
            <Text style={styles.confirmText}>{t("family.privacy.deletionConfirm")}</Text>
            <Button
              label={t("common.actions.cancel")}
              variant="secondary"
              onPress={() => setPendingDeletion(false)}
            />
            <Button
              label={t("family.privacy.requestDeletion")}
              variant="danger"
              onPress={() => void requestDeletion()}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  help: { color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  noticeCard: { borderColor: "#86efac", backgroundColor: "#f0fdf4" },
  noticeText: { color: "#166534", fontSize: typography.small, fontWeight: "800" },
  warnBanner: {
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: radius.md,
    backgroundColor: "#fffbeb",
    padding: spacing.sm,
  },
  warnText: { color: "#92400e", fontSize: typography.small, fontWeight: "700" },
  fieldList: { gap: spacing.sm },
  field: { gap: 2 },
  fieldLabel: {
    color: colors.muted,
    fontSize: typography.tiny,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  fieldValue: { color: colors.text, fontSize: typography.small, fontWeight: "700" },
  summaryList: { gap: spacing.xs },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  summaryLabel: { flex: 1, color: colors.muted, fontSize: typography.small, fontWeight: "700" },
  summaryValue: { color: colors.text, fontSize: typography.small, fontWeight: "900" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.32)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  confirmSheet: {
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    padding: spacing.lg,
    gap: spacing.md,
  },
  sheetTitle: { color: colors.text, fontSize: typography.h3, fontWeight: "900" },
  confirmText: { color: colors.text, fontSize: typography.body, fontWeight: "600" },
  versionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  versionChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    color: colors.brandStrong,
    fontSize: typography.tiny,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
});
