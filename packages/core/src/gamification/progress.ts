import { z } from "zod";

/**
 * Shapes returned by the gamification RPCs (migration 20260101004000: my_progress, my_achievements, leaderboard) and
 * the notification RPCs (20260101004100). Parsed with zod so a drifting backend fails loudly instead of showing NaN.
 */
const text = z.object({ az: z.string(), tr: z.string(), en: z.string(), ru: z.string() });
export type LocalizedText = z.infer<typeof text>;

/** Text in the user's language, falling back to az (the product default). */
export const localizedText = (t: LocalizedText, locale: string): string => (t as Record<string, string>)[locale] ?? t.az;

const challenge = z.object({
  id: z.string(),
  title: text,
  description: text,
  metric: z.string(),
  target: z.coerce.number(),
  progress: z.coerce.number(),
  completed: z.boolean(),
  starts_at: z.string(),
  ends_at: z.string(),
});

export const myProgressSchema = z.object({
  xp: z.coerce.number(),
  level: z.number(),
  level_start_xp: z.coerce.number(),
  next_level_xp: z.coerce.number().nullable(),
  xp_into_level: z.coerce.number(),
  xp_to_next: z.coerce.number(),
  level_progress: z.coerce.number().min(0).max(1),
  streak: z.object({ current: z.number(), longest: z.number() }),
  achievements: z.object({ unlocked: z.number(), total: z.number() }),
  leaderboard_opt_in: z.boolean(),
  challenges: z.array(challenge),
});
export type MyProgress = z.infer<typeof myProgressSchema>;
export type ChallengeProgress = z.infer<typeof challenge>;

export const achievementSchema = z.object({
  code: z.string(),
  name: text,
  description: text,
  icon: z.string(),
  metric: z.string(),
  target: z.coerce.number(),
  current: z.coerce.number(),
  unlocked_at: z.string().nullable(),
});
export type AchievementItem = z.infer<typeof achievementSchema>;

export const leaderRowSchema = z.object({
  rank: z.number().nullable(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  xp: z.coerce.number(),
  is_me: z.boolean(),
});
export type LeaderRow = z.infer<typeof leaderRowSchema>;

export const notificationRowSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  params: z.record(z.string(), z.unknown()).default({}),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
export type NotificationItem = z.infer<typeof notificationRowSchema>;

export const parseMyProgress = (raw: unknown): MyProgress => myProgressSchema.parse(raw);
export const parseAchievements = (raw: unknown): AchievementItem[] => z.array(achievementSchema).parse(raw ?? []);
export const parseLeaderboard = (raw: unknown): LeaderRow[] => z.array(leaderRowSchema).parse(raw ?? []);
export const parseNotifications = (raw: unknown): NotificationItem[] => z.array(notificationRowSchema).parse(raw ?? []);

export type LeaderboardScope = "university" | "global";
export type LeaderboardPeriod = "week" | "all";

/** Achievement icon keys come from the database; only brand icons are rendered, anything else falls back. */
export const ACHIEVEMENT_ICON_FALLBACK = "achievements" as const;
