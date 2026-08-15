import React from "react";
import * as AppleAuthentication from "expo-apple-authentication";
import { StyleSheet } from "react-native";

export function AppleSignInActionButton({ disabled, onPress }: {
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
      cornerRadius={8}
      onPress={onPress}
      pointerEvents={disabled ? "none" : "auto"}
      style={[styles.button, disabled && styles.disabled]}
    />
  );
}

const styles = StyleSheet.create({
  button: { width: 280, height: 48 },
  disabled: { opacity: 0.6 },
});
