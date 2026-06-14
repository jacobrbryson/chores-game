import type { ComponentType } from "react";
import Constants, { ExecutionEnvironment } from "expo-constants";

type Props = {
  onSignedIn?: () => void;
};

// Expo Go cannot load native modules, so the @react-native-google-signin flow
// would crash there with "RNGoogleSignin could not be found". The old
// AuthSession fallback now reaches Google with an exp:// redirect URI that
// Google rejects, so Expo Go gets an explicit unsupported state. Compiled
// builds (dev client / production) use the native Google Sign-In flow.
//
// The require() calls are intentionally lazy: only the branch we actually use
// is evaluated, so the native module is never touched under Expo Go.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const LoginPlaceholderScreenImpl = (
  isExpoGo
    ? require("./LoginPlaceholderScreen.expogo").LoginPlaceholderScreen
    : require("./LoginPlaceholderScreen.devbuild").LoginPlaceholderScreen
) as ComponentType<Props>;

export const LoginPlaceholderScreen = LoginPlaceholderScreenImpl;
