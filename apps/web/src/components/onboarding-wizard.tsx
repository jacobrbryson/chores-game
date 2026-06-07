"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { Alert } from "@/components/alert";
import { Button } from "@/components/button";
import { useLocale } from "@/components/locale-provider";

// ── Types ──────────────────────────────────────────────────────────────────────

type OnboardingStep =
  | "welcome"
  | "family"
  | "privacy"
  | "addChild"
  | "firstChore"
  | "done";

const STEPS: OnboardingStep[] = [
  "welcome",
  "family",
  "privacy",
  "addChild",
  "firstChore",
  "done",
];

type OnboardingStatus = {
  viewerRole: "admin" | "player";
  needsOnboarding: boolean;
  needsReacceptance: boolean;
};

// ── Progress Indicator ─────────────────────────────────────────────────────────

function ProgressDots({
  steps,
  current,
  labels,
}: {
  steps: OnboardingStep[];
  current: OnboardingStep;
  labels: Record<OnboardingStep, string>;
}) {
  const visibleSteps = steps.filter((s) => s !== "done") as OnboardingStep[];
  const currentIndex = visibleSteps.indexOf(current);
  return (
    <nav
      className="onboarding-progress"
      aria-label="Onboarding progress"
      role="progressbar"
      aria-valuenow={currentIndex + 1}
      aria-valuemin={1}
      aria-valuemax={visibleSteps.length}>
      {visibleSteps.map((step, index) => (
        <span key={step} className="onboarding-progress-item">
          <span
            className={`onboarding-progress-dot${index <= currentIndex ? " is-active" : ""}`}
            aria-label={`Step ${index + 1}: ${labels[step]}${index < currentIndex ? " (complete)" : index === currentIndex ? " (current)" : ""}`}
            role="img"
          />
          {index < visibleSteps.length - 1 ? (
            <span
              className={`onboarding-progress-line${index < currentIndex ? " is-active" : ""}`}
              aria-hidden="true"
            />
          ) : null}
        </span>
      ))}
    </nav>
  );
}

// ── Step: Welcome ──────────────────────────────────────────────────────────────

function WelcomeStep({ onNext, onSignOut }: { onNext: () => void; onSignOut: () => void }) {
  const { t } = useLocale();
  const features: string[] = [
    t("onboarding.welcome.feature1"),
    t("onboarding.welcome.feature2"),
    t("onboarding.welcome.feature3"),
    t("onboarding.welcome.feature4"),
  ];
  return (
    <div className="onboarding-step">
      <div className="onboarding-hero-icon" aria-hidden="true">🏠</div>
      <h1 className="onboarding-title">{t("onboarding.welcome.title")}</h1>
      <p className="onboarding-subtitle">{t("onboarding.welcome.subtitle")}</p>
      <ul className="onboarding-features" role="list">
        {features.map((feature) => (
          <li key={feature} className="onboarding-feature-item">
            <span className="onboarding-feature-check" aria-hidden="true">✓</span>
            {feature}
          </li>
        ))}
      </ul>
      <div className="onboarding-actions">
        <Button type="button" className="btn btn-primary onboarding-cta" onClick={onNext}>
          {t("onboarding.welcome.cta")}
        </Button>
        <Button type="button" className="btn btn-secondary onboarding-secondary" onClick={onSignOut}>
          {t("onboarding.welcome.signOut")}
        </Button>
      </div>
    </div>
  );
}

// ── Step: Family Name ──────────────────────────────────────────────────────────

