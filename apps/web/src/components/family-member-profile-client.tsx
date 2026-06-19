"use client";

import { LOCALE_LABELS, SUPPORTED_LOCALES, type AppLocale } from "@packages/locales";
import { useCallback, useEffect, useState } from "react";
import { AccountSwitchModal } from "@/components/account-switch-modal";
import { Alert } from "@/components/alert";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { ModalShell } from "@/components/modal-shell";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import { formatDateTime } from "@/components/profile/profile-page.utils";
import { dispatchAppLocaleChanged, useLocale } from "@/components/locale-provider";
import { ProfileFamilySummarySection } from "@/components/profile/profile-family-summary-section";
import { ResponsibilityProgressCard } from "@/components/responsibility-progress-card";
import { ProfileAthenaChildCard } from "@/components/profile/profile-athena-child-card";

type FamilyMemberProfileClientProps = {
  memberId: string;
};

type FamilyAwardClaim = {
  id: string;
  rewardDescription: string;
  rewardImageId: string;
  coinCost: number;
  purchasedAt?: string;
  claimedAt?: string;
  claimedByName?: string;
};

type OwnedItem = {
  id: string;
  name: string;
  description: string;
  image: string;
  category: string;
  quantity: number;
  source: "inventory" | "store_unlock";
  paidValue: number;
  acquisitionLabel: string;
};

type FamilyMemberProfileResponse = {
  familyId: string;
  familyName: string;
  viewerUid: string;
  viewerRole: "admin" | "player";
  canManageAwards: boolean;
  member: {
    id: string;
    uid?: string;
    name: string;
    email: string;
    role: "admin" | "player";
    status: "active" | "invited";
    locale?: AppLocale;
    resolvedLocale?: AppLocale;
    lastSignInAt?: string;
    avatarId?: string;
    avatarPhotoUrl?: string;
  };
  theme: {
    name: string;
    palette: {
      primary: string;
      secondary: string;
      tertiary: string;
    };
    isDefault: boolean;
  };
  confetti: {
    name: string;
    colors: string[];
    isDefault: boolean;
  };
  ownedItems: OwnedItem[];
  unclaimedAwards: FamilyAwardClaim[];
  claimedAwards: FamilyAwardClaim[];
};

