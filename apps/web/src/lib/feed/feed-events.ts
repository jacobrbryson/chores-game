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
  "routine_created",
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
  routine_created: "routine_created",
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
  routine_created: "routine",
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
  routine_created: "📋",
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

// One chore inside a finished routine, as rolled up onto its routine_completed
// event. Lets the feed render the whole routine as a single card with its list
// of chores.
export type FeedRoutineStep = {
  choreId: string;
  title: string;
  coinValue: number;
  skipped: boolean;
};

const MAX_FEED_ROUTINE_STEPS = 40;

export function parseFeedRoutineSteps(value: string): FeedRoutineStep[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .slice(0, MAX_FEED_ROUTINE_STEPS)
      .map((entry) => {
        const step = (entry ?? {}) as Record<string, unknown>;
        return {
          choreId: typeof step.choreId === "string" ? step.choreId : "",
          title: typeof step.title === "string" ? step.title : "",
          coinValue: Number.isFinite(Number(step.coinValue))
            ? Math.max(0, Math.trunc(Number(step.coinValue)))
            : 0,
          skipped: step.skipped === true,
        } satisfies FeedRoutineStep;
      })
      .filter((step) => Boolean(step.title));
  } catch {
    // A malformed snapshot must never break the feed — fall back to no roll-up,
    // which just leaves the per-step events visible as before.
    return [];
  }
}

type CollapsibleFeedItem = {
  type: FeedEventType;
  message: string;
  createdAt: string;
  actor: { uid: string; name: string } | null;
  metadata: {
    choreId?: string;
    choreTitle?: string;
    routineName?: string;
    routineSteps?: FeedRoutineStep[];
    dayChores?: FeedRoutineStep[];
  };
};

// A routine step, recovered from the human-readable activity message of a
// completion/approval event. Activity written before the step roll-up existed
// carries no structured routine metadata, so the message is the only link back
// to the routine it belonged to.
export type ParsedRoutineStepMessage = {
  routineName: string;
  choreTitle: string;
  order: number;
  coinValue: number;
};

// " (step 2 of 6 in the "Morning" routine)" / " (part of the "Morning" routine)"
const ROUTINE_STEP_CONTEXT = /\((?:step (\d+) of \d+ in|part of) the "([^"\r\n]+)" routine\)/;
const ROUTINE_STEP_TITLE =
  /"([^"\r\n]+)"\s*\((?:step \d+ of \d+ in|part of) the "[^"\r\n]+" routine\)/;
const ROUTINE_STEP_COINS = /earned (\d+) coins/;

export function parseRoutineStepMessage(message: string): ParsedRoutineStepMessage | null {
  const context = message.match(ROUTINE_STEP_CONTEXT);
  if (!context) {
    return null;
  }
  return {
    routineName: (context[2] ?? "").trim(),
    choreTitle: (message.match(ROUTINE_STEP_TITLE)?.[1] ?? "").trim(),
    order: Number(context[1] ?? 0) || 0,
    coinValue: Number(message.match(ROUTINE_STEP_COINS)?.[1] ?? 0) || 0,
  };
}

// How far back a legacy routine completion looks for its own step events. Steps
// are also allowed slightly *after* the celebration: the final step's completion
// event is written just after the routine finishes.
const LEGACY_ROUTINE_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const LEGACY_ROUTINE_GRACE_MS = 5 * 60 * 1000;

function normalizeRoutineName(value: string) {
  return value.trim().toLowerCase();
}