function FamilyStep({
  familyName,
  onFamilyNameChange,
  onNext,
  saving,
  error,
}: {
  familyName: string;
  onFamilyNameChange: (v: string) => void;
  onNext: () => void;
  saving: boolean;
  error: string;
}) {
  const { t } = useLocale();
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onNext();
  }
  return (
    <div className="onboarding-step">
      <h1 className="onboarding-title">{t("onboarding.family.title")}</h1>
      <p className="onboarding-subtitle">{t("onboarding.family.subtitle")}</p>
      {error ? <Alert>{error}</Alert> : null}
      <form className="onboarding-form" onSubmit={handleSubmit}>
        <label className="onboarding-label" htmlFor="familyName">
          {t("onboarding.family.label")}
        </label>
        <input
          id="familyName"
          className="onboarding-input"
          required
          minLength={2}
          maxLength={80}
          value={familyName}
          onChange={(e) => onFamilyNameChange(e.target.value)}
          placeholder={t("onboarding.family.placeholder")}
          autoFocus
          aria-label={t("onboarding.family.label")}
        />
        <div className="onboarding-actions">
          <Button type="submit" className="btn btn-primary onboarding-cta" disabled={saving || !familyName.trim()}>
            {saving ? t("onboarding.saving") : t("onboarding.family.cta")}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Step: Privacy & Consent ────────────────────────────────────────────────────

function PrivacyStep({
  onNext,
  saving,
  error,
}: {
  onNext: () => void;
  saving: boolean;
  error: string;
}) {
  const { t } = useLocale();
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [agreedPrivacy, setAgreedPrivacy] = useState(false);
  const [agreedParental, setAgreedParental] = useState(false);

  const allChecked = agreedTerms && agreedPrivacy && agreedParental;

  const privacyPoints: string[] = [
    t("onboarding.privacy.point1"),
    t("onboarding.privacy.point2"),
    t("onboarding.privacy.point3"),
    t("onboarding.privacy.point4"),
    t("onboarding.privacy.point5"),
    t("onboarding.privacy.point6"),
  ];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (allChecked) {
      onNext();
    }
  }

  return (
    <div className="onboarding-step">
      <h1 className="onboarding-title">{t("onboarding.privacy.title")}</h1>
      <p className="onboarding-subtitle">{t("onboarding.privacy.subtitle")}</p>
      <ul className="onboarding-privacy-points" role="list">
        {privacyPoints.map((point) => (
          <li key={point} className="onboarding-privacy-point">
            <span className="onboarding-privacy-bullet" aria-hidden="true">•</span>
            {point}
          </li>
        ))}
      </ul>
      <div className="onboarding-legal-links">
        <Link href="/privacy-policy" target="_blank" rel="noreferrer" className="onboarding-link">
          {t("onboarding.privacy.viewPrivacyPolicy")}
        </Link>
        <Link href="/terms-of-service" target="_blank" rel="noreferrer" className="onboarding-link">
          {t("onboarding.privacy.viewTermsOfService")}
        </Link>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <form className="onboarding-form" onSubmit={handleSubmit}>
        <div className="onboarding-checkboxes">
          <label className="onboarding-checkbox-label">
            <input
              type="checkbox"
              className="onboarding-checkbox"
              checked={agreedTerms}
              onChange={(e) => setAgreedTerms(e.target.checked)}
              aria-label={t("onboarding.privacy.terms")}
            />
            <span>{t("onboarding.privacy.terms")}</span>
          </label>
          <label className="onboarding-checkbox-label">
            <input
              type="checkbox"
              className="onboarding-checkbox"
              checked={agreedPrivacy}
              onChange={(e) => setAgreedPrivacy(e.target.checked)}
              aria-label={t("onboarding.privacy.privacy")}
            />
            <span>{t("onboarding.privacy.privacy")}</span>
          </label>
          <label className="onboarding-checkbox-label">
            <input
              type="checkbox"
              className="onboarding-checkbox"
              checked={agreedParental}
              onChange={(e) => setAgreedParental(e.target.checked)}
              aria-label={t("onboarding.privacy.parental")}
            />
            <span>{t("onboarding.privacy.parental")}</span>
          </label>
        </div>
        <div className="onboarding-actions">
          <Button
            type="submit"
            className="btn btn-primary onboarding-cta"
            disabled={!allChecked || saving}>
            {saving ? t("onboarding.saving") : t("onboarding.privacy.cta")}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Step: Add First Child ──────────────────────────────────────────────────────

function AddChildStep({
  onSkip,
  onDone,
}: {
  onSkip: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [childName, setChildName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState<string[]>([]);

  async function addChild() {
    const name = childName.trim();
    if (!name || saving) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/family/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: "", role: "player" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `ADD_CHILD_HTTP_${response.status}`);
      }
      setAdded((prev) => [...prev, name]);
      setChildName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "add_child_failed");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void addChild();
  }

  return (
    <div className="onboarding-step">
      <h1 className="onboarding-title">{t("onboarding.addChild.title")}</h1>
      <p className="onboarding-subtitle">{t("onboarding.addChild.subtitle")}</p>
      {added.length > 0 ? (
        <ul className="onboarding-added-list" role="list">
          {added.map((name) => (
            <li key={name} className="onboarding-added-item">
              <span className="onboarding-added-check" aria-hidden="true">✓</span>
              {name}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <form className="onboarding-form" onSubmit={handleSubmit}>
        <label className="onboarding-label" htmlFor="childName">
          {t("onboarding.addChild.label")}
        </label>
        <input
          id="childName"
          className="onboarding-input"
          value={childName}
          onChange={(e) => setChildName(e.target.value)}
          placeholder={t("onboarding.addChild.placeholder")}
          minLength={2}
          maxLength={80}
          aria-label={t("onboarding.addChild.label")}
        />
        <div className="onboarding-actions">
          {childName.trim().length >= 2 ? (
            <Button type="submit" className="btn btn-primary onboarding-cta" disabled={saving}>
              {saving ? t("onboarding.saving") : t("onboarding.addChild.cta")}
            </Button>
          ) : null}
          {added.length > 0 ? (
            <Button type="button" className="btn btn-primary onboarding-cta" onClick={onDone}>
              {t("onboarding.addChild.done")}
            </Button>
          ) : null}
          <Button type="button" className="btn btn-secondary onboarding-secondary" onClick={onSkip}>
            {t("onboarding.addChild.skip")}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Step: First Chore ──────────────────────────────────────────────────────────

const CHORE_SUGGESTIONS = ["Make Bed", "Feed Pet", "Clean Room", "Put Away Laundry"];

function FirstChoreStep({
  onSkip,
  onDone,
}: {
  onSkip: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const [choreTitle, setChoreTitle] = useState("");
  const [coins, setCoins] = useState("5");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(false);

  async function createChore() {
    const title = choreTitle.trim();
    if (!title || saving) {
      return;
    }
    const coinValue = Math.max(1, Math.min(9999, parseInt(coins, 10) || 5));
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/chores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: title, coinValue }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `CREATE_CHORE_HTTP_${response.status}`);
      }
      setCreated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create_chore_failed");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void createChore();
  }

  if (created) {
    return (
      <div className="onboarding-step">
        <div className="onboarding-hero-icon" aria-hidden="true">✓</div>
        <h1 className="onboarding-title">{t("onboarding.firstChore.createdTitle")}</h1>
        <p className="onboarding-subtitle">{t("onboarding.firstChore.createdSubtitle")}</p>
        <div className="onboarding-actions">
          <Button type="button" className="btn btn-primary onboarding-cta" onClick={onDone}>
            {t("onboarding.firstChore.continue")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-step">
      <h1 className="onboarding-title">{t("onboarding.firstChore.title")}</h1>
      <p className="onboarding-subtitle">{t("onboarding.firstChore.subtitle")}</p>
      <div className="onboarding-suggestions" role="group" aria-label="Chore suggestions">
        {CHORE_SUGGESTIONS.map((suggestion) => (
          <Button
            key={suggestion}
            type="button"
            className={`onboarding-suggestion-chip${choreTitle === suggestion ? " is-selected" : ""}`}
            onClick={() => setChoreTitle(suggestion)}>
            {suggestion}
          </Button>
        ))}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <form className="onboarding-form" onSubmit={handleSubmit}>
        <label className="onboarding-label" htmlFor="choreTitle">
          {t("onboarding.firstChore.label")}
        </label>
        <input
          id="choreTitle"
          className="onboarding-input"
          value={choreTitle}
          onChange={(e) => setChoreTitle(e.target.value)}
          placeholder={t("onboarding.firstChore.placeholder")}
          minLength={2}
          maxLength={120}
          aria-label={t("onboarding.firstChore.label")}
        />
        <label className="onboarding-label" htmlFor="choreCoins">
          {t("onboarding.firstChore.coinsLabel")}
        </label>
        <input
          id="choreCoins"
          type="number"
          className="onboarding-input"
          value={coins}
          min={1}
          max={9999}
          onChange={(e) => setCoins(e.target.value)}
          aria-label={t("onboarding.firstChore.coinsLabel")}
        />
        <div className="onboarding-actions">
          <Button
            type="submit"
            className="btn btn-primary onboarding-cta"
            disabled={saving || choreTitle.trim().length < 2}>
            {saving ? t("onboarding.saving") : t("onboarding.firstChore.cta")}
          </Button>
          <Button type="button" className="btn btn-secondary onboarding-secondary" onClick={onSkip}>
            {t("onboarding.firstChore.skip")}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ── Step: Done ─────────────────────────────────────────────────────────────────

function DoneStep({ onFinish }: { onFinish: () => void }) {
  const { t } = useLocale();
  const nextSteps: string[] = [
    t("onboarding.done.next1"),
    t("onboarding.done.next2"),
    t("onboarding.done.next3"),
    t("onboarding.done.next4"),
  ];
  return (
    <div className="onboarding-step">
      <div className="onboarding-hero-icon" aria-hidden="true">🎉</div>
      <h1 className="onboarding-title">{t("onboarding.done.title")}</h1>
      <p className="onboarding-subtitle">{t("onboarding.done.subtitle")}</p>
      <ul className="onboarding-next-steps" role="list">
        {nextSteps.map((step) => (
          <li key={step} className="onboarding-next-step">
            <span className="onboarding-feature-check" aria-hidden="true">→</span>
            {step}
          </li>
        ))}
      </ul>
      <div className="onboarding-actions">
        <Button type="button" className="btn btn-primary onboarding-cta" onClick={onFinish}>
          {t("onboarding.done.cta")}
        </Button>
      </div>
    </div>
  );
}

// ── Wizard Shell ───────────────────────────────────────────────────────────────

type OnboardingWizardProps = {
  viewerName: string;
};

export function OnboardingWizard({ viewerName: _viewerName }: OnboardingWizardProps) {
  const { t } = useLocale();
  const router = useRouter();

  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [statusLoading, setStatusLoading] = useState(true);
  const [familyName, setFamilyName] = useState("");
  const [familySaving, setFamilySaving] = useState(false);
  const [familyError, setFamilyError] = useState("");
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyError, setPrivacyError] = useState("");

  // Check whether this session actually needs onboarding.
  // If already complete or viewer is a player, redirect to dashboard.
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/family/onboarding-status", { cache: "no-store" });
        const payload = (await response.json()) as OnboardingStatus & { error?: string };
        if (!response.ok || payload.error) {
          // Fail open — show wizard rather than blocking.
          setStatusLoading(false);
          return;
        }
        if (!payload.needsOnboarding || payload.viewerRole !== "admin") {
          router.replace("/");
          return;
        }
      } catch {
        // Fail open.
      }
      setStatusLoading(false);
    })();
  }, [router]);

  async function handleFamilyNext() {
    const name = familyName.trim();
    if (!name || familySaving) {
      return;
    }
    setFamilySaving(true);
    setFamilyError("");
    try {
      const response = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ familyName: name }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `FAMILY_HTTP_${response.status}`);
      }
      setStep("privacy");
    } catch (err) {
      setFamilyError(err instanceof Error ? err.message : "family_save_failed");
    } finally {
      setFamilySaving(false);
    }
  }

  async function handleConsentNext() {
    setPrivacySaving(true);
    setPrivacyError("");
    try {
      const response = await fetch("/api/family/privacy/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataRegion: "US" }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? `CONSENT_HTTP_${response.status}`);
      }
      setStep("addChild");
    } catch (err) {
      setPrivacyError(err instanceof Error ? err.message : "consent_failed");
    } finally {
      setPrivacySaving(false);
    }
  }

  async function handleFinish() {
    router.push("/");
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    router.push("/");
  }

  if (statusLoading) {
    return (
      <div className="onboarding-loading" aria-live="polite">
        {t("common.status.loading")}
      </div>
    );
  }

  const stepLabels: Record<OnboardingStep, string> = {
    welcome: t("onboarding.steps.welcome"),
    family: t("onboarding.steps.family"),
    privacy: t("onboarding.steps.privacy"),
    addChild: t("onboarding.steps.addChild"),
    firstChore: t("onboarding.steps.firstChore"),
    done: t("onboarding.steps.done"),
  };

  return (
    <div className="onboarding-shell">
      <div className="onboarding-card">
        {step !== "done" ? (
          <ProgressDots steps={STEPS} current={step} labels={stepLabels} />
        ) : null}

        {step === "welcome" ? (
          <WelcomeStep
            onNext={() => setStep("family")}
            onSignOut={() => void handleSignOut()}
          />
        ) : null}

        {step === "family" ? (
          <FamilyStep
            familyName={familyName}
            onFamilyNameChange={setFamilyName}
            onNext={() => void handleFamilyNext()}
            saving={familySaving}
            error={familyError}
          />
        ) : null}

        {step === "privacy" ? (
          <PrivacyStep
            onNext={() => void handleConsentNext()}
            saving={privacySaving}
            error={privacyError}
          />
        ) : null}

        {step === "addChild" ? (
          <AddChildStep
            onSkip={() => setStep("firstChore")}
            onDone={() => setStep("firstChore")}
          />
        ) : null}

        {step === "firstChore" ? (
          <FirstChoreStep
            onSkip={() => setStep("done")}
            onDone={() => setStep("done")}
          />
        ) : null}

        {step === "done" ? (
          <DoneStep onFinish={() => void handleFinish()} />
        ) : null}
      </div>
    </div>
  );
}
