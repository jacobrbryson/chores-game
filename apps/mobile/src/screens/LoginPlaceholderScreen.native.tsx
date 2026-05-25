import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { colors, typography } from "@/theme";
import { AppScreen, Button, Card, SectionHeader } from "@/components/ui";
import { signInWithGoogleIdToken } from "@/lib/api";

type Props = {
  onSignedIn?: () => void;
};

export function LoginPlaceholderScreen({ onSignedIn }: Props) {
  const webClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ??
    "";
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const requiredConfigReady = Platform.OS === "ios" ? Boolean(webClientId && iosClientId) : Boolean(webClientId);

  React.useEffect(() => {
    GoogleSignin.configure({
      webClientId,
      iosClientId: iosClientId || undefined,
      offlineAccess: false,
      profileImageSize: 120,
    });
  }, [iosClientId, webClientId]);

  async function onPress() {
    if (!requiredConfigReady || pending) {
      return;
    }

    setPending(true);
    setError("");

    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (isCancelledResponse(response)) {
        return;
      }
      if (!isSuccessResponse(response)) {
        setError("Google sign-in did not complete.");
        return;
      }
      const tokens = await GoogleSignin.getTokens();
      const idToken = tokens.idToken?.trim() ?? "";
      if (!idToken) {
        setError("Google sign-in completed without an ID token.");
        return;
      }
      await signInWithGoogleIdToken(idToken);
      onSignedIn?.();
    } catch (nextError) {
      if (isErrorWithCode(nextError)) {
        switch (nextError.code) {
          case statusCodes.IN_PROGRESS:
            setError("Google sign-in is already in progress.");
            break;
          case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
            setError("Google Play Services are not available on this device.");
            break;
          default:
            setError(nextError.message || "Google sign-in failed.");
            break;
        }
      } else {
        setError(nextError instanceof Error && nextError.message ? nextError.message : "Google sign-in failed.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <AppScreen title="Login Required" subtitle="Sign in with Google to continue">
      <Card>
        <SectionHeader title="Google Sign-In" />
        <View style={styles.box}>
          <Text style={styles.text}>
            You are currently signed out. To continue in the mobile app, sign in with the same Google account you use for Family Chores on web.
          </Text>
          <Text style={styles.text}>
            Native builds now use the Google Sign-In SDK directly. This avoids the Android browser redirect exception and matches Google&apos;s recommended long-term setup better than browser-based OAuth on native.
          </Text>
          <Button
            label={pending ? "Signing in..." : "Sign in with Google"}
            onPress={() => {
              void onPress();
            }}
            disabled={!requiredConfigReady || pending}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!requiredConfigReady ? (
            <Text style={styles.error}>
              {Platform.OS === "ios"
                ? "Missing `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` or `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in mobile env."
                : "Missing `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in mobile env."}
            </Text>
          ) : null}
        </View>
      </Card>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  box: { gap: 12 },
  text: { color: colors.muted, fontSize: typography.body },
  error: { color: "#b91c1c", fontSize: typography.small, fontWeight: "700" },
});
