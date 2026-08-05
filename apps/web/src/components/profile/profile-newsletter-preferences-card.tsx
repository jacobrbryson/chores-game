"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

type EmailPreferenceKey = "weeklyFamilyHighlightsEmail" | "familyFriendInviteEmail";

type NewsletterPreferencesResponse = Record<EmailPreferenceKey, boolean>;

type EmailPreferenceRow = {
  key: EmailPreferenceKey;
  labelKey: string;
  enabledKey: string;
  disabledKey: string;
  enabledSuccessKey: string;
  disabledSuccessKey: string;
  hintKey?: string;
};

const PREFERENCE_ROWS: EmailPreferenceRow[] = [
  {
    key: "weeklyFamilyHighlightsEmail",
    labelKey: "profile.newsletter.weeklyFamilyHighlightsEmail",
    enabledKey: "profile.newsletter.enabled",
    disabledKey: "profile.newsletter.disabled",
    enabledSuccessKey: "profile.newsletter.enabledSuccess",
    disabledSuccessKey: "profile.newsletter.disabledSuccess",
  },
  {
    key: "familyFriendInviteEmail",
    labelKey: "profile.newsletter.familyFriendInviteEmail",
    enabledKey: "profile.newsletter.familyFriendInviteEnabled",
    disabledKey: "profile.newsletter.familyFriendInviteDisabled",
    enabledSuccessKey: "profile.newsletter.familyFriendInviteEnabledSuccess",
    disabledSuccessKey: "profile.newsletter.familyFriendInviteDisabledSuccess",
    hintKey: "profile.newsletter.familyFriendInviteHint",
  },
];

export function ProfileNewsletterPreferencesCard() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<EmailPreferenceKey | "">("");
  const [preferences, setPreferences] = useState<NewsletterPreferencesResponse>({
    weeklyFamilyHighlightsEmail: false,
    familyFriendInviteEmail: false,
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/newsletter/preferences", { cache: "no-store" });
        const payload = (await response.json()) as Partial<NewsletterPreferencesResponse> & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? `NEWSLETTER_PREFERENCES_HTTP_${response.status}`);
        }
        if (!cancelled) {
          setPreferences({
            weeklyFamilyHighlightsEmail: payload.weeklyFamilyHighlightsEmail === true,
            familyFriendInviteEmail: payload.familyFriendInviteEmail === true,
          });
        }
      } catch (errorValue) {
        if (!cancelled) {
          setError(errorValue instanceof Error ? errorValue.message : "newsletter_preferences_unavailable");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggle(row: EmailPreferenceRow) {
    if (savingKey || loading) {
      return;
    }
    const nextValue = !preferences[row.key];
    setSavingKey(row.key);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/newsletter/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [row.key]: nextValue }),
      });
      const payload = (await response.json()) as Partial<NewsletterPreferencesResponse> & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `NEWSLETTER_PREFERENCES_PATCH_HTTP_${response.status}`);
      }
      setPreferences({
        weeklyFamilyHighlightsEmail: payload.weeklyFamilyHighlightsEmail === true,
        familyFriendInviteEmail: payload.familyFriendInviteEmail === true,
      });
      setSuccess(t(nextValue ? row.enabledSuccessKey : row.disabledSuccessKey));
    } catch (errorValue) {
      setError(
        t("profile.newsletter.saveError", {
          error: errorValue instanceof Error ? errorValue.message : "unknown",
        }),
      );
    } finally {
      setSavingKey("");
    }
  }

  return (
    <section id="newsletter-preferences" aria-label={t("profile.notifications.emailTitle")} className="space-y-4">
      <div className="family-page-card-header">
        <div>
          <h3>{t("profile.notifications.emailTitle")}</h3>
          <p className="small family-page-subhead">{t("profile.notifications.emailDescription")}</p>
        </div>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {success ? <p className="small text-emerald-700">{success}</p> : null}
      <div className="mt-4 flex flex-col gap-5">
        {PREFERENCE_ROWS.map((row) => {
          const enabled = preferences[row.key];
          return (
            <div key={row.key} className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900">{t(row.labelKey)}</p>
                <p className="small text-slate-600">
                  {loading
                    ? t("profile.newsletter.loading")
                    : enabled
                      ? t(row.enabledKey)
                      : t(row.disabledKey)}
                </p>
                {row.hintKey ? <p className="small text-slate-500">{t(row.hintKey)}</p> : null}
              </div>
              <Button
                type="button"
                className={`btn ${enabled ? "btn-secondary" : "btn-primary"}`}
                disabled={loading || Boolean(savingKey)}
                onClick={() => void onToggle(row)}>
                {savingKey === row.key
                  ? t("profile.newsletter.saving")
                  : enabled
                    ? t("profile.newsletter.turnOff")
                    : t("profile.newsletter.turnOn")}
              </Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