function itemMillis(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function actorKeyOf(item: { actor: { uid: string; name: string } | null }) {
  return normalizeRoutineName(item.actor?.uid || item.actor?.name || "");
}

// Two events belong to the same person. An unresolved actor on either side is
// treated as a match so a missing profile never blocks the roll-up.
function sameActor(a: CollapsibleFeedItem, b: CollapsibleFeedItem) {
  const left = actorKeyOf(a);
  const right = actorKeyOf(b);
  return !left || !right || left === right;
}

// Rebuilds the step list for routine completions that predate the recorded
// snapshot, by matching their step events on routine name, actor, and time.
// This is inference from message text rather than recorded fact, so it is only
// ever applied to events that carry no snapshot of their own.
function deriveLegacyRoutineSteps<T extends CollapsibleFeedItem>(
  items: T[],
  alreadyRolledUp: ReadonlySet<string>,
): Map<T, FeedRoutineStep[]> {
  const derived = new Map<T, FeedRoutineStep[]>();
  const legacyRoutines = items.filter(
    (item) => item.type === "routine_completed" && !item.metadata.routineSteps?.length,
  );
  if (legacyRoutines.length === 0) {
    return derived;
  }
  const candidates = items
    .filter(
      (item) =>
        (item.type === "chore_completed" || item.type === "chore_approved") &&
        Boolean(item.metadata.choreId) &&
        !alreadyRolledUp.has(item.metadata.choreId ?? ""),
    )
    .map((item) => ({
      item,
      step: parseRoutineStepMessage(item.message),
      millis: itemMillis(item.createdAt),
    }))
    .filter(
      (candidate): candidate is typeof candidate & { step: ParsedRoutineStepMessage } =>
        candidate.step !== null && Boolean(candidate.step.routineName),
    );
  if (candidates.length === 0) {
    return derived;
  }

  const claimed = new Set<string>();
  // Oldest routine first, so a daily routine's earlier occurrence claims its own
  // steps before a later one can reach back for them.
  const orderedRoutines = [...legacyRoutines].sort(
    (a, b) => itemMillis(a.createdAt) - itemMillis(b.createdAt),
  );
  for (const routine of orderedRoutines) {
    const routineName = normalizeRoutineName(
      routine.metadata.routineName || routineNameFromFeedMessage(routine.message),
    );
    if (!routineName) {
      continue;
    }
    const completedAt = itemMillis(routine.createdAt);
    const matched = candidates.filter(
      (candidate) =>
        !claimed.has(candidate.item.metadata.choreId ?? "") &&
        normalizeRoutineName(candidate.step.routineName) === routineName &&
        sameActor(routine, candidate.item) &&
        candidate.millis >= completedAt - LEGACY_ROUTINE_LOOKBACK_MS &&
        candidate.millis <= completedAt + LEGACY_ROUTINE_GRACE_MS,
    );
    if (matched.length === 0) {
      continue;
    }
    for (const candidate of matched) {
      claimed.add(candidate.item.metadata.choreId ?? "");
    }
    derived.set(
      routine,
      matched
        .sort((a, b) => a.step.order - b.step.order || a.millis - b.millis)
        .map((candidate) => ({
          choreId: candidate.item.metadata.choreId ?? "",
          title: candidate.item.metadata.choreTitle || candidate.step.choreTitle,
          coinValue: candidate.step.coinValue,
          skipped: false,
        }))
        .filter((step) => Boolean(step.title)),
    );
  }
  return derived;
}

// Condenses a finished routine into a single card: the individual completion and
// approval events for its steps are dropped, and the routine card carries the
// list of chores instead. Routines completed since the roll-up shipped carry
// their own recorded step snapshot; older ones fall back to matching their step
// events by message. A routine still in progress keeps showing its steps one by
// one.
export function collapseCompletedRoutineSteps<T extends CollapsibleFeedItem>(items: T[]): T[] {
  const rolledUpChoreIds = new Set<string>();
  for (const item of items) {
    if (item.type !== "routine_completed") {
      continue;
    }
    for (const step of item.metadata.routineSteps ?? []) {
      if (step.choreId) {
        rolledUpChoreIds.add(step.choreId);
      }
    }
  }

  const legacySteps = deriveLegacyRoutineSteps(items, rolledUpChoreIds);
  for (const steps of legacySteps.values()) {
    for (const step of steps) {
      if (step.choreId) {
        rolledUpChoreIds.add(step.choreId);
      }
    }
  }

  if (rolledUpChoreIds.size === 0) {
    return items;
  }
  return items
    .filter((item) => {
      if (item.type !== "chore_completed" && item.type !== "chore_approved") {
        return true;
      }
      return !item.metadata.choreId || !rolledUpChoreIds.has(item.metadata.choreId);
    })
    .map((item) => {
      const steps = legacySteps.get(item);
      if (!steps?.length) {
        return item;
      }
      // Spreading a generic keeps every caller-specific field intact; only the
      // recovered step list is added.
      return { ...item, metadata: { ...item.metadata, routineSteps: steps } } as T;
    });
}

// Routine activity written before routineId/routineName metadata was added
// still carries the template name in the human-readable activity message.
// This fallback keeps those existing Feed cards actionable.
export function routineNameFromFeedMessage(message: string): string {
  const match = message.match(/"([^"\r\n]+)"\s+routine\b/i);
  return match?.[1]?.trim() ?? "";
}

