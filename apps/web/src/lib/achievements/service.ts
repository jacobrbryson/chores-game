import {
  createOrReplaceDocument,
  documentIdFromName,
  getDocument,
  integerField,
  listDocuments,
  readBoolean,
  readInteger,
  readString,
  stringField,
  timestampField,
  type FirestoreValue,
} from "@/lib/firestore/rest";
import {
  ACHIEVEMENT_BY_ID,
  ACHIEVEMENT_CATALOG,
  type AchievementAudience,
} from "@/lib/achievements/catalog";
import { getAchievementCatalogCopy } from "@/lib/achievements/catalog-locales";
import { publishAchievementUnlocked } from "@/lib/ws/publish-achievement-unlocked";
import { resolveLocalePreference, type AppLocale } from "@packages/locales";

type ViewerRole = "admin" | "player";

type AchievementProgressDoc = {
  achievementId: string;
  progress: number;
  target: number;
  percentComplete: number;
  completed: boolean;
  completedAt?: string;
  updatedAt: string;
  lastEventId?: string;
};

export type AchievementResponseItem = {
  id: string;
  audience: AchievementAudience;
  title: string;
  wittyTitle: string;
  description: string;
  imageUrl: string;
  metricType: string;
  target: number;
  sortOrder: number;
  progress: number;
  percentComplete: number;
  completed: boolean;
  completedAt?: string;
  locked: boolean;
  restricted: boolean;
};

type TrackAchievementInput = {
  uid: string;
  familyId: string;
  idToken: string;
  viewerRole: ViewerRole;
  eventId: string;
  occurredAt?: string;
  metricDeltas?: Record<string, number>;
  metricMaximums?: Record<string, number>;
  rejectionFlagSet?: boolean;
  consumeRejectionFlagOnComplete?: boolean;
  approvalStreakDelta?: "increment" | "reset";
  profileCustomizationKey?: "theme" | "avatar" | "confetti";
};

type AchievementState = {
  approvalStreak: number;
  hasPendingRejection: boolean;
  profileThemeSeen: boolean;
  profileAvatarSeen: boolean;
  profileConfettiSeen: boolean;
};

function normalizeInt(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function toProgressDoc(
  achievementId: string,
  fields: Record<string, FirestoreValue> | undefined,
): AchievementProgressDoc {
  return {
    achievementId,
    progress: normalizeInt(readInteger(fields, "progress")),
    target: normalizeInt(readInteger(fields, "target")),
    percentComplete: normalizeInt(readInteger(fields, "percentComplete")),
    completed: readBoolean(fields, "completed"),
    completedAt: readString(fields, "completedAt") || undefined,
    updatedAt: readString(fields, "updatedAt") || "",
    lastEventId: readString(fields, "lastEventId") || undefined,
  };
}

function defaultProgressDoc(achievementId: string, target: number): AchievementProgressDoc {
  return {
    achievementId,
    progress: 0,
    target,
    percentComplete: 0,
    completed: false,
    completedAt: undefined,
    updatedAt: "",
    lastEventId: undefined,
  };
}

async function listAchievementDocs(uid: string, idToken: string) {
  const docs = await listDocuments(`users/${uid}/achievements`, idToken, 200);
  const byId = new Map<string, AchievementProgressDoc>();
  for (const doc of docs) {
    const achievementId = documentIdFromName(doc.name);
    if (!achievementId || !ACHIEVEMENT_BY_ID.has(achievementId)) {
      continue;
    }
    byId.set(achievementId, toProgressDoc(achievementId, doc.fields));
  }
  return byId;
}

function getAllowedAudiences(viewerRole: ViewerRole) {
  return viewerRole === "admin" ? new Set<AchievementAudience>(["player", "admin"]) : new Set<AchievementAudience>(["player"]);
}

export async function getAchievementViewForUser(params: {
  uid: string;
  idToken: string;
  viewerRole: ViewerRole;
  locale: AppLocale;
}) {
  const docsById = await listAchievementDocs(params.uid, params.idToken);
  return ACHIEVEMENT_CATALOG.map((entry) => {
    const progressDoc = docsById.get(entry.id) ?? defaultProgressDoc(entry.id, entry.target);
    const restricted = params.viewerRole === "player" && entry.audience === "admin";
    const progress = restricted ? 0 : Math.min(entry.target, progressDoc.progress);
    const percentComplete = restricted ? 0 : Math.min(100, normalizeInt((progress / entry.target) * 100));
    const completed = restricted ? false : progressDoc.completed && progress >= entry.target;
    const copy = getAchievementCatalogCopy(entry.id, params.locale, {
      title: entry.title,
      wittyTitle: entry.wittyTitle,
      description: entry.description,
    });
    return {
      id: entry.id,
      audience: entry.audience,
      title: copy.title,
      wittyTitle: copy.wittyTitle,
      description: copy.description,
      imageUrl: entry.imageUrl,
      metricType: entry.metricType,
      target: entry.target,
      sortOrder: entry.sortOrder,
      progress,
      percentComplete,
      completed,
      completedAt: completed ? progressDoc.completedAt : undefined,
      locked: !completed,
      restricted,
    } satisfies AchievementResponseItem;
  });
}

function toState(fields: Record<string, FirestoreValue> | undefined): AchievementState {
  return {
    approvalStreak: normalizeInt(readInteger(fields, "approvalStreak")),
    hasPendingRejection: readBoolean(fields, "hasPendingRejection"),
    profileThemeSeen: readBoolean(fields, "profileThemeSeen"),
    profileAvatarSeen: readBoolean(fields, "profileAvatarSeen"),
    profileConfettiSeen: readBoolean(fields, "profileConfettiSeen"),
  };
}

async function readAchievementState(uid: string, idToken: string): Promise<AchievementState> {
  try {
    const doc = await getDocument(`users/${uid}/achievementState/state`, idToken);
    return toState(doc.fields);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return {
        approvalStreak: 0,
        hasPendingRejection: false,
        profileThemeSeen: false,
        profileAvatarSeen: false,
        profileConfettiSeen: false,
      };
    }
    throw error;
  }
}

