import React from "react";
import { Text, View } from "react-native";
import { ScreenShell } from "./ScreenShell";

export function HomeScreen() {
  return (
    <ScreenShell title="Home">
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16 }}>
        <Text>Welcome to Family Chores mobile.</Text>
      </View>
    </ScreenShell>
  );
}
