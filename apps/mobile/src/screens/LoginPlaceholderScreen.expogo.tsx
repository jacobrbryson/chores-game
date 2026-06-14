import React from "react";
import { GoogleSignInActionButton } from "@/components/GoogleSignInActionButton";
import { MobileLoginLayout } from "@/components/MobileLoginLayout";

type Props = {
  onSignedIn?: () => void;
};

export function LoginPlaceholderScreen(_props: Props) {
  return (
    <MobileLoginLayout
      googleButton={<GoogleSignInActionButton disabled label="Use a development build" onPress={() => {}} />}
      configError="Google sign-in cannot run in Expo Go because it requires native Google Sign-In. Run the Android development build, then start Expo in dev-client mode."
    />
  );
}
