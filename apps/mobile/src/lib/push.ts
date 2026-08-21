import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { apiFetch } from "@/lib/api";

// Which family events this device wants. The server keeps one copy of these per
// registered device, so two phones on the same account can differ.
export type MobilePushSettings = {
  choreCompleted: boolean;
  rewardClaimed: boolean;
  choreApprovalRequired: boolean;
  achievementUnlocked: boolean;
};

// Turning notifications on from the app is a single switch, and achievement
// unlocks are the reason a player wants it — the rest stay off until the web
// profile's per-type toggles say otherwise.
export const DEFAULT_MOBILE_PUSH_SETTINGS: MobilePushSettings = {
  choreCompleted: false,
  rewardClaimed: false,
  choreApprovalRequired: false,
  achievementUnlocked: true,
};

export type MobilePushRegistrationStatus =
  | "registered"
  | "denied"
  | "unsupported"
  | "failed";

const STORED_TOKEN_KEY = "mobile:push:expoPushToken";
const ANDROID_CHANNEL_ID = "default";

// Expo Go on Android can no longer receive remote push (SDK 53+), and a
// simulator has no push token at all. Both cases are "unsupported" rather than
// failures, so the UI can explain instead of showing an error.
function supportsRemotePush() {
  if (!Device.isDevice) {
    return false;
  }
  return !(Platform.OS === "android" && Constants.appOwnership === "expo");
}

function resolveProjectId() {
  const fromEas = Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined;
  const fromEasConfig = (Constants as unknown as {
    easConfig?: { projectId?: string };
  }).easConfig;
  return (fromEas?.projectId ?? fromEasConfig?.projectId ?? "").trim();
}

function resolvePlatform() {
  if (Platform.OS === "ios" || Platform.OS === "android") {
    return Platform.OS;
  }
  return "unknown";
}

// A push that lands while the app is open should still surface: without this,
// expo-notifications swallows foreground notifications on both platforms.
export function configureMobilePushHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") {
    return;
  }
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "Family Chores",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

export async function readStoredPushToken() {
  try {
    return (await AsyncStorage.getItem(STORED_TOKEN_KEY)) ?? "";
  } catch {
    return "";
  }
}

export async function getMobilePushPermission() {
  if (!supportsRemotePush()) {
    return "unsupported" as const;
  }
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === "granted" ? ("granted" as const) : ("default" as const);
  } catch {
    return "default" as const;
  }
}

// Asks for permission if needed, then hands the device's Expo push token to the
// server. Safe to call on every launch: re-registering the same token rewrites
// the same document, and leaving `settings` out keeps the toggles it already
// has.
export async function registerMobilePushDevice(
  settings?: MobilePushSettings,
): Promise<MobilePushRegistrationStatus> {
  if (!supportsRemotePush()) {
    return "unsupported";
  }

  try {
    await ensureAndroidChannel();
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.status === "granted";
    if (!granted && existing.canAskAgain !== false) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.status === "granted";
    }
    if (!granted) {
      return "denied";
    }

    const projectId = resolveProjectId();
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const expoPushToken = tokenResponse.data?.trim() ?? "";
    if (!expoPushToken) {
      return "failed";
    }

    await apiFetch("/push-devices", {
      method: "POST",
      body: JSON.stringify({
        expoPushToken,
        platform: resolvePlatform(),
        permission: "granted",
        // Omitting settings tells the server to keep whatever this device
        // already chose, which is what the silent launch refresh wants.
        ...(settings ? { settings } : {}),
      }),
    });
    await AsyncStorage.setItem(STORED_TOKEN_KEY, expoPushToken);
    return "registered";
  } catch {
    return "failed";
  }
}

// Drops this device's registration server-side. The OS-level permission stays
// granted — the user revokes that in system settings — but nothing is sent here
// any more.
export async function unregisterMobilePushDevice() {
  const expoPushToken = await readStoredPushToken();
  try {
    await apiFetch("/push-devices", {
      method: "DELETE",
      body: JSON.stringify(expoPushToken ? { expoPushToken } : {}),
    });
  } catch {
    // Best effort: a failed unregister still clears the local token below so the
    // switch reflects what the user asked for.
  }
  try {
    await AsyncStorage.removeItem(STORED_TOKEN_KEY);
  } catch {
    // Ignore storage errors.
  }
}

// Fires when the user taps a notification. The server puts the web target path
// on the payload (`/achievements`, `/notifications`, …); the caller maps that to
// a mobile tab.
export function addMobilePushResponseListener(onOpenUrl: (url: string) => void) {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { url?: unknown } | undefined;
    const url = typeof data?.url === "string" ? data.url : "";
    if (url) {
      onOpenUrl(url);
    }
  });
  return () => subscription.remove();
}

// The notification that launched a cold-started app is not delivered to the
// listener above, so it is read once at startup instead.
export async function readMobilePushLaunchUrl() {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    const data = response?.notification.request.content.data as { url?: unknown } | undefined;
    return typeof data?.url === "string" ? data.url : "";
  } catch {
    return "";
  }
}
