import React from "react";
import { Text, View } from "react-native";
import { ScreenShell } from "./ScreenShell";

export function LoginPlaceholderScreen() {
  return (
    <ScreenShell title="Login">
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16 }}>
        <Text style={{ fontSize: 16 }}>Login placeholder. TODO: integrate Google/Firebase auth flow for mobile.</Text>
      </View>
    </ScreenShell>
  );
}
