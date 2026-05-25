import React from "react";
import { StyleSheet, Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { colors, typography } from "@/theme";
import { AppScreen, Button, Card, SectionHeader } from "@/components/ui";
import { signInWithGoogleIdToken } from "@/lib/api";

WebBrowser.maybeCompleteAuthSession();

type Props = {
  onSignedIn?: () => void;
};

export function LoginPlaceholderScreen({ onSignedIn }: Props) {
  const webClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ??
    "";
  const [error, setError] = React.useState("");
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId,
  });

  React.useEffect(() => {
    if (response?.type !== "success") {
      if (response?.type === "error") {
        setError("Google sign-in failed before the app could create a session.");
      }
      return;
    }
    const idToken = response.params?.id_token;
    if (!idToken) {
      setError("Google sign-in completed without an ID token.");
      return;
    }
    setError("");
    signInWithGoogleIdToken(idToken)
      .then(() => onSignedIn?.())
      .catch((nextError) => {
        console.error("[MOBILE_WEB_GOOGLE_SIGNIN_ERROR]", nextError);
        setError(nextError instanceof Error && nextError.message ? nextError.message : "Google sign-in failed.");
      });
  }, [onSignedIn, response]);

  return (
    <AppScreen title="Login Required" subtitle="Sign in with Google to continue">
      <Card>
        <SectionHeader title="Google Sign-In" />
        <View style={styles.box}>
          <Text style={styles.text}>
            You are currently signed out. To continue in the mobile app, sign in with the same Google account you use for Family Chores on web.
          </Text>
          <Text style={styles.text}>
            Browser builds use the web OAuth client. Native Android and iOS builds use the Google Sign-In SDK directly instead of a browser redirect flow.
          </Text>
          <Button
            label="Sign in with Google"
            onPress={() => {
              if (!request || !webClientId) return;
              promptAsync();
            }}
            disabled={!request || !webClientId}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!webClientId ? (
            <Text style={styles.error}>Missing `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in mobile env.</Text>
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
