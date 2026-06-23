// Centralized catalog of analytics event names. Features reference these
// constants instead of hard-coding strings so the set of trackable events stays
// discoverable and renaming is a single edit. The string values are the stable
// identifiers persisted to the analytics_events store and exported downstream —
// treat them as an append-only contract (add new events, never silently rename).

export const ANALYTICS_EVENTS = {
  // Authentication
  login: "login",
  logout: "logout",
  signup: "signup",
  family_created: "family_created",
  child_created: "child_created",

  // Chores
  chore_created: "chore_created",
  chore_assigned: "chore_assigned",
  chore_completed: "chore_completed",
  chore_approved: "chore_approved",
  chore_rejected: "chore_rejected",
  see_and_do_created: "see_and_do_created",
  ghost_chore_created: "ghost_chore_created",

  // Routines
  routine_created: "routine_created",
  routine_assigned: "routine_assigned",
  routine_completed: "routine_completed",

  // Responsibility
  pillar_xp_earned: "pillar_xp_earned",
  pillar_level_up: "pillar_level_up",
  identity_title_unlocked: "identity_title_unlocked",
  identity_progress_viewed: "identity_progress_viewed",

  // Economy
  coins_earned: "coins_earned",
  coins_spent: "coins_spent",
  store_item_purchased: "store_item_purchased",
  reward_redeemed: "reward_redeemed",

  // Parent experience
  approval_alert_viewed: "approval_alert_viewed",
  approval_alert_clicked: "approval_alert_clicked",
  approval_inbox_opened: "approval_inbox_opened",
  approval_approved: "approval_approved",
  approval_approve_all: "approval_approve_all",

  // Notifications
  notification_shown: "notification_shown",
  notification_clicked: "notification_clicked",

  // Athena
  athena_session_started: "athena_session_started",
  athena_message_sent: "athena_message_sent",
  athena_suggestion_generated: "athena_suggestion_generated",
  athena_suggestion_accepted: "athena_suggestion_accepted",
  athena_suggestion_completed: "athena_suggestion_completed",
} as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

// Grouping is purely organizational metadata for tooling/dashboards. The stored
// event row only carries the event name, not its category.
export const ANALYTICS_EVENT_CATEGORIES = {
  authentication: [
    ANALYTICS_EVENTS.login,
    ANALYTICS_EVENTS.logout,
    ANALYTICS_EVENTS.signup,
    ANALYTICS_EVENTS.family_created,
    ANALYTICS_EVENTS.child_created,
  ],
  chores: [
    ANALYTICS_EVENTS.chore_created,
    ANALYTICS_EVENTS.chore_assigned,
    ANALYTICS_EVENTS.chore_completed,
    ANALYTICS_EVENTS.chore_approved,
    ANALYTICS_EVENTS.chore_rejected,
    ANALYTICS_EVENTS.see_and_do_created,
    ANALYTICS_EVENTS.ghost_chore_created,
  ],
  routines: [
    ANALYTICS_EVENTS.routine_created,
    ANALYTICS_EVENTS.routine_assigned,
    ANALYTICS_EVENTS.routine_completed,
  ],
  responsibility: [
    ANALYTICS_EVENTS.pillar_xp_earned,
    ANALYTICS_EVENTS.pillar_level_up,
    ANALYTICS_EVENTS.identity_title_unlocked,
    ANALYTICS_EVENTS.identity_progress_viewed,
  ],
  economy: [
    ANALYTICS_EVENTS.coins_earned,
    ANALYTICS_EVENTS.coins_spent,
    ANALYTICS_EVENTS.store_item_purchased,
    ANALYTICS_EVENTS.reward_redeemed,
  ],
  parent_experience: [
    ANALYTICS_EVENTS.approval_alert_viewed,
    ANALYTICS_EVENTS.approval_alert_clicked,
    ANALYTICS_EVENTS.approval_inbox_opened,
    ANALYTICS_EVENTS.approval_approved,
    ANALYTICS_EVENTS.approval_approve_all,
  ],
  notifications: [
    ANALYTICS_EVENTS.notification_shown,
    ANALYTICS_EVENTS.notification_clicked,
  ],
  athena: [
    ANALYTICS_EVENTS.athena_session_started,
    ANALYTICS_EVENTS.athena_message_sent,
    ANALYTICS_EVENTS.athena_suggestion_generated,
    ANALYTICS_EVENTS.athena_suggestion_accepted,
    ANALYTICS_EVENTS.athena_suggestion_completed,
  ],
} as const satisfies Record<string, readonly AnalyticsEventName[]>;
