import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LOCALE_LABELS, SUPPORTED_LOCALES, type AppLocale } from "@packages/locales";
import {
  apiClient,
  apiFetch,
  claimMobileProfileAward,
  fetchMobileProfileSummary,
  patchMobileProfile,
  type MobileProfileSummary,
} from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";
import { colors, spacing, typography } from "@/theme";
import { AppScreen, AvatarBadge, Button, Card, CoinPill, ErrorState, LoadingState, SectionHeader } from "@/components/ui";
import { MobileProfileFamilySummary } from "@/components/MobileProfileFamilySummary";

type ProfileData = {
  name: string;
  email: string;
  role: string;
  balance: number;
  avatarUrl: string;
  achievementCount: number;
  locale: AppLocale;
};

type MeResponse = {
  uid: string;
  memberId?: string;
  name: string;
  email: string;
  role: string;
  locale?: AppLocale;
  resolvedLocale?: AppLocale;
  picture?: string;
  avatarUrl?: string;
  balance?: number;
};

type Props = {
  right?: React.ReactNode;
  onGoDashboard?: () => void;
};

export function ProfileScreen({ right, onGoDashboard }: Props) {
  const { t, setLocale } = useMobileLocale();
  const [state, setState] = useState<{ loading: boolean; error?: string; data: ProfileData | null }>({ loading: true, data: null });
  const [familySummary, setFamilySummary] = useState<MobileProfileSummary | null>(null);
  const [familySummaryError, setFamilySummaryError] = useState("");
  const [claimingAwardId, setClaimingAwardId] = useState("");
  const [localePending, setLocalePending] = useState(false);
  const [localeError, setLocaleError] = useState("");

  useEffect(() => {
    Promise.all([
      apiClient.auth.me().catch(() => null),
      apiFetch("/achievements").catch(() => ({ items: [] })),
      fetchMobileProfileSummary().catch((error: unknown) => {
        setFamilySummaryError(error instanceof Error ? error.message : "profile_family_summary_unavailable");
        return null;
      }),
    ])
      .then(([meRaw, achievements, summary]) => {
        const me = meRaw as MeResponse | null;
        setFamilySummary(summary);
        const count = Array.isArray(achievements?.items) ? achievements.items.filter((a: any) => a.completed).length : 0;
        if (!me) {
          setState({ loading: false, error: "unauthorized", data: null });
          return;
        }
        setState({
          loading: false,
          data: {
            name: me.name || t("profile.signedIn"),
            email: me.email || "",
            role: me.role || "player",
            balance: typeof me.balance === "number" ? me.balance : 0,
            avatarUrl: me.avatarUrl || me.picture || "",
            achievementCount: count,
            locale: me.resolvedLocale || me.locale || "en-US",
          },
        });
      })
      .catch((err: unknown) => {
        setState({ loading: false, error: err instanceof Error ? err.message : "profile_unavailable", data: null });
      });
  }, [t]);

  async function onChangeLocale(nextLocale: AppLocale) {
    if (!state.data || localePending || state.data.locale === nextLocale) {
      return;
    }
    setLocalePending(true);
    setLocaleError("");
    try {
      await patchMobileProfile({ locale: nextLocale });
      setState((current) =>
        current.data
          ? { ...current, data: { ...current.data, locale: nextLocale } }
          : current,
      );
      setLocale(nextLocale);
    } catch {
      setLocaleError(t("profile.languageSaveError"));
    } finally {
      setLocalePending(false);
    }
  }

  async function onClaimAward(awardId: string) {
    if (claimingAwardId) {
      return;
    }
    setClaimingAwardId(awardId);
    setFamilySummaryError("");
    try {
      await claimMobileProfileAward(awardId);
      setFamilySummary(await fetchMobileProfileSummary());
    } catch (error) {
      setFamilySummaryError(error instanceof Error ? error.message : "claim_award_failed");
    } finally {
      setClaimingAwardId("");
    }
  }

  return (
    <AppScreen
      title={t("nav.profile")}
      subtitle={t("profile.accountSubtitle")}
      right={right}
      onPressBreadcrumbRoot={onGoDashboard}>
      {state.loading ? <LoadingState label={t("profile.loadingProfile")} /> : null}
      {state.error ? <ErrorState message={t("profile.loadError", { error: state.error })} /> : null}
      {!state.loading && !state.error && state.data ? (
        <>
          <Card>
            <View style={styles.topRow}>
              <AvatarBadge name={state.data.name} imageUrl={state.data.avatarUrl} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{state.data.name}</Text>
                <Text style={styles.email}>{state.data.email || t("common.labels.none")}</Text>
              </View>
              <CoinPill value={state.data.balance} />
            </View>
          </Card>

          <Card>
            <SectionHeader title={t("profile.detailsTitle")} />
            <Text style={styles.detail}>{t("profile.role")}: {state.data.role}</Text>
            <Text style={styles.detail}>{t("profile.achievementsUnlocked", { count: state.data.achievementCount })}</Text>
            <Text style={styles.detail}>{t("common.labels.language")}:</Text>
            <View style={styles.languageWrap}>
              {SUPPORTED_LOCALES.map((option) => (
                <Button
                  key={option}
                  label={LOCALE_LABELS[option]}
                  variant={state.data?.locale === option ? "primary" : "secondary"}
                  disabled={localePending}
                  onPress={() => void onChangeLocale(option)}
                />
              ))}
            </View>
            {localeError ? <Text style={styles.error}>{localeError}</Text> : null}
          </Card>

          {familySummaryError ? <ErrorState message={t("profile.familySummaryLoadError", { error: familySummaryError })} /> : null}
          <MobileProfileFamilySummary
            summary={familySummary}
            claimingAwardId={claimingAwardId}
            onClaimAward={(awardId) => void onClaimAward(awardId)}
          />
        </>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { fontSize: typography.h3, fontWeight: "800", color: colors.text },
  email: { fontSize: typography.small, color: colors.muted },
  detail: { fontSize: typography.body, color: colors.text },
  languageWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  error: { fontSize: typography.small, color: "#b91c1c" },
});
