import React from "react";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import { GoogleSignInActionButton } from "@/components/GoogleSignInActionButton";
import { MobileLoginLayout } from "@/components/MobileLoginLayout";
import { signInWithGoogleIdToken } from "@/lib/api";

WebBrowser.maybeCompleteAuthSession();

type Props = {
  onSignedIn?: () => void;
};

// Browser-based Google sign-in via expo-auth-session for web. Native Android
// and iOS sign-in lives in LoginPlaceholderScreen.devbuild.tsx.
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
    <MobileLoginLayout
      googleButton={
        <GoogleSignInActionButton
          disabled={!request || !webClientId}
          onPress={() => {
            if (!request || !webClientId) return;
            promptAsync();
          }}
        />
      }
      error={error}
      configError={!webClientId ? "Missing `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in mobile env." : ""}
    />
  );
}
