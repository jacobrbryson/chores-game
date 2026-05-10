import React, { useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { AchievementsScreen } from "@/screens/AchievementsScreen";
import { ChoresScreen } from "@/screens/ChoresScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { LoginPlaceholderScreen } from "@/screens/LoginPlaceholderScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { QuestsScreen } from "@/screens/QuestsScreen";
import { RewardsScreen } from "@/screens/RewardsScreen";

type TabKey = "home" | "chores" | "rewards" | "quests" | "achievements" | "profile" | "login";

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "home", label: "Home" },
  { key: "chores", label: "Chores" },
  { key: "rewards", label: "Rewards" },
  { key: "quests", label: "Quests" },
  { key: "achievements", label: "Achievements" },
  { key: "profile", label: "Profile" },
  { key: "login", label: "Login" },
];

export default function App() {
  const [tab, setTab] = useState<TabKey>("home");

  const screen = useMemo(() => {
    switch (tab) {
      case "chores":
        return <ChoresScreen />;
      case "rewards":
        return <RewardsScreen />;
      case "quests":
        return <QuestsScreen />;
      case "achievements":
        return <AchievementsScreen />;
      case "profile":
        return <ProfileScreen />;
      case "login":
        return <LoginPlaceholderScreen />;
      case "home":
      default:
        return <HomeScreen />;
    }
  }, [tab]);

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView horizontal style={{ maxHeight: 52, backgroundColor: "#ffffff" }} contentContainerStyle={{ paddingHorizontal: 10, alignItems: "center" }}>
        {tabs.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => setTab(item.key)}
            style={{
              marginRight: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 999,
              backgroundColor: tab === item.key ? "#2f80ed" : "#e6f1ff",
            }}
          >
            <Text style={{ color: tab === item.key ? "#fff" : "#17406b", fontWeight: "700" }}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ flex: 1 }}>{screen}</View>
    </SafeAreaView>
  );
}
