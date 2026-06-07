import { DISCOVERY_COUNT_HARD_CAP, type ViewerRole } from "@/lib/discovery/types";

// Pure counting helpers. These take already-loaded, plain records plus the
// section's lastSeenAt and return an unseen count. Keeping them free of
// Firestore I/O makes the counting rules straightforward to unit test.

function toMillis(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// An item is unseen when it was created/published/completed strictly after the
// viewer last looked. A null lastSeenAt means the viewer has never opened the
// section, so everything qualifying is unseen.
export function isUnseen(itemTimestamp: string | undefined, lastSeenAt: string | null): boolean {
  if (!itemTimestamp) {
    return false;
  }
  if (lastSeenAt === null) {
    return true;
  }
  return toMillis(itemTimestamp) > toMillis(lastSeenAt);
}

export function capCount(count: number): number {
  if (count < 0) {
    return 0;
  }
  return Math.min(count, DISCOVERY_COUNT_HARD_CAP);
}

function normalizeAlias(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export type DiscoveryChoreRecord = {
  createdAt: string;
  status: string;
  deleted: boolean;
  assigneeId: string;
  assigneeIds: string[];
  assigneeScope?: string;
};

function choreBelongsToViewer(chore: DiscoveryChoreRecord, aliases: Set<string>): boolean {
  if (normalizeAlias(chore.assigneeScope) === "family") {
    return true;
  }
  if (aliases.has(normalizeAlias(chore.assigneeId))) {
    return true;
  }
  return chore.assigneeIds.some((id) => aliases.has(normalizeAlias(id)));
}

// A. Chores.
// Players: open chores assigned to the active profile created after lastSeen.
// Admins: open chores created anywhere in the family after lastSeen.
// Only "Open" chores are counted so completed/approved/rejected work and deleted
// chores never inflate the badge. Ghost suggestions live in a separate
// collection and are never included.
export function countNewChores(input: {
  chores: DiscoveryChoreRecord[];
  viewerRole: ViewerRole;
  aliases: string[];
  lastSeenAt: string | null;
}): number {
  const aliasSet = new Set(input.aliases.map(normalizeAlias).filter(Boolean));
  let count = 0;
  for (const chore of input.chores) {
    if (chore.deleted) {
      continue;
    }
    if (chore.status !== "Open") {
      continue;
    }
    if (!isUnseen(chore.createdAt, input.lastSeenAt)) {
      continue;
    }
    if (input.viewerRole !== "admin" && !choreBelongsToViewer(chore, aliasSet)) {
      continue;
    }
    count += 1;
    if (count >= DISCOVERY_COUNT_HARD_CAP) {
      break;
    }
  }
  return capCount(count);
}

// Generic "items with a timestamp after lastSeen" counter. Used for store
// catalog options, family rewards, quests, changelog, etc. The caller is
// responsible for pre-filtering to items the viewer is allowed to see.
export function countNewByTimestamp(
  timestamps: Array<string | undefined>,
  lastSeenAt: string | null,
): number {
  let count = 0;
  for (const timestamp of timestamps) {
    if (isUnseen(timestamp, lastSeenAt)) {
      count += 1;
      if (count >= DISCOVERY_COUNT_HARD_CAP) {
        break;
      }
    }
  }
  return capCount(count);
}

// E. Changelog. Entry dates are day-granular (YYYY-MM-DD); compare on the
// last-seen day so same-day entries that were already viewed don't re-badge.
export function countNewChangelog(input: {
  entryDates: string[];
  lastSeenAt: string | null;
}): number {
  const lastSeenDay = input.lastSeenAt ? input.lastSeenAt.slice(0, 10) : null;
  let count = 0;
  for (const date of input.entryDates) {
    if (lastSeenDay === null || date > lastSeenDay) {
      count += 1;
      if (count >= DISCOVERY_COUNT_HARD_CAP) {
        break;
      }
    }
  }
  return capCount(count);
}

export type DiscoveryAchievementRecord = {
  audience: "player" | "admin";
  completed: boolean;
  completedAt?: string;
};

// D. Achievements (newly completed). Count achievements completed after
// lastSeen that the viewer's role is allowed to see. Players never count
// admin-audience achievements.
export function countNewCompletedAchievements(input: {
  achievements: DiscoveryAchievementRecord[];
  viewerRole: ViewerRole;
  lastSeenAt: string | null;
}): number {
  let count = 0;
  for (const achievement of input.achievements) {
    if (!achievement.completed) {
      continue;
    }
    if (input.viewerRole !== "admin" && achievement.audience === "admin") {
      continue;
    }
    if (!isUnseen(achievement.completedAt, input.lastSeenAt)) {
      continue;
    }
    count += 1;
    if (count >= DISCOVERY_COUNT_HARD_CAP) {
      break;
    }
  }
  return capCount(count);
}
