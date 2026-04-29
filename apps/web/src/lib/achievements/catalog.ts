export const ACHIEVEMENT_AUDIENCES = ["player", "admin"] as const;
export type AchievementAudience = (typeof ACHIEVEMENT_AUDIENCES)[number];

export type AchievementCatalogEntry = {
  id: string;
  audience: AchievementAudience;
  title: string;
  description: string;
  wittyTitle: string;
  imageUrl: string;
  metricType: string;
  target: number;
  sortOrder: number;
  isVisibleToPlayers: boolean;
};

export const ACHIEVEMENT_CATALOG: AchievementCatalogEntry[] = [
  { id: "player_first_chore", audience: "player", title: "First Chore Complete", wittyTitle: "Tiny Task, Big Legend", description: "Complete your first chore.", metricType: "chores_completed", target: 1, imageUrl: "/achievements/placeholders/player_first_chore.png", sortOrder: 1, isVisibleToPlayers: true },
  { id: "player_5_chores", audience: "player", title: "5 Chores Complete", wittyTitle: "The Starter Stack", description: "Complete 5 chores.", metricType: "chores_completed", target: 5, imageUrl: "/achievements/placeholders/player_5_chores.png", sortOrder: 2, isVisibleToPlayers: true },
  { id: "player_10_chores", audience: "player", title: "10 Chores Complete", wittyTitle: "Chore Goblin Defeater", description: "Complete 10 chores.", metricType: "chores_completed", target: 10, imageUrl: "/achievements/placeholders/player_10_chores.png", sortOrder: 3, isVisibleToPlayers: true },
  { id: "player_25_chores", audience: "player", title: "25 Chores Complete", wittyTitle: "Dust Bunny Hunter", description: "Complete 25 chores.", metricType: "chores_completed", target: 25, imageUrl: "/achievements/placeholders/player_25_chores.png", sortOrder: 4, isVisibleToPlayers: true },
  { id: "player_50_chores", audience: "player", title: "50 Chores Complete", wittyTitle: "Household Hero", description: "Complete 50 chores.", metricType: "chores_completed", target: 50, imageUrl: "/achievements/placeholders/player_50_chores.png", sortOrder: 5, isVisibleToPlayers: true },
  { id: "player_100_chores", audience: "player", title: "100 Chores Complete", wittyTitle: "The Mopfather", description: "Complete 100 chores.", metricType: "chores_completed", target: 100, imageUrl: "/achievements/placeholders/player_100_chores.png", sortOrder: 6, isVisibleToPlayers: true },
  { id: "player_250_chores", audience: "player", title: "250 Chores Complete", wittyTitle: "Legend of the Laundry", description: "Complete 250 chores.", metricType: "chores_completed", target: 250, imageUrl: "/achievements/placeholders/player_250_chores.png", sortOrder: 7, isVisibleToPlayers: true },
  { id: "player_500_chores", audience: "player", title: "500 Chores Complete", wittyTitle: "Supreme Chore Wizard", description: "Complete 500 chores.", metricType: "chores_completed", target: 500, imageUrl: "/achievements/placeholders/player_500_chores.png", sortOrder: 8, isVisibleToPlayers: true },
  { id: "player_first_approval", audience: "player", title: "First Approval", wittyTitle: "Parent-Approved Power", description: "Get your first chore approved.", metricType: "chores_approved", target: 1, imageUrl: "/achievements/placeholders/player_first_approval.png", sortOrder: 9, isVisibleToPlayers: true },
  { id: "player_10_approved", audience: "player", title: "10 Approved Chores", wittyTitle: "Stamp Collector", description: "Get 10 chores approved.", metricType: "chores_approved", target: 10, imageUrl: "/achievements/placeholders/player_10_approved.png", sortOrder: 10, isVisibleToPlayers: true },
  { id: "player_50_approved", audience: "player", title: "50 Approved Chores", wittyTitle: "Certified Helpful", description: "Get 50 chores approved.", metricType: "chores_approved", target: 50, imageUrl: "/achievements/placeholders/player_50_approved.png", sortOrder: 11, isVisibleToPlayers: true },
  { id: "player_first_coin", audience: "player", title: "First Coin Earned", wittyTitle: "Cha-Ching Champion", description: "Earn your first coin.", metricType: "coins_earned", target: 1, imageUrl: "/achievements/placeholders/player_first_coin.png", sortOrder: 12, isVisibleToPlayers: true },
  { id: "player_100_coins", audience: "player", title: "100 Coins Earned", wittyTitle: "Piggy Bank Apprentice", description: "Earn 100 total coins.", metricType: "coins_earned", target: 100, imageUrl: "/achievements/placeholders/player_100_coins.png", sortOrder: 13, isVisibleToPlayers: true },
  { id: "player_500_coins", audience: "player", title: "500 Coins Earned", wittyTitle: "Allowance Architect", description: "Earn 500 total coins.", metricType: "coins_earned", target: 500, imageUrl: "/achievements/placeholders/player_500_coins.png", sortOrder: 14, isVisibleToPlayers: true },
  { id: "player_1000_coins", audience: "player", title: "1,000 Coins Earned", wittyTitle: "Coin Comet", description: "Earn 1,000 total coins.", metricType: "coins_earned", target: 1000, imageUrl: "/achievements/placeholders/player_1000_coins.png", sortOrder: 15, isVisibleToPlayers: true },
  { id: "player_first_purchase", audience: "player", title: "First Store Purchase", wittyTitle: "Retail Rascal", description: "Buy your first store item.", metricType: "store_purchases", target: 1, imageUrl: "/achievements/placeholders/player_first_purchase.png", sortOrder: 16, isVisibleToPlayers: true },
  { id: "player_5_purchases", audience: "player", title: "5 Store Purchases", wittyTitle: "Cart Commander", description: "Buy 5 store items.", metricType: "store_purchases", target: 5, imageUrl: "/achievements/placeholders/player_5_purchases.png", sortOrder: 17, isVisibleToPlayers: true },
  { id: "player_first_theme", audience: "player", title: "First Theme Applied", wittyTitle: "Fresh Paint Energy", description: "Apply a custom color theme.", metricType: "themes_applied", target: 1, imageUrl: "/achievements/placeholders/player_first_theme.png", sortOrder: 18, isVisibleToPlayers: true },
  { id: "player_first_avatar", audience: "player", title: "First Avatar Change", wittyTitle: "New Look, Who Dis?", description: "Change your avatar.", metricType: "avatars_applied", target: 1, imageUrl: "/achievements/placeholders/player_first_avatar.png", sortOrder: 19, isVisibleToPlayers: true },
  { id: "player_first_confetti", audience: "player", title: "First Confetti Style", wittyTitle: "Party Settings Unlocked", description: "Apply a victory confetti style.", metricType: "confetti_applied", target: 1, imageUrl: "/achievements/placeholders/player_first_confetti.png", sortOrder: 20, isVisibleToPlayers: true },
  { id: "player_first_reward", audience: "player", title: "First Family Award", wittyTitle: "Prize Patrol", description: "Redeem your first family award.", metricType: "family_awards_redeemed", target: 1, imageUrl: "/achievements/placeholders/player_first_reward.png", sortOrder: 21, isVisibleToPlayers: true },
  { id: "player_5_rewards", audience: "player", title: "5 Family Awards", wittyTitle: "Reward Regular", description: "Redeem 5 family awards.", metricType: "family_awards_redeemed", target: 5, imageUrl: "/achievements/placeholders/player_5_rewards.png", sortOrder: 22, isVisibleToPlayers: true },
  { id: "player_daily_3", audience: "player", title: "3 Chores in One Day", wittyTitle: "Triple Sweep", description: "Complete 3 chores in one day.", metricType: "chores_completed_single_day", target: 3, imageUrl: "/achievements/placeholders/player_daily_3.png", sortOrder: 23, isVisibleToPlayers: true },
  { id: "player_daily_5", audience: "player", title: "5 Chores in One Day", wittyTitle: "Chore Storm", description: "Complete 5 chores in one day.", metricType: "chores_completed_single_day", target: 5, imageUrl: "/achievements/placeholders/player_daily_5.png", sortOrder: 24, isVisibleToPlayers: true },
  { id: "player_weekly_10", audience: "player", title: "10 Chores in One Week", wittyTitle: "Weekly Wipeout", description: "Complete 10 chores in one week.", metricType: "chores_completed_single_week", target: 10, imageUrl: "/achievements/placeholders/player_weekly_10.png", sortOrder: 25, isVisibleToPlayers: true },
  { id: "player_weekly_20", audience: "player", title: "20 Chores in One Week", wittyTitle: "Calendar Crusher", description: "Complete 20 chores in one week.", metricType: "chores_completed_single_week", target: 20, imageUrl: "/achievements/placeholders/player_weekly_20.png", sortOrder: 26, isVisibleToPlayers: true },
  { id: "player_streak_3", audience: "player", title: "3-Day Chore Streak", wittyTitle: "No Days Dusty", description: "Complete at least one chore for 3 days in a row.", metricType: "daily_completion_streak", target: 3, imageUrl: "/achievements/placeholders/player_streak_3.png", sortOrder: 27, isVisibleToPlayers: true },
  { id: "player_streak_7", audience: "player", title: "7-Day Chore Streak", wittyTitle: "The Week Warrior", description: "Complete at least one chore for 7 days in a row.", metricType: "daily_completion_streak", target: 7, imageUrl: "/achievements/placeholders/player_streak_7.png", sortOrder: 28, isVisibleToPlayers: true },
  { id: "player_streak_14", audience: "player", title: "14-Day Chore Streak", wittyTitle: "Fortnight Force", description: "Complete at least one chore for 14 days in a row.", metricType: "daily_completion_streak", target: 14, imageUrl: "/achievements/placeholders/player_streak_14.png", sortOrder: 29, isVisibleToPlayers: true },
  { id: "player_streak_30", audience: "player", title: "30-Day Chore Streak", wittyTitle: "Unstoppable Tidiness", description: "Complete at least one chore for 30 days in a row.", metricType: "daily_completion_streak", target: 30, imageUrl: "/achievements/placeholders/player_streak_30.png", sortOrder: 30, isVisibleToPlayers: true },
  { id: "player_morning_chore", audience: "player", title: "Morning Chore", wittyTitle: "Early Bird Gets the Broom", description: "Complete a chore before noon.", metricType: "morning_chores_completed", target: 1, imageUrl: "/achievements/placeholders/player_morning_chore.png", sortOrder: 31, isVisibleToPlayers: true },
  { id: "player_evening_chore", audience: "player", title: "Evening Chore", wittyTitle: "Night Shift Ninja", description: "Complete a chore after 6 PM.", metricType: "evening_chores_completed", target: 1, imageUrl: "/achievements/placeholders/player_evening_chore.png", sortOrder: 32, isVisibleToPlayers: true },
  { id: "player_google_task_done", audience: "player", title: "Google Task Complete", wittyTitle: "Synced and Satisfied", description: "Complete a chore synced from Google Tasks.", metricType: "google_task_chores_completed", target: 1, imageUrl: "/achievements/placeholders/player_google_task_done.png", sortOrder: 33, isVisibleToPlayers: true },
  { id: "player_category_explorer", audience: "player", title: "Category Explorer", wittyTitle: "Variety Vacuum", description: "Complete chores from 3 different categories.", metricType: "distinct_categories_completed", target: 3, imageUrl: "/achievements/placeholders/player_category_explorer.png", sortOrder: 34, isVisibleToPlayers: true },
  { id: "player_category_master", audience: "player", title: "Category Master", wittyTitle: "All-Purpose Awesome", description: "Complete chores from 5 different categories.", metricType: "distinct_categories_completed", target: 5, imageUrl: "/achievements/placeholders/player_category_master.png", sortOrder: 35, isVisibleToPlayers: true },
  { id: "player_no_rejection_10", audience: "player", title: "10 Without Rejection", wittyTitle: "Clean Approval Run", description: "Get 10 approvals without a rejection in between.", metricType: "approval_streak_without_rejection", target: 10, imageUrl: "/achievements/placeholders/player_no_rejection_10.png", sortOrder: 36, isVisibleToPlayers: true },
  { id: "player_bounceback", audience: "player", title: "Bounce Back", wittyTitle: "Rejected? Respected.", description: "Complete a chore after having one rejected.", metricType: "post_rejection_completions", target: 1, imageUrl: "/achievements/placeholders/player_bounceback.png", sortOrder: 37, isVisibleToPlayers: true },
  { id: "player_undo_recovery", audience: "player", title: "Back on Track", wittyTitle: "Undo? Redo.", description: "Complete a chore that was previously reopened.", metricType: "reopened_chores_completed", target: 1, imageUrl: "/achievements/placeholders/player_undo_recovery.png", sortOrder: 38, isVisibleToPlayers: true },
  { id: "player_profile_polish", audience: "player", title: "Profile Polish", wittyTitle: "Main Character Mode", description: "Customize avatar, theme, and confetti at least once.", metricType: "profile_customization_set", target: 3, imageUrl: "/achievements/placeholders/player_profile_polish.png", sortOrder: 39, isVisibleToPlayers: true },
  { id: "player_family_teamwork", audience: "player", title: "Family Teamwork", wittyTitle: "Squad Goals, But Cleaner", description: "Complete chores on a day when at least two family members also complete chores.", metricType: "shared_family_completion_days", target: 1, imageUrl: "/achievements/placeholders/player_family_teamwork.png", sortOrder: 40, isVisibleToPlayers: true },
  { id: "admin_first_chore_created", audience: "admin", title: "First Chore Created", wittyTitle: "Taskmaster Begins", description: "Create your first chore.", metricType: "admin_chores_created", target: 1, imageUrl: "/achievements/placeholders/admin_first_chore_created.png", sortOrder: 101, isVisibleToPlayers: false },
  { id: "admin_25_chores_created", audience: "admin", title: "25 Chores Created", wittyTitle: "List Lord", description: "Create 25 chores.", metricType: "admin_chores_created", target: 25, imageUrl: "/achievements/placeholders/admin_25_chores_created.png", sortOrder: 102, isVisibleToPlayers: false },
  { id: "admin_first_approval", audience: "admin", title: "First Approval Given", wittyTitle: "The Rubber Stamp Awakens", description: "Approve your first submitted chore.", metricType: "admin_chores_approved", target: 1, imageUrl: "/achievements/placeholders/admin_first_approval.png", sortOrder: 103, isVisibleToPlayers: false },
  { id: "admin_50_approvals", audience: "admin", title: "50 Approvals Given", wittyTitle: "Certified Certifier", description: "Approve 50 submitted chores.", metricType: "admin_chores_approved", target: 50, imageUrl: "/achievements/placeholders/admin_50_approvals.png", sortOrder: 104, isVisibleToPlayers: false },
  { id: "admin_first_reward_created", audience: "admin", title: "First Family Award Created", wittyTitle: "Prize Wizard", description: "Create your first family award.", metricType: "admin_rewards_created", target: 1, imageUrl: "/achievements/placeholders/admin_first_reward_created.png", sortOrder: 105, isVisibleToPlayers: false },
  { id: "admin_5_rewards_created", audience: "admin", title: "5 Family Awards Created", wittyTitle: "Motivation Menu Maker", description: "Create 5 family awards.", metricType: "admin_rewards_created", target: 5, imageUrl: "/achievements/placeholders/admin_5_rewards_created.png", sortOrder: 106, isVisibleToPlayers: false },
  { id: "admin_first_category", audience: "admin", title: "First Category Created", wittyTitle: "Label Legend", description: "Create your first chore category.", metricType: "admin_categories_created", target: 1, imageUrl: "/achievements/placeholders/admin_first_category.png", sortOrder: 107, isVisibleToPlayers: false },
  { id: "admin_google_tasks_linked", audience: "admin", title: "Google Tasks Linked", wittyTitle: "Calendar Conductor", description: "Link Google Tasks for chore syncing.", metricType: "admin_google_tasks_linked", target: 1, imageUrl: "/achievements/placeholders/admin_google_tasks_linked.png", sortOrder: 108, isVisibleToPlayers: false },
  { id: "admin_push_enabled", audience: "admin", title: "Push Notifications Enabled", wittyTitle: "Household Radar Online", description: "Enable browser push notifications.", metricType: "admin_push_notifications_enabled", target: 1, imageUrl: "/achievements/placeholders/admin_push_enabled.png", sortOrder: 109, isVisibleToPlayers: false },
  { id: "admin_family_builder", audience: "admin", title: "Family Builder", wittyTitle: "The Crew Assembler", description: "Add 3 active family members.", metricType: "admin_active_family_members_added", target: 3, imageUrl: "/achievements/placeholders/admin_family_builder.png", sortOrder: 110, isVisibleToPlayers: false },
];

