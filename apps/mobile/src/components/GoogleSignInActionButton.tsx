import React from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { radius } from "@/theme";

const googleGIcon = require("../assets/google-g.png");

type Props = {
  disabled?: boolean;
  label?: string;
  onPress: () => void;
};

export function GoogleSignInActionButton({ disabled, label = "Sign in with Google", onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        <Image source={googleGIcon} style={styles.icon} resizeMode="contain" />
        <Text style={styles.text}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 280,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#747775",
    borderRadius: radius.sm,
    backgroundColor: "#fff",
    paddingLeft: 12,
    paddingRight: 12,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  icon: {
    width: 18,
    height: 18,
  },
  text: {
    color: "#1f1f1f",
    fontFamily: Platform.select({
      android: "Roboto",
      web: "Roboto, Arial, sans-serif",
      default: undefined,
    }),
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.84,
  },
  disabled: {
    opacity: 0.6,
  },
});
