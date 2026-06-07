// Explicit allowlist sanitizers for the user-facing family data export.
//
// Raw Firestore documents must never be included directly. Every entity type has
// its own mapping function that whitelists only approved fields. Anything not
// listed is silently dropped — this is intentional.

function pickFields(
  record: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (record[field] !== undefined && record[field] !== null) {
      result[field] = record[field];
    }
  }
  return result;
}

const FAMILY_EXPORT_FIELDS = [
  "id",
  "name",
  "createdAt",
  "updatedAt",
  "dataRegion",
  "locale",
  "memberCount",
  // Consent state — useful for the family to verify their own records
  "acceptedTermsVersion",
  "acceptedPrivacyVersion",
  "parentalConsentAt",
  // Pending deletion window
  "deletionRequestedAt",
  "deletionScheduledFor",
] as const;

// Fields present on all member types (active parents and children).
const MEMBER_SHARED_FIELDS = [
  "id",
  "uid",
  "name",
  "email",
  "role",
  "status",
  "coinBalance",
  "walletBalance",
  "joinedAt",
  "createdAt",
  "updatedAt",
  "acceptedAt",
  "locale",
  "timezone",
  "relationshipType",
  // App-managed avatar references only (no OAuth/provider URLs)
  "avatarType",
  "avatarId",
  "appAvatarPath",
] as const;

// Login/session timestamps are visible in the Family UI for admin accounts.
// They reflect authentication behaviour for children and are excluded for
// child/player members.
const PARENT_LOGIN_FIELDS = ["lastSignInAt", "lastActiveAt"] as const;

// Invite records: expose only what a family needs to understand their pending
// invitations. Internal IDs (createdBy UID, email-as-doc-ID) are excluded.
const INVITE_EXPORT_FIELDS = [
  "email",
  "invitedEmail",
  "status",
  "createdAt",
  "invitedAt",
  "expiresAt",
  "acceptedAt",
  "relationshipType",
] as const;

const CHORE_EXPORT_FIELDS = [
  "id",
  "title",
  "description",
  "coinValue",
  "status",
  "assignedTo",
  "assignedToName",
  "createdAt",
  "updatedAt",
  "completedAt",
  "dueAt",
  "frequency",
  "isRecurring",
  "proofRequired",
  "imageUrl",
  "photoUrl",
] as const;

const REWARD_EXPORT_FIELDS = [
  "id",
  "title",
  "description",
  "coinCost",
  "status",
  "createdAt",
  "updatedAt",
  "redeemedAt",
  "imageUrl",
  "quantity",
  "limitPerMember",
] as const;

const QUEST_EXPORT_FIELDS = [
  "id",
  "questId",
  "name",
  "title",
  "description",
  "status",
  "startedAt",
  "completedAt",
  "createdAt",
  "updatedAt",
  "coinReward",
  "progress",
  "stepsCompleted",
  "totalSteps",
] as const;

const FEED_ITEM_EXPORT_FIELDS = [
  "id",
  "eventType",
  "actorName",
  "message",
  "createdAt",
  "choreTitle",
  "rewardTitle",
  "coinDelta",
] as const;

const ACHIEVEMENT_EXPORT_FIELDS = [
  "id",
  "uid",
  "achievementId",
  "title",
  "description",
  "completedAt",
  "progress",
  "totalSteps",
  "coinReward",
] as const;

const QUEST_PROGRESS_EXPORT_FIELDS = [
  "id",
  "uid",
  "questId",
  "title",
  "status",
  "startedAt",
  "completedAt",
  "stepsCompleted",
  "totalSteps",
] as const;

const INVENTORY_EXPORT_FIELDS = [
  "id",
  "uid",
  "rewardId",
  "title",
  "quantity",
  "redeemedAt",
  "coinCost",
] as const;

export function sanitizeFamilyForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return pickFields(record, FAMILY_EXPORT_FIELDS);
}

export function sanitizeMemberForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const role = record.role as string | undefined;
  const isChild = role === "player";

  const sanitized = pickFields(record, MEMBER_SHARED_FIELDS);

  // Login/session timestamps only for parent/admin accounts.
  if (!isChild) {
    for (const field of PARENT_LOGIN_FIELDS) {
      if (record[field] !== undefined && record[field] !== null) {
        sanitized[field] = record[field];
      }
    }
  }

  // Replace the raw Google/OAuth avatar URL with a boolean flag.
  // The URL itself is an external provider reference and is excluded.
  if (record.avatarPhotoUrl) {
    sanitized.hasExternalAvatar = true;
  }

  return sanitized;
}

export function sanitizeInviteForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return pickFields(record, INVITE_EXPORT_FIELDS);
}

export function sanitizeChoreForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return pickFields(record, CHORE_EXPORT_FIELDS);
}

export function sanitizeRewardForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return pickFields(record, REWARD_EXPORT_FIELDS);
}

export function sanitizeQuestForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return pickFields(record, QUEST_EXPORT_FIELDS);
}

export function sanitizeFeedItemForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return pickFields(record, FEED_ITEM_EXPORT_FIELDS);
}

export function sanitizeAchievementForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return pickFields(record, ACHIEVEMENT_EXPORT_FIELDS);
}

export function sanitizeQuestProgressForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return pickFields(record, QUEST_PROGRESS_EXPORT_FIELDS);
}

export function sanitizeInventoryForExport(
  record: Record<string, unknown>,
): Record<string, unknown> {
  return pickFields(record, INVENTORY_EXPORT_FIELDS);
}

export const EXPORT_MANIFEST_NOTES = [
  "External OAuth and provider avatar URLs are excluded.",
  "Child login and session timestamps are excluded.",
  "Internal system identifiers and auth provider UIDs are excluded.",
  "Admin and cross-family data are excluded.",
] as const;
