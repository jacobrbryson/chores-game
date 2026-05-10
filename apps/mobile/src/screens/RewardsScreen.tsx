import React from "react";
import { Text, View } from "react-native";
import { ScreenShell } from "./ScreenShell";

export function RewardsScreen() {
  return (
    <ScreenShell title="Rewards">
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 16 }}>
        <Text>Rewards list placeholder (connected to api-client next pass).</Text>
      </View>
    </ScreenShell>
  );
}
