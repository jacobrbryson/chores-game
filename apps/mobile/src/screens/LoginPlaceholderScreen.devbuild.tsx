import React from "react";
import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import {
  GoogleSignin,
  isCancelledResponse,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { GoogleSignInActionButton } from "@/components/GoogleSignInActionButton";
import { AppleSignInActionButton } from "@/components/AppleSignInActionButton";
import { MobileLoginLayout } from "@/components/MobileLoginLayout";
import { ServerUnreachableError, signInWithAppleIdToken, signInWithGoogleIdToken } from "@/lib/api";
import { useMobileLocale } from "@/lib/locale";

type Props = {
  onSignedIn?: () => void;
};

// Native Google sign-in via @react-native-google-signin. Requires the native
// module to be compiled in (a development or production build) — it cannot run
// in Expo Go. The runtime switch in LoginPlaceholderScreen.native.tsx only
// require()s this file when NOT running in Expo Go.
export function LoginPlaceholderScreen({ onSignedIn }: Props) {
  const { t } = useMobileLocale();
  const webClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ??
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ??
    "";
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [appleAvailable, setAppleAvailable] = React.useState(false);
  const requiredConfigReady = Platform.OS === "ios" ? Boolean(webClientId && iosClientId) : Boolean(webClientId);

  React.useEffect(() => {
    GoogleSignin.configure({
      webClientId,
      iosClientId: iosClientId || undefined,
      offlineAccess: false,
      profileImageSize: 120,
    });
  }, [iosClientId, webClientId]);

  React.useEffect(() => {
    if (Platform.OS === "ios") {
      void AppleAuthentication.isAvailableAsync().then(setAppleAvailable);
    }
  }, []);

  async function onApplePress() {
    if (pending || !appleAvailable) return;
    setPending(true);
    setError("");
    try {
      const nonceBytes = await Crypto.getRandomBytesAsync(32);
      const rawNonce = Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      const idToken = credential.identityToken?.trim() ?? "";
      if (!idToken) throw new Error("APPLE_ID_TOKEN_MISSING");
      await signInWithAppleIdToken({
        idToken,
        rawNonce,
        user: credential.fullName
          ? { givenName: credential.fullName.givenName, familyName: credential.fullName.familyName }
          : undefined,
      });
      onSignedIn?.();
    } catch (nextError) {
      const code = nextError && typeof nextError === "object" && "code" in nextError
        ? String((nextError as { code?: unknown }).code ?? "")
        : "";
      if (code !== "ERR_REQUEST_CANCELED") {
        setError(nextError instanceof ServerUnreachableError
          ? t("auth.serverUnreachable")
          : t("auth.appleSignInFailed"));
      }
    } finally {
      setPending(false);
    }
  }

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
      if (nextError instanceof ServerUnreachableError) {
        setError("Couldn't reach the server. Check your internet connection and try again.");
      } else if (isErrorWithCode(nextError)) {
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

  const configError = !requiredConfigReady
    ? Platform.OS === "ios"
      ? "Missing `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` or `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` in mobile env."
      : "Missing `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in mobile env."
    : "";

  return (
    <MobileLoginLayout
      googleButton={
        <GoogleSignInActionButton
          disabled={!requiredConfigReady || pending}
          onPress={() => {
            void onPress();
          }}
        />
      }
      appleButton={Platform.OS === "ios" && appleAvailable ? (
        <AppleSignInActionButton
          disabled={pending}
          onPress={() => { void onApplePress(); }}
        />
      ) : undefined}
      error={error}
      configError={configError}
    />
  );
}
