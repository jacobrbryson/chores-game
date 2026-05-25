import type { ComponentType } from "react";
import { Platform } from "react-native";

type Props = {
  onSignedIn?: () => void;
};

const LoginPlaceholderScreenImpl =
  Platform.OS === "web"
    ? require("./LoginPlaceholderScreen.web").LoginPlaceholderScreen
    : require("./LoginPlaceholderScreen.native").LoginPlaceholderScreen;

export const LoginPlaceholderScreen = LoginPlaceholderScreenImpl as ComponentType<Props>;
