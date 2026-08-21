function reverseGoogleClientId(clientId) {
  const normalized = String(clientId || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.split(".").reverse().join(".");
}

const iosClientId =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ??
  process.env.GOOGLE_IOS_CLIENT_ID ??
  "";

const iosUrlScheme = reverseGoogleClientId(iosClientId);
// Assets live inside the mobile project root so Metro/Expo can serve them in
// dev. They are copies of apps/web/public/icons/* — re-copy if the web icons
// change. Referencing the web paths directly (../web/public/...) puts them
// outside the project root, which aborts manifest asset resolution in dev.
const icon192 = "./assets/icon-192.png";
const icon512 = "./assets/icon-512.png";
const favicon = "./assets/favicon-96.png";

module.exports = {
  expo: {
    name: "Family Chores Mobile",
    slug: "family-chores-mobile",
    scheme: "familychores",
    extra: {
      eas: {
        projectId: "c5dbfef1-e830-4990-a00c-49fab177fcd5",
      },
    },
    icon: icon512,
    splash: {
      image: icon512,
      resizeMode: "contain",
      backgroundColor: "#ebf4fb",
    },
    // EAS disables local .env loading while it resolves the project before
    // fetching remote environment variables. The Google Sign-In config plugin
    // exits Expo config when iosUrlScheme is empty, including for Android-only
    // commands, so include it only when the iOS client is actually configured.
    plugins: [
      ...(iosUrlScheme
        ? [["@react-native-google-signin/google-signin", { iosUrlScheme }]]
        : []),
      "expo-apple-authentication",
      // Push notifications (achievement unlocks, family activity). The plugin
      // wires up the Android notification icon/channel and the iOS entitlement;
      // delivery itself needs FCM/APNs credentials on the EAS project.
      ["expo-notifications", { icon: icon192, color: "#0072b2" }],
    ],
    android: {
      package: "com.orcwood.familychores",
      icon: icon512,
      blockedPermissions: [
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.SYSTEM_ALERT_WINDOW",
      ],
      adaptiveIcon: {
        foregroundImage: icon512,
        backgroundColor: "#ebf4fb",
      },
    },
    ios: {
      bundleIdentifier: "com.orcwood.familychores",
      icon: icon512,
      usesAppleSignIn: true,
    },
    web: {
      favicon,
      icon: icon192,
    },
  },
};
