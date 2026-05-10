import React from "react";
import { Text, View } from "react-native";
import { ScreenShell } from "./ScreenShell";

export function AchievementsScreen() {
  return (
    <ScreenShell title="Achievements">
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16 }}>
        <Text>Achievements placeholder.</Text>
      </View>
    </ScreenShell>
  );
}
