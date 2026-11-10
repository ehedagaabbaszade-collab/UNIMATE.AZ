import { describe, expect, it } from "vitest";
import { localizedText, parseAchievements, parseLeaderboard, parseMyProgress, parseNotifications } from "./progress";

const t = { az: "a", tr: "t", en: "e", ru: "р" };
const progress = {
  xp: 1240, level: 7, level_start_xp: 1050, next_level_xp: 1400, xp_into_level: 190, xp_to_next: 160, level_progress: 0.5429,
  streak: { current: 5, longest: 9 }, achievements: { unlocked: 4, total: 8 }, leaderboard_opt_in: false,
  challenges: [{ id: "c1", title: t, description: t, metric: "xp", target: 100, progress: 40, completed: false, starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-01-08T00:00:00Z" }],
};

describe("gamification parsers", () => {
  it("parses my_progress and rejects drift", () => {
    expect(parseMyProgress(progress).level).toBe(7);
    expect(() => parseMyProgress({ ...progress, level_progress: 3 })).toThrow();
    expect(() => parseMyProgress({ xp: 1 })).toThrow();
    expect(parseMyProgress({ ...progress, next_level_xp: null }).next_level_xp).toBeNull();
  });
  it("parses achievements, leaderboard rows (bigint strings coerced) and notifications", () => {
    expect(parseAchievements([{ code: "x", name: t, description: t, icon: "xp", metric: "xp_total", target: 100, current: 5, unlocked_at: null }])).toHaveLength(1);
    expect(parseAchievements(null)).toEqual([]);
    expect(parseLeaderboard([{ rank: 1, display_name: "A", avatar_url: null, xp: "250", is_me: false }])[0]!.xp).toBe(250);
    expect(parseNotifications([{ id: "1", kind: "k", title: "T", body: null, params: { a: 1 }, read_at: null, created_at: "2026-01-01T00:00:00Z" }])[0]!.params).toEqual({ a: 1 });
  });
  it("picks the locale text and falls back to az", () => {
    expect(localizedText(t, "ru")).toBe("р");
    expect(localizedText(t, "xx")).toBe("a");
  });
});
