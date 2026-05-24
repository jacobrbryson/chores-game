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
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId,
  });

  React.useEffect(() => {
    if (response?.type !== "success") {
      return;
    }
    const idToken = response.params?.id_token;
    if (!idToken) {
      return;
    }
    signInWithGoogleIdToken(idToken)
      .then(() => onSignedIn?.())
      .catch((error) => {
        console.error("[MOBILE_GOOGLE_SIGNIN_ERROR]", error);
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
            This mobile login will use the same Google client setup as the web app (`NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `EXPO_PUBLIC_GOOGLE_CLIENT_ID`).
          </Text>
          <Button
            label="Sign in with Google"
            onPress={() => {
              if (!request || !clientId) return;
              promptAsync();
            }}
            disabled={!request || !clientId}
          />
          {!clientId ? <Text style={styles.error}>Missing `EXPO_PUBLIC_GOOGLE_CLIENT_ID` in mobile env.</Text> : null}
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
