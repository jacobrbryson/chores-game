import React from "react";
import { Text, View } from "react-native";
import { ScreenShell } from "./ScreenShell";

export function QuestsScreen() {
  return (
    <ScreenShell title="Quests">
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16 }}>
        <Text>Quest library placeholder.</Text>
      </View>
    </ScreenShell>
  );
}
