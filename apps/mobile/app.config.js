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

module.exports = {
  expo: {
    name: "Family Chores Mobile",
    slug: "family-chores-mobile",
    scheme: "familychores",
    plugins: [
      [
        "@react-native-google-signin/google-signin",
        iosUrlScheme ? { iosUrlScheme } : {},
      ],
    ],
    android: {
      package: "com.orcwood.familychores",
    },
    ios: {
      bundleIdentifier: "com.orcwood.familychores",
    },
  },
};