export function FamilyMemberProfileClient({ memberId }: FamilyMemberProfileClientProps) {
  const { t } = useLocale();
  const localeOptions: TailwindSelectOption<AppLocale>[] = SUPPORTED_LOCALES.map((option) => ({
    value: option,
    label: LOCALE_LABELS[option],
  }));
  const [profile, setProfile] = useState<FamilyMemberProfileResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimingAwardId, setClaimingAwardId] = useState("");
  const [claimError, setClaimError] = useState("");
  const [pendingRemove, setPendingRemove] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  const [memberActionError, setMemberActionError] = useState("");
  const [switchDialogOpen, setSwitchDialogOpen] = useState(false);
  const [switchPin, setSwitchPin] = useState("");
  const [switchPinConfirm, setSwitchPinConfirm] = useState("");
  const [switchPending, setSwitchPending] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [switchRequiresPinSetup, setSwitchRequiresPinSetup] = useState(false);
  const [localePending, setLocalePending] = useState(false);
  const [localeError, setLocaleError] = useState("");

  const loadProfile = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/family/members/${encodeURIComponent(memberId)}/profile`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `FAMILY_MEMBER_PROFILE_HTTP_${response.status}`);
      }
      const payload = (await response.json()) as FamilyMemberProfileResponse;
      setProfile(payload);
    } catch (errorValue) {
      setProfile(null);
      setError(errorValue instanceof Error ? errorValue.message : "member_profile_unavailable");
    } finally {
      setIsLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const canManageThisMember = Boolean(
    profile &&
      profile.viewerRole === "admin" &&
      profile.member.id !== profile.viewerUid &&
      profile.member.uid !== profile.viewerUid,
  );
  const canSwitchToMember = Boolean(canManageThisMember && profile?.member.role === "player");

  function closeSwitchDialog() {
    setSwitchDialogOpen(false);
    setSwitchPin("");
    setSwitchPinConfirm("");
    setSwitchError("");
    setSwitchRequiresPinSetup(false);
  }

  async function onSwitchAccount() {
    if (!profile || switchPending) {
      return;
    }
    setSwitchPending(true);
    setSwitchError("");
    try {
      const response = await fetch("/api/account-switch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: profile.member.id,
          pin: switchPin,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        if (payload.error === "pin_not_configured") {
          setSwitchRequiresPinSetup(true);
          throw new Error("pin_not_configured");
        }
        throw new Error(payload.error ?? `SWITCH_ACCOUNT_HTTP_${response.status}`);
      }
      window.location.assign("/");
    } catch (errorValue) {
      setSwitchError(errorValue instanceof Error ? errorValue.message : "switch_account_failed");
    } finally {
      setSwitchPending(false);
    }
  }

  async function onSetupPinAndSwitch() {
    if (!profile || switchPending) {
      return;
    }
    setSwitchPending(true);
    setSwitchError("");
    try {
      const pinResponse = await fetch("/api/account-switch/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: switchPin,
          confirmPin: switchPinConfirm,
        }),
      });
      if (!pinResponse.ok) {
        const payload = (await pinResponse.json()) as { error?: string };
        throw new Error(payload.error ?? `PIN_SETUP_HTTP_${pinResponse.status}`);
      }

      const switchResponse = await fetch("/api/account-switch/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: profile.member.id,
          pin: switchPin,
        }),
      });
      if (!switchResponse.ok) {
        const payload = (await switchResponse.json()) as { error?: string };
        throw new Error(payload.error ?? `SWITCH_ACCOUNT_HTTP_${switchResponse.status}`);
      }

      window.location.assign("/");
    } catch (errorValue) {
      setSwitchError(errorValue instanceof Error ? errorValue.message : "switch_account_failed");
    } finally {
      setSwitchPending(false);
    }
  }

  async function onRemoveMember() {
    if (!profile || removePending) {
      return;
    }
    setRemovePending(true);
    setMemberActionError("");
    try {
      const response = await fetch(`/api/family/members/${encodeURIComponent(profile.member.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `REMOVE_MEMBER_HTTP_${response.status}`);
      }
      window.location.assign("/family");
    } catch (errorValue) {
      setMemberActionError(errorValue instanceof Error ? errorValue.message : "remove_member_failed");
      setRemovePending(false);
      setPendingRemove(false);
    }
  }

  async function onClaimAward(awardId: string) {
    if (!profile || !profile.canManageAwards || claimingAwardId) {
      return;
    }
    setClaimingAwardId(awardId);
    setClaimError("");
    try {
      const response = await fetch(
        `/api/family/members/${encodeURIComponent(memberId)}/awards/${encodeURIComponent(awardId)}`,
        { method: "PATCH" },
      );
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? `FAMILY_MEMBER_AWARD_CLAIM_HTTP_${response.status}`);
      }
      await loadProfile();
    } catch (errorValue) {
      setClaimError(errorValue instanceof Error ? errorValue.message : "claim_award_failed");
    } finally {
      setClaimingAwardId("");
    }
  }

  async function onChangeMemberLocale(nextLocale: AppLocale) {
    if (!profile || localePending || profile.member.resolvedLocale === nextLocale) {
      return;
    }
    setLocalePending(true);
    setLocaleError("");
    try {
      const response = await fetch(`/api/family/members/${encodeURIComponent(profile.member.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      const payload = (await response.json()) as { error?: string; locale?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? `FAMILY_MEMBER_LOCALE_HTTP_${response.status}`);
      }
      setProfile((current) =>
        current
          ? {
              ...current,
              member: {
                ...current.member,
                locale: nextLocale,
                resolvedLocale: nextLocale,
              },
            }
          : current,
      );
      if (profile.viewerUid === profile.member.uid || profile.viewerUid === profile.member.id) {
        dispatchAppLocaleChanged(nextLocale);
      }
    } catch (errorValue) {
      setLocaleError(
        t("family.languageUpdateError", {
          error: errorValue instanceof Error ? errorValue.message : "unknown",
        }),
      );
    } finally {
      setLocalePending(false);
    }
  }

  return (
    <main className="family-page profile-page">
      {isLoading ? <p className="small">{t("family.memberProfileLoading")}</p> : null}
      {!isLoading && error ? <Alert>{t("family.memberProfileError", { error })}</Alert> : null}

      {!isLoading && !error && profile ? (
        <div className="family-member-profile-stack">
          <section className="profile-page-grid family-member-profile-grid">
            <article className="profile-page-avatar-card family-member-profile-card">
              <div className="family-member-profile-card-header">
                <h2>{t("family.details")}</h2>
                {canManageThisMember ? (
                  <div className="family-member-profile-actions">
                    {canSwitchToMember ? (
                      <Button
                        type="button"
                        className="btn btn-secondary"
                        disabled={switchPending || removePending}
                        onClick={() => {
                          setSwitchDialogOpen(true);
                          setSwitchError("");
                          setMemberActionError("");
                        }}>
                        {t("family.switchTo")}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      className="btn member-action-remove"
                      disabled={switchPending || removePending}
                      onClick={() => {
                        setPendingRemove(true);
                        setMemberActionError("");
                      }}>
                      {t("family.remove")}
                    </Button>
                  </div>
                ) : null}
              </div>
              {memberActionError ? <Alert>{t("family.memberUpdateError", { error: memberActionError })}</Alert> : null}
              <div className="profile-page-account-row">
                <div className="profile-page-account-avatar">
                  <Avatar
                    className="profile-page-avatar-frame"
                    size={140}
                    borderWidth={3}
                    name={profile.member.name}
                    avatarId={profile.member.avatarId}
                    photoUrl={profile.member.avatarPhotoUrl || ""}
                    primaryColor={profile.theme.palette.primary}
                    secondaryColor={profile.theme.palette.primary}
                    fallbackColor="#ffffff"
                    referrerPolicy="no-referrer"
                    loading="eager"
                  />
                </div>
                <dl className="profile-page-fields profile-page-basic-fields">
                  <div><dt>{t("profile.name")}</dt><dd>{profile.member.name}</dd></div>
                  <div>
                    <dt>{t("family.memberLanguageLabel")}</dt>
                    <dd>
                      <div className="flex flex-col items-start gap-1.5 pb-1">
                        <TailwindSelect
                          ariaLabel={t("family.memberLanguageLabel")}
                          className="min-w-[220px]"
                          buttonClassName="h-10 min-w-[220px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                          value={profile.member.resolvedLocale || "en-US"}
                          disabled={localePending || (!canManageThisMember && profile.member.uid !== profile.viewerUid && profile.member.id !== profile.viewerUid)}
                          onChange={(value) => {
                            void onChangeMemberLocale(value);
                          }}
                          options={localeOptions}
                        />
                        {localePending ? <span className="small">{t("family.memberLanguageSaving")}</span> : null}
                      </div>
                      {localeError ? <span className="profile-name-error">{localeError}</span> : null}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("family.statusColumn")}</dt>
                    <dd><EnumChip label={humanizeEnum(profile.member.status)} tone={profile.member.status === "active" ? "green" : "amber"} /></dd>
                  </div>
                  <div><dt>{t("family.lastSignIn")}</dt><dd>{formatDateTime(profile.member.lastSignInAt)}</dd></div>
                </dl>
              </div>
              <dl className="profile-page-fields profile-page-style-fields">
                <div>
                  <dt>{t("profile.theme")}</dt>
                  <dd className="profile-page-theme-line">
                    <span className="profile-page-theme-name">{profile.theme.name}{profile.theme.isDefault ? ` (${t("common.labels.default")})` : ""}</span>
                    <span className="profile-page-theme-swatches" aria-hidden="true">
                      <span className="profile-theme-swatch" style={{ backgroundColor: profile.theme.palette.primary }} />
                      <span className="profile-theme-swatch" style={{ backgroundColor: profile.theme.palette.secondary }} />
                      <span className="profile-theme-swatch" style={{ backgroundColor: profile.theme.palette.tertiary }} />
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>{t("profile.victoryConfetti")}</dt>
                  <dd className="profile-page-theme-line">
                    <span className="profile-page-theme-name">{profile.confetti.name}{profile.confetti.isDefault ? ` (${t("common.labels.default")})` : ""}</span>
                    {!profile.confetti.isDefault && profile.confetti.colors.length > 0 ? (
                      <span className="profile-page-theme-swatches" aria-hidden="true">
                        {profile.confetti.colors.map((color, index) => (
                          <span key={`${color}-${index}`} className="profile-theme-swatch" style={{ backgroundColor: color }} />
                        ))}
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </article>
          </section>

          {/* Responsibility report card for this member. Self-hiding: the
              progress API returns 403 for non-admin viewers looking at other
              members, and the card renders nothing on failure. */}
          <ResponsibilityProgressCard memberId={profile.member.uid || profile.member.id} />

          {/* Per-child Athena enablement. Self-hides unless the viewer is an
              admin and the family has connected Athena from the parent profile. */}
          {profile.member.role === "player" ? (
            <ProfileAthenaChildCard playerId={profile.member.id} displayName={profile.member.name} />
          ) : null}

          <ProfileFamilySummarySection
            summary={profile}
            isLoading={false}
            error=""
            memberId={memberId}
            canManageAwards={profile.canManageAwards}
            claimingAwardId={claimingAwardId}
            claimError={claimError}
            onClaimAward={(awardId) => {
              void onClaimAward(awardId);
            }}
          />
        </div>
      ) : null}
      <AccountSwitchModal
        open={switchDialogOpen}
        onRequestClose={closeSwitchDialog}
        memberName={profile?.member.name ?? ""}
        pin={switchPin}
        onPinChange={setSwitchPin}
        confirmPin={switchPinConfirm}
        onConfirmPinChange={setSwitchPinConfirm}
        pending={switchPending}
        error={switchError}
        requiresPinSetup={switchRequiresPinSetup}
        onConfirm={switchRequiresPinSetup ? onSetupPinAndSwitch : onSwitchAccount}
      />
      <ModalShell open={pendingRemove} onRequestClose={() => setPendingRemove(false)}>
        <div className="family-modal-card">
          {profile ? (
            <>
              <div className="modal-dialog-title-row family-modal-title-row">
                <h3 className="family-modal-title">{t("family.removeMemberTitle")}</h3>
                <Button
                  type="button"
                  className="modal-close-button"
                  onClick={() => setPendingRemove(false)}
                  aria-label={t("common.actions.close")}
                  title={t("common.actions.close")}>
                  X
                </Button>
              </div>
              <p className="mb-4 text-sm text-slate-600">
                {t("family.removeMemberPrompt", { name: profile.member.name })}
              </p>
              <div className="family-modal-actions">
                <Button
                  type="button"
                  className="btn btn-secondary"
                  disabled={removePending}
                  onClick={() => setPendingRemove(false)}>
                  {t("common.actions.cancel")}
                </Button>
                <Button
                  type="button"
                  className="btn member-action-remove"
                  disabled={removePending}
                  onClick={onRemoveMember}>
                  {removePending ? t("family.removing") : t("family.remove")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </ModalShell>
    </main>
  );
}
