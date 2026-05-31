import { LOCALE_LABELS, SUPPORTED_LOCALES, type AppLocale } from "@packages/locales";
import { Avatar } from "@/components/avatar";
import { Button } from "@/components/button";
import { EnumChip, humanizeEnum } from "@/components/enum-chip";
import { useLocale } from "@/components/locale-provider";
import { TailwindSelect, type TailwindSelectOption } from "@/components/tailwind-select";
import type { ThemePalette } from "@/components/profile/profile-page.types";

type ProfileDetailsSectionProps = {
  displayName: string;
  displayEmail: string;
  role: "admin" | "player";
  locale: AppLocale;
  localePending: boolean;
  localeError: string;
  isLoading: boolean;
  canEditName: boolean;
  isEditingName: boolean;
  editedName: string;
  namePending: boolean;
  nameError: string;
  picture?: string;
  activeAvatarId: string;
  activeAvatarPhotoUrl: string;
  themePalette: ThemePalette;
  activeThemeName: string;
  isDefaultThemeActive: boolean;
  activeConfettiName: string;
  isDefaultConfettiActive: boolean;
  activeConfettiColors: string[];
  onNameDraftChange: (value: string) => void;
  onStartNameEdit: () => void;
  onCancelNameEdit: () => void;
  onSaveNameEdit: () => void;
  onLocaleChange: (value: AppLocale) => void;
  onOpenAvatarDialog: () => void;
  onOpenThemeDialog: () => void;
  onOpenConfettiDialog: () => void;
};

export function ProfileDetailsSection({
  displayName,
  displayEmail,
  role,
  locale,
  localePending,
  localeError,
  isLoading,
  canEditName,
  isEditingName,
  editedName,
  namePending,
  nameError,
  picture,
  activeAvatarId,
  activeAvatarPhotoUrl,
  themePalette,
  activeThemeName,
  isDefaultThemeActive,
  activeConfettiName,
  isDefaultConfettiActive,
  activeConfettiColors,
  onNameDraftChange,
  onStartNameEdit,
  onCancelNameEdit,
  onSaveNameEdit,
  onLocaleChange,
  onOpenAvatarDialog,
  onOpenThemeDialog,
  onOpenConfettiDialog,
}: ProfileDetailsSectionProps) {
  const { t } = useLocale();
  const localeOptions: TailwindSelectOption<AppLocale>[] = SUPPORTED_LOCALES.map((option) => ({
    value: option,
    label: LOCALE_LABELS[option],
  }));

  return (
    <div>
        <div className="profile-page-account-row">
          <div className="profile-page-account-avatar">
            <Avatar
              className="profile-page-avatar-frame"
              size={140}
              borderWidth={3}
              name={displayName}
              avatarId={activeAvatarId}
              photoUrl={activeAvatarPhotoUrl || picture || ""}
              primaryColor={themePalette.primary}
              secondaryColor={themePalette.primary}
              fallbackColor="#ffffff"
              referrerPolicy="no-referrer"
              loading="eager"
            />
            <div className="profile-avatar-actions">
              <Button
                type="button"
                className="btn btn-secondary profile-theme-change-btn"
                disabled={isLoading}
                onClick={onOpenAvatarDialog}>
                {t("common.actions.change")}
              </Button>
            </div>
            {isLoading ? <p className="small">{t("profile.loadingProfile")}</p> : null}
          </div>
          <dl className="profile-page-fields profile-page-basic-fields">
            <div>
              <dt>{t("profile.name")}</dt>
              <dd className="profile-page-name-line">
                {isEditingName ? (
                  <div className="profile-name-edit-wrap">
                    <input
                      type="text"
                      value={editedName}
                      onChange={(event) => onNameDraftChange(event.target.value)}
                      className="profile-name-input"
                      maxLength={80}
                      disabled={namePending}
                      aria-label={t("profile.name")}
                    />
                    <div className="profile-name-actions">
                      <Button
                        type="button"
                        className="btn btn-primary profile-theme-change-btn"
                        disabled={namePending}
                        onClick={onSaveNameEdit}>
                        {namePending ? t("family.memberLanguageSaving") : t("common.actions.save")}
                      </Button>
                      <Button
                        type="button"
                        className="btn btn-secondary profile-theme-change-btn"
                        disabled={namePending}
                        onClick={onCancelNameEdit}>
                        {t("common.actions.cancel")}
                      </Button>
                    </div>
                    {nameError ? <span className="profile-name-error">{nameError}</span> : null}
                  </div>
                ) : (
                  <>
                    <span>{displayName}</span>
                    {canEditName ? (
                      <Button
                        type="button"
                        className="btn btn-secondary profile-theme-change-btn"
                        disabled={isLoading}
                        onClick={onStartNameEdit}>
                        {t("common.actions.change")}
                      </Button>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt>{t("profile.email")}</dt>
              <dd>{displayEmail}</dd>
            </div>
            <div>
              <dt>{t("profile.role")}</dt>
              <dd>
                <EnumChip label={humanizeEnum(role)} tone={role === "admin" ? "indigo" : "teal"} />
              </dd>
            </div>
            <div>
              <dt>{t("common.labels.language")}</dt>
              <dd>
                <div className="flex flex-col items-start gap-1.5 pb-1">
                  <TailwindSelect
                    ariaLabel={t("common.labels.language")}
                    className="min-w-[220px]"
                    buttonClassName="h-10 min-w-[220px] rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                    value={locale}
                    disabled={isLoading || localePending}
                    onChange={onLocaleChange}
                    options={localeOptions}
                  />
                  {localePending ? <span className="small">{t("family.memberLanguageSaving")}</span> : null}
                </div>
                {localeError ? <span className="profile-name-error">{localeError}</span> : null}
              </dd>
            </div>
          </dl>
        </div>
        <dl className="profile-page-fields profile-page-style-fields">
          <div>
            <dt>{t("profile.theme")}</dt>
            <dd className="profile-page-theme-line">
              <span className="profile-page-theme-name">
                {activeThemeName}
                {isDefaultThemeActive ? ` (${t("common.labels.default")})` : ""}
              </span>
              <span className="profile-page-theme-swatches" aria-hidden="true">
                <span className="profile-theme-swatch" style={{ backgroundColor: themePalette.primary }} />
                <span className="profile-theme-swatch" style={{ backgroundColor: themePalette.secondary }} />
                <span className="profile-theme-swatch" style={{ backgroundColor: themePalette.tertiary }} />
              </span>
              <Button
                type="button"
                className="btn btn-secondary profile-theme-change-btn"
                disabled={isLoading}
                onClick={onOpenThemeDialog}>
                {t("common.actions.change")}
              </Button>
            </dd>
          </div>
          <div>
            <dt>{t("profile.victoryConfetti")}</dt>
            <dd className="profile-page-theme-line">
              <span className="profile-page-theme-name">
                {activeConfettiName}
                {isDefaultConfettiActive ? ` (${t("common.labels.default")})` : ""}
              </span>
              {!isDefaultConfettiActive && activeConfettiColors.length > 0 ? (
                <span className="profile-page-theme-swatches" aria-hidden="true">
                  {activeConfettiColors.map((color, index) => (
                    <span key={`${color}-${index}`} className="profile-theme-swatch" style={{ backgroundColor: color }} />
                  ))}
                </span>
              ) : null}
              <Button
                type="button"
                className="btn btn-secondary profile-theme-change-btn"
                disabled={isLoading}
                onClick={onOpenConfettiDialog}>
                {t("common.actions.change")}
              </Button>
            </dd>
          </div>
        </dl>
    </div>
  );
}
