import { AZ_DEFAULT_RULES } from "@unimate/core";
import { z } from "zod";

/** Browser-local "My courses" data; same key and schema as the mobile app. */
export const courseSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  totalHours: z.number().int().min(1).max(600),
  missedHours: z.number().int().min(0).max(600),
  semesterScore: z.number().min(0).max(100).nullable(),
});
export type Course = z.infer<typeof courseSchema>;
const rulesSchema = z.object({
  semesterMax: z.number(),
  examMax: z.number(),
  examMin: z.number().min(0).max(100),
  passTotal: z.number().min(1).max(100),
  absenceLimitPct: z.number().min(1).max(100),
  attendanceMax: z.number(),
});
export const coursesStoreSchema = z.object({ courses: z.array(courseSchema).max(40), rules: rulesSchema });
export type CoursesStore = z.infer<typeof coursesStoreSchema>;
export const EMPTY_COURSES: CoursesStore = { courses: [], rules: AZ_DEFAULT_RULES };
export const coursesKey = (uid: string) => `um.courses.${uid}`;