// Daily roll-up: a busy day produces one "on fire" card per person instead of a
// wall of near-identical events. Tiers are purely cosmetic flair chosen from the
// day's count; "steady" is the plain wording for a day with only a couple.
export type FeedDayRollupTier = "steady" | "roll" | "fire" | "unstoppable";

// Two of anything on one day is already worth condensing — the card lists every
// chore, so nothing is lost by folding them together.
export const FEED_DAY_ROLLUP_MIN_CHORES = 2;

export function feedDayRollupTier(choreCount: number): FeedDayRollupTier {
  if (choreCount >= 10) {
    return "unstoppable";
  }
  if (choreCount >= 6) {
    return "fire";
  }
  return choreCount >= 3 ? "roll" : "steady";
}

// Which kind of daily activity a roll-up card stands in for. Completions get the
// celebratory tiers; chores a parent added are summarized plainly.
export type FeedDayRollupKind = "completed" | "created";

const DAY_MILLIS = 24 * 60 * 60 * 1000;

// The calendar day an event falls on for a viewer, as YYYY-MM-DD.
// `tzOffsetMinutes` follows the Date#getTimezoneOffset convention already used
// by the chores routes: minutes to subtract from UTC to reach local time.
export function feedDayKey(createdAt: string, tzOffsetMinutes: number): string {
  const parsed = Date.parse(createdAt);
  if (Number.isNaN(parsed)) {
    return "";
  }
  return new Date(parsed - tzOffsetMinutes * 60 * 1000).toISOString().slice(0, 10);
}

export function feedDayLabelKey(
  dayKey: string,
  tzOffsetMinutes: number,
  now = Date.now(),
): "today" | "yesterday" | "date" {
  const today = feedDayKey(new Date(now).toISOString(), tzOffsetMinutes);
  if (dayKey === today) {
    return "today";
  }
  if (dayKey === feedDayKey(new Date(now - DAY_MILLIS).toISOString(), tzOffsetMinutes)) {
    return "yesterday";
  }
  return "date";
}

type GroupableFeedItem = CollapsibleFeedItem & { id: string };

export type FeedDayRollupGroup<T> = {
  actorName: string;
  actorKey: string;
  dayKey: string;
  chores: FeedRoutineStep[];
  coinsEarned: number;
  // In the order they arrived, which is the order they were listed in.
  items: T[];
};

