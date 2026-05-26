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
const icon192 = "../web/public/icons/web-app-manifest-192x192.png";
const icon512 = "../web/public/icons/web-app-manifest-512x512.png";
const favicon = "../web/public/icons/favicon-96x96.png";

module.exports = {
  expo: {
    name: "Family Chores Mobile",
    slug: "family-chores-mobile",
    scheme: "familychores",
    icon: icon512,
    splash: {
      image: icon512,
      resizeMode: "contain",
      backgroundColor: "#ebf4fb",
    },
    plugins: [
      [
        "@react-native-google-signin/google-signin",
        iosUrlScheme ? { iosUrlScheme } : {},
      ],
    ],
    android: {
      package: "com.orcwood.familychores",
      icon: icon512,
      adaptiveIcon: {
        foregroundImage: icon512,
        backgroundColor: "#ebf4fb",
      },
    },
    ios: {
      bundleIdentifier: "com.orcwood.familychores",
      icon: icon512,
    },
    web: {
      favicon,
      icon: icon192,
    },
  },
};
