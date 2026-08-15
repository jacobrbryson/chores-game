import type { createTranslator } from "@packages/locales";

/**
 * Resolves the join-family copy on the server so the client component stays a
 * plain presentational form. Both the `/join` link page and the homepage
 * `needs_family_setup` state render the same panel from these labels.
 */
export function buildJoinFamilyLabels(t: ReturnType<typeof createTranslator>) {
  return {
    title: t("joinFamily.title"),
    description: t("joinFamily.description"),
    codeLabel: t("joinFamily.codeLabel"),
    codePlaceholder: t("joinFamily.codePlaceholder"),
    submit: t("joinFamily.submit"),
    submitting: t("joinFamily.submitting"),
    success: t("joinFamily.success"),
    successGeneric: t("joinFamily.successGeneric"),
    alreadyMember: t("joinFamily.alreadyMember"),
    help: t("joinFamily.help"),
    errors: {
      invalidCode: t("joinFamily.errors.invalidCode"),
      inviteNotFound: t("joinFamily.errors.inviteNotFound"),
      inviteAlreadyUsed: t("joinFamily.errors.inviteAlreadyUsed"),
      inviteRevoked: t("joinFamily.errors.inviteRevoked"),
      inviteExpired: t("joinFamily.errors.inviteExpired"),
      inviteLocked: t("joinFamily.errors.inviteLocked"),
      alreadyInAnotherFamily: t("joinFamily.errors.alreadyInAnotherFamily"),
      familyMemberLimitReached: t("joinFamily.errors.familyMemberLimitReached"),
      unauthorized: t("joinFamily.errors.unauthorized"),
      failed: t("joinFamily.errors.failed"),
    },
  };
}
