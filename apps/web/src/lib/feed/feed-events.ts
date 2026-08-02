// Shared Family Feed event model.
//
// The Family Feed is a curated, family-scoped view over the existing immutable family
// activity notification records (families/{familyId}/notifications). We deliberately do
// NOT write a separate feedEvents collection: the notification records already carry
// enough information (kind, actor, title, message, relatedIds, createdAt), and reusing
// them avoids duplicating notification/activity data (see AGENTS.md "Family Feed").
//
// This module is the single source of truth for which notification kinds surface in the
// feed, how they map to feed event types, their icon tokens, safe deep-link actions, and
// the shared family visibility rule. It is imported by the API route, the UI, and tests.

export const FEED_EVENT_TYPES = [
  "chore_created",
  "chore_completed",
  "chore_approved",
  "chore_rejected",
  "reward_claimed",
  "routine_assigned",
  "routine_completed",
  "title_unlocked",
  "family_award_created",
] as const;

export type FeedEventType = (typeof FEED_EVENT_TYPES)[number];

// Notification `kind` values that should surface in the family feed, mapped to a feed
// event type. Noisy lifecycle kinds (chore_edited, chore_deleted, chore_undo_completed)
// are intentionally excluded so the feed stays cheerful and uncluttered rather than a
// raw activity log (which already exists at /notifications).
// Routine events are deliberately limited to assignment and completion — the
// per-step chore_completed events already cover intermediate progress, so a
// routine never floods the feed with one extra event per step.
const NOTIFICATION_KIND_TO_FEED_TYPE: Record<string, FeedEventType> = {
  chore_created: "chore_created",
  chore_completed: "chore_completed",
  chore_approved: "chore_approved",
  chore_rejected: "chore_rejected",
  reward_claimed: "reward_claimed",
  routine_assigned: "routine_assigned",
  routine_completed: "routine_completed",
  identity_title_unlocked: "title_unlocked",
  family_reward_created: "family_award_created",
};

export function mapNotificationKindToFeedType(kind: string): FeedEventType | null {
  return NOTIFICATION_KIND_TO_FEED_TYPE[kind] ?? null;
}

export function isFeedEventType(value: string): value is FeedEventType {
  return (FEED_EVENT_TYPES as readonly string[]).includes(value);
}

// Stable icon token rendered by the client. We send a token (not markup) so mobile can
// render its own native-safe icon for the same event type later.
const FEED_TYPE_ICONS: Record<FeedEventType, string> = {
  chore_created: "chore",
  chore_completed: "check",
  chore_approved: "approved",
  chore_rejected: "rejected",
  reward_claimed: "reward",
  routine_assigned: "routine",
  routine_completed: "routine_done",
  title_unlocked: "title",
  family_award_created: "reward",
};

export function feedTypeIcon(type: FeedEventType): string {
  return FEED_TYPE_ICONS[type];
}

// Emoji rendered alongside each feed event. Shared so the in-app feed and the weekly
// highlights email show the same icon for a given event type.
const FEED_TYPE_EMOJI: Record<FeedEventType, string> = {
  chore_created: "📝",
  chore_completed: "✅",
  chore_approved: "🌟",
  chore_rejected: "🔁",
  reward_claimed: "🎁",
  routine_assigned: "📋",
  routine_completed: "🎉",
  title_unlocked: "🏅",
  family_award_created: "🎁",
};

// Fallback for notification kinds that surface in the email highlights but aren't part
// of the curated feed event set.
export const FEED_FALLBACK_EMOJI = "✨";

export function feedTypeEmoji(type: FeedEventType): string {
  return FEED_TYPE_EMOJI[type];
}

// Optional safe deep-link action for an event. Only surfaces that the viewer can already
// reach are linked; never link to support/admin/operator-only surfaces.
export type FeedActionType = "view_chore" | "view_reward" | "copy_friend_award";

export function feedTypeAction(type: FeedEventType): FeedActionType | null {
  if (type === "reward_claimed") {
    return "view_reward";
  }
  if (type === "family_award_created") {
    return "copy_friend_award";
  }
  if (type === "routine_assigned" || type === "routine_completed" || type === "title_unlocked") {
    // Routine and title-unlock events carry no single chore to deep-link to.
    return null;
  }
  return "view_chore";
}

function normalizeId(value: string) {
  return value.trim().toLowerCase();
}

// Family visibility rule, identical to the in-app notification visibility model: admins
// see all family activity; players see only activity related to them (their own actions
// or events whose relatedIds include one of their identity aliases). Admin-only events
// are never widened here. relatedIds always include the actor, so actors always see
// their own events.
export function isFeedEventVisibleToViewer(params: {
  role: "admin" | "player";
  aliases: Set<string>;
  relatedIds: string[];
}): boolean {
  if (params.role === "admin") {
    return true;
  }
  return params.relatedIds.some((id) => params.aliases.has(normalizeId(id)));
}
