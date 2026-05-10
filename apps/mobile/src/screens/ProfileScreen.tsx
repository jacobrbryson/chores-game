import React from "react";
import { Text, View } from "react-native";
import { ScreenShell } from "./ScreenShell";

export function ProfileScreen() {
  return (
    <ScreenShell title="Profile">
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16 }}>
        <Text>Profile placeholder.</Text>
      </View>
    </ScreenShell>
  );
}
