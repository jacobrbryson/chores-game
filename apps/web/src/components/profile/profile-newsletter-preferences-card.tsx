"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";

type NewsletterPreferencesResponse = {
  weeklyFamilyHighlightsEmail: boolean;
};

export function ProfileNewsletterPreferencesCard() {
  const { t } = useLocale();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/newsletter/preferences", { cache: "no-store" });
        const payload = (await response.json()) as NewsletterPreferencesResponse & { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? `NEWSLETTER_PREFERENCES_HTTP_${response.status}`);
        }
        if (!cancelled) {
          setEnabled(payload.weeklyFamilyHighlightsEmail === true);
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

  async function onToggle() {
    if (saving || loading) {
      return;
    }
    const nextValue = !enabled;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/newsletter/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklyFamilyHighlightsEmail: nextValue }),
      });
      const payload = (await response.json()) as { error?: string; weeklyFamilyHighlightsEmail?: boolean };
      if (!response.ok) {
        throw new Error(payload.error ?? `NEWSLETTER_PREFERENCES_PATCH_HTTP_${response.status}`);
      }
      setEnabled(payload.weeklyFamilyHighlightsEmail === true);
      setSuccess(t(nextValue ? "profile.newsletter.enabledSuccess" : "profile.newsletter.disabledSuccess"));
    } catch (errorValue) {
      setError(
        t("profile.newsletter.saveError", {
          error: errorValue instanceof Error ? errorValue.message : "unknown",
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      id="newsletter-preferences"
      aria-label={t("profile.newsletter.title")}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="family-page-card-header">
        <div>
          <h2>{t("profile.newsletter.title")}</h2>
          <p className="small family-page-subhead">{t("profile.newsletter.description")}</p>
        </div>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {success ? <p className="small text-emerald-700">{success}</p> : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">{t("profile.newsletter.weeklyFamilyHighlightsEmail")}</p>
          <p className="small text-slate-600">
            {loading
              ? t("profile.newsletter.loading")
              : enabled
                ? t("profile.newsletter.enabled")
                : t("profile.newsletter.disabled")}
          </p>
        </div>
        <Button
          type="button"
          className={`btn ${enabled ? "btn-secondary" : "btn-primary"}`}
          disabled={loading || saving}
          onClick={onToggle}>
          {saving
            ? t("profile.newsletter.saving")
            : enabled
              ? t("profile.newsletter.turnOff")
              : t("profile.newsletter.turnOn")}
        </Button>
      </div>
    </section>
  );
}