export const ACHIEVEMENT_METRIC_TYPES = Array.from(
  new Set(ACHIEVEMENT_CATALOG.map((entry) => entry.metricType)),
).sort();
export type AchievementMetricType = (typeof ACHIEVEMENT_METRIC_TYPES)[number];

export const ACHIEVEMENT_BY_ID = new Map(
  ACHIEVEMENT_CATALOG.map((entry) => [entry.id, entry] as const),
);

function validateAchievementCatalog() {
  if (ACHIEVEMENT_CATALOG.length !== 50) {
    throw new Error(`ACHIEVEMENT_CATALOG_COUNT_INVALID_${ACHIEVEMENT_CATALOG.length}`);
  }
  const ids = new Set<string>();
  for (const entry of ACHIEVEMENT_CATALOG) {
    if (ids.has(entry.id)) {
      throw new Error(`ACHIEVEMENT_CATALOG_DUPLICATE_ID_${entry.id}`);
    }
    ids.add(entry.id);
  }
  const playerCount = ACHIEVEMENT_CATALOG.filter((entry) => entry.audience === "player").length;
  const adminCount = ACHIEVEMENT_CATALOG.filter((entry) => entry.audience === "admin").length;
  if (playerCount !== 40 || adminCount !== 10) {
    throw new Error(`ACHIEVEMENT_AUDIENCE_COUNT_INVALID_${playerCount}_${adminCount}`);
  }
}

validateAchievementCatalog();
