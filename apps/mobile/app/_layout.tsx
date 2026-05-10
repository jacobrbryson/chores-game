import { Tabs } from "expo-router";

export default function Layout() {
  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="chores" options={{ title: "Chores" }} />
      <Tabs.Screen name="rewards" options={{ title: "Rewards" }} />
      <Tabs.Screen name="quests" options={{ title: "Quests" }} />
      <Tabs.Screen name="achievements" options={{ title: "Achievements" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
      <Tabs.Screen name="login" options={{ title: "Login" }} />
    </Tabs>
  );
}