// Replaces one person's chores of a single kind on a single day with one
// summary, once there are enough of them to be worth condensing. Everything else
// — a quiet day, approvals, rewards, routine cards — passes through untouched.
// The summary takes the position of that day's first listed event, so the
// surrounding order holds. Run it once per kind (completions, then additions).
export function groupDailyFeedActivity<T extends GroupableFeedItem>(
  items: T[],
  options: {
    groupType: FeedEventType;
    tzOffsetMinutes: number;
    minChores?: number;
    createSummary: (group: FeedDayRollupGroup<T>) => T | null;
  },
): T[] {
  const minChores = options.minChores ?? FEED_DAY_ROLLUP_MIN_CHORES;
  const groups = new Map<string, FeedDayRollupGroup<T>>();
  for (const item of items) {
    // A summary produced by an earlier pass carries its own chore list and must
    // never be folded into another one.
    if (item.type !== options.groupType || !item.actor || item.metadata.dayChores) {
      continue;
    }
    const dayKey = feedDayKey(item.createdAt, options.tzOffsetMinutes);
    const actorKey = actorKeyOf(item);
    if (!dayKey || !actorKey) {
      continue;
    }
    const key = `${actorKey}|${dayKey}`;
    const group = groups.get(key) ?? {
      actorName: item.actor.name,
      actorKey,
      dayKey,
      chores: [],
      coinsEarned: 0,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }

  const summaryByFirstItemId = new Map<string, T>();
  const replacedItemIds = new Set<string>();
  for (const group of groups.values()) {
    // Re-completed chores (undo then complete again) must not inflate the count.
    const seenChoreIds = new Set<string>();
    for (const item of [...group.items].sort(
      (a, b) => itemMillis(a.createdAt) - itemMillis(b.createdAt),
    )) {
      const choreId = item.metadata.choreId ?? "";
      if (choreId && seenChoreIds.has(choreId)) {
        continue;
      }
      seenChoreIds.add(choreId);
      const coinValue = coinValueFromFeedMessage(item.message);
      group.chores.push({
        choreId,
        title: item.metadata.choreTitle || choreTitleFromFeedMessage(item.message),
        coinValue,
        skipped: false,
      });
      group.coinsEarned += coinValue;
    }
    if (group.chores.length < minChores) {
      continue;
    }
    const summary = options.createSummary(group);
    if (!summary) {
      continue;
    }
    summaryByFirstItemId.set(group.items[0].id, summary);
    for (const item of group.items) {
      replacedItemIds.add(item.id);
    }
  }
  if (summaryByFirstItemId.size === 0) {
    return items;
  }

  const result: T[] = [];
  for (const item of items) {
    const summary = summaryByFirstItemId.get(item.id);
    if (summary) {
      result.push(summary);
      continue;
    }
    if (!replacedItemIds.has(item.id)) {
      result.push(item);
    }
  }
  return result;
}

// The chore title inside a completion or "added" message, for events whose
// stored choreTitle is empty (older activity records did not always carry one).
const FEED_CHORE_TITLE = /(?:completed|approved|marked|added)\s+"([^"\r\n]+)"/;

export function choreTitleFromFeedMessage(message: string): string {
  return (message.match(FEED_CHORE_TITLE)?.[1] ?? "").trim();
}

// Coins named by a feed message: "earned 5 coins" on a completion, "(5 coins)"
// on a newly added chore.
const FEED_CREATED_COINS = /\((\d+) coins/;

export function coinValueFromFeedMessage(message: string): number {
  const earned = message.match(ROUTINE_STEP_COINS)?.[1];
  const listed = earned ?? message.match(FEED_CREATED_COINS)?.[1];
  return Number(listed ?? 0) || 0;
}

// Optional safe deep-link action for an event. Only surfaces that the viewer can already
// reach are linked; never link to support/admin/operator-only surfaces.
export type FeedActionType =
  | "view_chore"
  | "view_reward"
  | "copy_friend_award"
  | "copy_friend_routine";

export function feedTypeAction(type: FeedEventType): FeedActionType | null {
  if (type === "reward_claimed") {
    return "view_reward";
  }
  if (type === "family_award_created") {
    return "copy_friend_award";
  }
  if (type === "routine_created" || type === "routine_completed") {
    return "copy_friend_routine";
  }
  if (type === "routine_assigned" || type === "title_unlocked") {
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
