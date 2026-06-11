import { getDocument, readString } from "@/lib/firestore/rest";
import {
  getAuthenticatedSessionIdentity,
  isKioskActive,
  type SessionUser,
} from "@/lib/auth/session";
import { verifyAccountSwitchPin } from "@/lib/auth/account-switch";

// Identifies activity that originated from the shared-family Kiosk Mode so the
// notification/feed/websocket layers can distinguish it from a normal in-app
// completion. Stored on completion events alongside the authenticated user id
// and the player the chore was completed for.
export const KIOSK_EVENT_SOURCE = "kiosk" as const;
export const APP_EVENT_SOURCE = "app" as const;

export type ActivitySource = typeof KIOSK_EVENT_SOURCE | typeof APP_EVENT_SOURCE;

// Returns whether the authenticated account behind this session has a profile
// switch PIN configured. Kiosk Mode reuses that same PIN (never a second PIN
// system); when no PIN exists the enter/exit/switch flows run without one.
export async function kioskPinConfigured(uid: string, idToken: string) {
  try {
    const userDoc = await getDocument(`users/${uid}`, idToken);
    return readString(userDoc.fields, "accountSwitchPinHash").trim().length > 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason.includes("FIRESTORE_HTTP_404")) {
      return false;
    }
    throw error;
  }
}

export type KioskPinResult =
  | { ok: true }
  | { ok: false; reason: "invalid_pin" };

// Verifies the kiosk PIN against the authenticated account, reusing the
// existing profile-switch PIN. When the account has no PIN configured the gate
// passes (kiosk is usable without a PIN, matching "the same PIN flow used for
// switching profiles, if the app already has one").
export async function verifyKioskPin(
  authenticatedUid: string,
  pin: string,
  idToken: string,
): Promise<KioskPinResult> {
  if (!(await kioskPinConfigured(authenticatedUid, idToken))) {
    return { ok: true };
  }
  const result = await verifyAccountSwitchPin(authenticatedUid, pin, idToken);
  if (result.ok) {
    return { ok: true };
  }
  // pin_not_configured is already handled above; any failure here is a bad PIN.
  return { ok: false, reason: "invalid_pin" };
}

export type KioskActivityMetadata = {
  source: ActivitySource;
  authenticatedUid: string;
  completedForPlayerId: string;
};

// Builds the actor metadata attached to chore-completion events. When Kiosk
// Mode is active the current identity is the selected player (so the player is
// recorded as the completer / actor) while the original signed-in account is
// surfaced separately as authenticated_user_id. Parent notifications are NOT
// suppressed: the actor is the player, so guardians are still notified.
export function buildKioskActivityMetadata(
  session: SessionUser,
  completedForPlayerId: string,
): KioskActivityMetadata {
  const playerId = completedForPlayerId || session.uid;
  if (!isKioskActive(session)) {
    return {
      source: APP_EVENT_SOURCE,
      authenticatedUid: session.uid,
      completedForPlayerId: playerId,
    };
  }
  const authenticated = getAuthenticatedSessionIdentity(session);
  return {
    source: KIOSK_EVENT_SOURCE,
    authenticatedUid: authenticated.uid,
    completedForPlayerId: playerId,
  };
}