async function writeAchievementState(uid: string, idToken: string, state: AchievementState, now: string) {
  await createOrReplaceDocument(
    `users/${uid}/achievementState/state`,
    {
      approvalStreak: integerField(state.approvalStreak),
      hasPendingRejection: { booleanValue: state.hasPendingRejection },
      profileThemeSeen: { booleanValue: state.profileThemeSeen },
      profileAvatarSeen: { booleanValue: state.profileAvatarSeen },
      profileConfettiSeen: { booleanValue: state.profileConfettiSeen },
      updatedAt: timestampField(now),
    },
    idToken,
  );
}

async function writeAchievementEventAudit(input: {
  idToken: string;
  familyId: string;
  uid: string;
  eventId: string;
  now: string;
}) {
  const eventDocId = input.eventId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "event";
  await createOrReplaceDocument(
    `families/${input.familyId}/achievementEvents/${eventDocId}`,
    {
      eventId: stringField(input.eventId),
      uid: stringField(input.uid),
      updatedAt: timestampField(input.now),
    },
    input.idToken,
  );
}

function weekKeyFromIso(iso: string) {
  const date = new Date(iso);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

async function resolveAchievementLocale(input: {
  uid: string;
  familyId: string;
  idToken: string;
}): Promise<AppLocale> {
  let requestedLocale = "";
  let familyLocale = "";

  try {
    const userDoc = await getDocument(`users/${input.uid}`, input.idToken);
    requestedLocale = readString(userDoc.fields, "locale");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  try {
    const familyDoc = await getDocument(`families/${input.familyId}`, input.idToken);
    familyLocale = readString(familyDoc.fields, "defaultLocale");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (!reason.includes("FIRESTORE_HTTP_404")) {
      throw error;
    }
  }

  return resolveLocalePreference({
    requestedLocale,
    familyLocale,
  });
}

export async function computeCompletionDerivedMaximums(params: {
  familyId: string;
  uid: string;
  idToken: string;
  completedAtIso: string;
}) {
  const [memberDocs, choreDocs] = await Promise.all([
    listDocuments(`families/${params.familyId}/members`, params.idToken, 300),
    listDocuments(`families/${params.familyId}/chores`, params.idToken, 2000),
  ]);
  const aliases = new Set<string>([params.uid]);
  for (const member of memberDocs) {
    if (readBoolean(member.fields, "deleted")) {
      continue;
    }
    const memberId = documentIdFromName(member.name);
    const memberUid = readString(member.fields, "uid");
    if (memberId === params.uid || memberUid === params.uid) {
      aliases.add(memberId);
      if (memberUid) {
        aliases.add(memberUid);
      }
      const memberEmail = readString(member.fields, "email").trim().toLowerCase();
      if (memberEmail) {
        aliases.add(memberEmail);
      }
    }
  }

  const perDay = new Map<string, number>();
  const perWeek = new Map<string, number>();
  const distinctCategories = new Set<string>();
  const completionDays = new Set<string>();
  const completedDayForAllAssignees = new Map<string, Set<string>>();

  for (const chore of choreDocs) {
    if (readBoolean(chore.fields, "deleted")) {
      continue;
    }
    const status = readString(chore.fields, "status");
    if (status !== "Submitted" && status !== "Approved") {
      continue;
    }
    const completedAt = readString(chore.fields, "submittedAt") || readString(chore.fields, "updatedAt");
    if (!completedAt) {
      continue;
    }
    const dayKey = completedAt.slice(0, 10);
    const weekKey = weekKeyFromIso(completedAt);
    const assigneeId = readString(chore.fields, "assigneeId").trim().toLowerCase();
    if (assigneeId) {
      const currentSet = completedDayForAllAssignees.get(dayKey) ?? new Set<string>();
      currentSet.add(assigneeId);
      completedDayForAllAssignees.set(dayKey, currentSet);
    }

    const belongsToUser = aliases.has(assigneeId) || aliases.has(readString(chore.fields, "assigneeId"));
    if (!belongsToUser) {
      continue;
    }
    perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
    perWeek.set(weekKey, (perWeek.get(weekKey) ?? 0) + 1);
    completionDays.add(dayKey);
    const categoryIds = readString(chore.fields, "categoryIds");
    if (categoryIds) {
      distinctCategories.add(categoryIds);
    }
    for (const entry of (chore.fields?.categoryIds && "arrayValue" in chore.fields.categoryIds
      ? (chore.fields.categoryIds.arrayValue.values ?? [])
      : [])) {
      if ("stringValue" in entry && entry.stringValue) {
        distinctCategories.add(entry.stringValue);
      }
    }
  }

  const todayKey = params.completedAtIso.slice(0, 10);
  const streakDays = Array.from(completionDays).sort();
  let streak = 0;
  let cursor = todayKey;
  while (streakDays.includes(cursor)) {
    streak += 1;
    const cursorDate = new Date(`${cursor}T00:00:00.000Z`);
    cursorDate.setUTCDate(cursorDate.getUTCDate() - 1);
    cursor = cursorDate.toISOString().slice(0, 10);
  }

  return {
    chores_completed_single_day: Math.max(...perDay.values(), 0),
    chores_completed_single_week: Math.max(...perWeek.values(), 0),
    daily_completion_streak: streak,
    distinct_categories_completed: distinctCategories.size,
    shared_family_completion_days: (completedDayForAllAssignees.get(todayKey)?.size ?? 0) >= 3 ? 1 : 0,
  } satisfies Record<string, number>;
}

export async function trackAchievementEvent(input: TrackAchievementInput) {
  const now = input.occurredAt || new Date().toISOString();
  const metricDeltas = { ...(input.metricDeltas ?? {}) };
  const metricMaximums = { ...(input.metricMaximums ?? {}) };
  const state = await readAchievementState(input.uid, input.idToken);
  let stateChanged = false;

  if (input.approvalStreakDelta === "increment") {
    state.approvalStreak += 1;
    metricMaximums.approval_streak_without_rejection = Math.max(
      metricMaximums.approval_streak_without_rejection ?? 0,
      state.approvalStreak,
    );
    stateChanged = true;
  } else if (input.approvalStreakDelta === "reset") {
    state.approvalStreak = 0;
    stateChanged = true;
  }
  if (input.rejectionFlagSet) {
    state.hasPendingRejection = true;
    stateChanged = true;
  }
  if (input.consumeRejectionFlagOnComplete && state.hasPendingRejection) {
    metricDeltas.post_rejection_completions = (metricDeltas.post_rejection_completions ?? 0) + 1;
    state.hasPendingRejection = false;
    stateChanged = true;
  }
  if (input.profileCustomizationKey === "theme" && !state.profileThemeSeen) {
    state.profileThemeSeen = true;
    metricDeltas.profile_customization_set = (metricDeltas.profile_customization_set ?? 0) + 1;
    stateChanged = true;
  }
  if (input.profileCustomizationKey === "avatar" && !state.profileAvatarSeen) {
    state.profileAvatarSeen = true;
    metricDeltas.profile_customization_set = (metricDeltas.profile_customization_set ?? 0) + 1;
    stateChanged = true;
  }
  if (input.profileCustomizationKey === "confetti" && !state.profileConfettiSeen) {
    state.profileConfettiSeen = true;
    metricDeltas.profile_customization_set = (metricDeltas.profile_customization_set ?? 0) + 1;
    stateChanged = true;
  }
  if (stateChanged) {
    await writeAchievementState(input.uid, input.idToken, state, now);
  }

  const docsById = await listAchievementDocs(input.uid, input.idToken);
  const achievementLocale = await resolveAchievementLocale({
    uid: input.uid,
    familyId: input.familyId,
    idToken: input.idToken,
  });
  const allowedAudiences = getAllowedAudiences(input.viewerRole);
  const unlocked: Array<{
    achievementId: string;
    title: string;
    wittyTitle: string;
    description: string;
    imageUrl: string;
    completedAt: string;
    userId: string;
    familyId: string;
  }> = [];

  for (const catalogEntry of ACHIEVEMENT_CATALOG) {
    if (!allowedAudiences.has(catalogEntry.audience)) {
      continue;
    }
    const existing = docsById.get(catalogEntry.id) ?? defaultProgressDoc(catalogEntry.id, catalogEntry.target);
    const delta = normalizeInt(metricDeltas[catalogEntry.metricType] ?? 0);
    const maxValue = normalizeInt(metricMaximums[catalogEntry.metricType] ?? 0);
    if (delta === 0 && maxValue === 0) {
      continue;
    }
    const eventAlreadyApplied = existing.lastEventId === input.eventId;
    const deltaContribution = eventAlreadyApplied ? 0 : delta;
    const nextProgress = Math.min(
      catalogEntry.target,
      Math.max(existing.progress + deltaContribution, maxValue),
    );
    const justCompleted = !existing.completed && nextProgress >= catalogEntry.target;
    if (
      nextProgress === existing.progress &&
      existing.completed === (existing.completed || justCompleted) &&
      existing.lastEventId === input.eventId
    ) {
      continue;
    }
    const nextCompleted = existing.completed || justCompleted;
    const nextCompletedAt = existing.completedAt || (justCompleted ? now : "");
    const nextPercent = Math.min(100, normalizeInt((nextProgress / catalogEntry.target) * 100));
    await createOrReplaceDocument(
      `users/${input.uid}/achievements/${catalogEntry.id}`,
      {
        achievementId: stringField(catalogEntry.id),
        progress: integerField(nextProgress),
        target: integerField(catalogEntry.target),
        percentComplete: integerField(nextPercent),
        completed: { booleanValue: nextCompleted },
        completedAt: nextCompletedAt ? timestampField(nextCompletedAt) : stringField(""),
        updatedAt: timestampField(now),
        lastEventId: stringField(input.eventId),
      },
      input.idToken,
    );
    if (justCompleted) {
      const copy = getAchievementCatalogCopy(catalogEntry.id, achievementLocale, {
        title: catalogEntry.title,
        wittyTitle: catalogEntry.wittyTitle,
        description: catalogEntry.description,
      });
      unlocked.push({
        achievementId: catalogEntry.id,
        title: copy.title,
        wittyTitle: copy.wittyTitle,
        description: copy.description,
        imageUrl: catalogEntry.imageUrl,
        completedAt: now,
        userId: input.uid,
        familyId: input.familyId,
      });
    }
  }

  if (unlocked.length > 0) {
    await Promise.all(
      unlocked.map((payload) =>
        publishAchievementUnlocked({
          type: "achievement:unlocked",
          ...payload,
        }),
      ),
    );
  }
  await writeAchievementEventAudit({
    idToken: input.idToken,
    familyId: input.familyId,
    uid: input.uid,
    eventId: input.eventId,
    now,
  });
  return unlocked;
}
