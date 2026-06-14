import { describe, expect, it } from "vitest";
import {
  shouldReloadChoresPageList,
  shouldReloadFamilySummary,
} from "@/lib/ws/realtime-refresh";

describe("realtime refresh policies", () => {
  it("reloads the chores page for list-shaping chore events", () => {
    expect(shouldReloadChoresPageList("chore_created")).toBe(true);
    expect(shouldReloadChoresPageList("chore_updated")).toBe(true);
    expect(shouldReloadChoresPageList("chore_deleted")).toBe(true);
    expect(shouldReloadChoresPageList("chore_reordered")).toBe(true);
    expect(shouldReloadChoresPageList("chore_completed")).toBe(false);
    expect(shouldReloadChoresPageList("theme_changed")).toBe(false);
  });

  it("reloads the dashboard summary for events that can change visible chores", () => {
    expect(shouldReloadFamilySummary("chore_completed")).toBe(true);
    expect(shouldReloadFamilySummary("chore_created")).toBe(true);
    expect(shouldReloadFamilySummary("chore_updated")).toBe(true);
    expect(shouldReloadFamilySummary("chore_deleted")).toBe(true);
    expect(shouldReloadFamilySummary("chore_reordered")).toBe(true);
    expect(shouldReloadFamilySummary("theme_changed")).toBe(true);
    expect(shouldReloadFamilySummary("avatar_changed")).toBe(true);
    expect(shouldReloadFamilySummary("routine_completed")).toBe(false);
  });
});
