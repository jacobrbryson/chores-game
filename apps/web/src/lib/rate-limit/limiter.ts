// Reusable, family-scoped rate limiter backed by Firestore counter documents.
//
// Counters live at `families/{familyId}/rateLimits/{counterId}` and are written
// with the acting user's Firebase ID token, so Firestore security rules apply
// (see firestore.rules -> match /rateLimits/{counterId}). The design is generic
// so additional creatable resources (chores, members, categories, awards, ...)
// can opt in by adding an entry to RATE_LIMITS — only `support_request` is wired
// today.

import {
  createOrReplaceDocument,
  getDocument,
  integerField,
  patchDocument,
  readInteger,
  stringField,
  timestampField,
} from "@/lib/firestore/rest";

export type RateLimitScope = "user" | "family";

export type RateLimitRule = {
  scope: RateLimitScope;
  // Maximum number of allowed actions within the rolling daily (UTC) window.
  limit: number;
};

// Registry of rate-limited actions. Extend this to cover other end-user
// creatable resources; the helpers below are intentionally action-agnostic.
export const RATE_LIMITS = {
  support_request: [
    { scope: "user", limit: 10 },
    { scope: "family", limit: 30 },
  ],
} satisfies Record<string, RateLimitRule[]>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

export type RateLimitContext = {
  action: RateLimitAction;
  familyId: string;
  uid: string;
  idToken: string;
  // Defaults to now; injectable for tests.
  now?: Date;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; scope: RateLimitScope; limit: number };

function windowKeyFor(now: Date) {
  // Daily UTC window, e.g. "2026-05-31".
  return now.toISOString().slice(0, 10);
}

function subjectIdFor(scope: RateLimitScope, ctx: RateLimitContext) {
  return scope === "family" ? ctx.familyId : ctx.uid;
}

function counterIdFor(scope: RateLimitScope, ctx: RateLimitContext, windowKey: string) {
  return `${ctx.action}__${scope}__${subjectIdFor(scope, ctx)}__${windowKey}`;
}

function counterPathFor(scope: RateLimitScope, ctx: RateLimitContext, windowKey: string) {
  return `families/${ctx.familyId}/rateLimits/${counterIdFor(scope, ctx, windowKey)}`;
}

async function readCount(path: string, idToken: string): Promise<number> {
  try {
    const doc = await getDocument(path, idToken);
    return readInteger(doc.fields, "count");
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return 0;
    }
    throw error;
  }
}

// Returns whether another action is currently allowed without mutating counters.
export async function checkRateLimit(ctx: RateLimitContext): Promise<RateLimitResult> {
  const rules = RATE_LIMITS[ctx.action];
  const windowKey = windowKeyFor(ctx.now ?? new Date());
  for (const rule of rules) {
    const count = await readCount(counterPathFor(rule.scope, ctx, windowKey), ctx.idToken);
    if (count >= rule.limit) {
      return { allowed: false, scope: rule.scope, limit: rule.limit };
    }
  }
  return { allowed: true };
}

// Increments every scope counter for the action by one. Best-effort: call this
// only after the underlying resource was created. Counter writes are monotonic
// (rules reject decrements), so an interrupted increment can only under-count.
export async function consumeRateLimit(ctx: RateLimitContext): Promise<void> {
  const rules = RATE_LIMITS[ctx.action];
  const now = ctx.now ?? new Date();
  const windowKey = windowKeyFor(now);
  const nowIso = now.toISOString();

  for (const rule of rules) {
    const path = counterPathFor(rule.scope, ctx, windowKey);
    const current = await readCount(path, ctx.idToken);
    if (current <= 0) {
      await createOrReplaceDocument(
        path,
        {
          familyId: stringField(ctx.familyId),
          action: stringField(ctx.action),
          scope: stringField(rule.scope),
          subjectId: stringField(subjectIdFor(rule.scope, ctx)),
          windowKey: stringField(windowKey),
          count: integerField(1),
          createdAt: timestampField(nowIso),
          updatedAt: timestampField(nowIso),
        },
        ctx.idToken,
      );
    } else {
      await patchDocument(
        path,
        {
          count: integerField(current + 1),
          updatedAt: timestampField(nowIso),
        },
        ctx.idToken,
        ["count", "updatedAt"],
      );
    }
  }
}
