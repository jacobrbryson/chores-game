// Per-request state shared by two concerns that both need "the current request":
//
//  1. Instrumentation — how many Firestore round trips this request made and how
//     long they took, surfaced as a Server-Timing header so the cost of a route
//     is visible in browser devtools without any external tooling.
//  2. Memoization — a scratch cache so a single request stops re-fetching the
//     same identity/membership document. Measured on the chore completion path:
//     `users/{uid}` was fetched ~10 times and `families/*/members/{uid}` ~5 times
//     in one request, each a separate 60-300ms round trip.
//
// Everything degrades to a no-op outside a request scope, so library code can
// call these unconditionally and unit tests need no special setup.

export type RequestTiming = {
  firestoreCalls: number;
  firestoreMs: number;
  memoHits: number;
};

type RequestStore = RequestTiming & {
  memo: Map<string, Promise<unknown>>;
};

type AsyncStore<T> = {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
};

// `node:async_hooks` must never reach a browser bundle. Server-only modules like
// `firestore/rest.ts` are transitively imported by client components (e.g.
// app/family/page.tsx pulls it in via lib/family/rewards.ts), and a static
// `import ... from "node:async_hooks"` there fails the webpack client build with
// UnhandledSchemeError — breaking the page, while `tsc` and the unit tests both
// still pass.
//
// Resolving the module indirectly keeps it out of webpack's static import graph.
// Anywhere it cannot be loaded — the browser, or a runtime without it — every
// helper below degrades to a safe no-op: timings read zero and memoization
// becomes a passthrough. Neither changes behaviour, only observability.
let storageResolved = false;
let storage: AsyncStore<RequestStore> | null = null;

function getStorage(): AsyncStore<RequestStore> | null {
  if (storageResolved) {
    return storage;
  }
  storageResolved = true;

  type AlsModule = { AsyncLocalStorage?: new () => AsyncStore<RequestStore> };
  const load = (): AlsModule | undefined => {
    const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
    if (typeof proc?.getBuiltinModule === "function") {
      return proc.getBuiltinModule("node:async_hooks") as AlsModule;
    }
    // Older Node without process.getBuiltinModule: fall back to a require that
    // webpack cannot statically analyse. Throws (and is caught) in ESM/browser.
    const req = (0, eval)("typeof require === 'function' ? require : undefined") as
      | ((id: string) => unknown)
      | undefined;
    return req?.("node:async_hooks") as AlsModule | undefined;
  };

  try {
    const mod = load();
    if (mod?.AsyncLocalStorage) {
      storage = new mod.AsyncLocalStorage();
    }
  } catch {
    storage = null;
  }
  return storage;
}

export function createRequestStore(): RequestStore {
  return { firestoreCalls: 0, firestoreMs: 0, memoHits: 0, memo: new Map() };
}

export function runWithRequestStore<T>(store: RequestStore, fn: () => Promise<T>): Promise<T> {
  const als = getStorage();
  return als ? als.run(store, fn) : fn();
}

export function readTiming(store: RequestStore): RequestTiming {
  return {
    firestoreCalls: store.firestoreCalls,
    firestoreMs: store.firestoreMs,
    memoHits: store.memoHits,
  };
}

// Called by the Firestore clients around every round trip.
export function recordFirestoreCall(durationMs: number) {
  const store = getStorage()?.getStore();
  if (!store) {
    return;
  }
  store.firestoreCalls += 1;
  store.firestoreMs += durationMs;
}

// Deduplicates an async read within one request. The *promise* is cached, so
// concurrent callers with the same key share a single in-flight round trip
// rather than racing duplicates.
//
// Only safe for reads that are stable for the life of a request — identity and
// membership lookups. Never use it for a document the same request also writes:
// a cached read taken before the write would be returned again afterwards.
export function memoizePerRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const store = getStorage()?.getStore();
  if (!store) {
    return fn();
  }
  const existing = store.memo.get(key);
  if (existing) {
    store.memoHits += 1;
    return existing as Promise<T>;
  }
  const pending = fn();
  store.memo.set(key, pending);
  // A rejected read must not be cached: `runWithRefreshedFirebaseToken` retries
  // its callback after refreshing an expired token, and a poisoned entry would
  // make the retry fail exactly as the first attempt did.
  pending.catch(() => {
    if (store.memo.get(key) === pending) {
      store.memo.delete(key);
    }
  });
  return pending;
}

// Tolerates a missing timing on purpose: this is a diagnostics header, and it
// must never be the reason a user's request fails. Callers that mock or wrap
// `runWithRefreshedFirebaseToken` may not supply one.
export function formatServerTiming(timing?: RequestTiming): string {
  if (!timing) {
    return `fs;desc="firestore calls";dur=0`;
  }
  return [
    `fs;desc="firestore calls";dur=${timing.firestoreMs}`,
    `fscount;desc="${timing.firestoreCalls} calls"`,
    `memo;desc="${timing.memoHits} cached reads"`,
  ].join(", ");
}
