import { z } from "zod";

export interface GradeBand {
  /** Inclusive minimum score. */
  min: number;
  letter: string;
  points: number;
}
export interface GradingScale {
  id: string;
  label: string;
  bands: GradeBand[];
}

/**
 * ASSUMPTION: Azerbaijani universities commonly use a 100-point scale with A-F letters, but exact
 * cutoffs and point values vary by institution (here: 91-100 A, 81-90 B, 71-80 C, 61-70 D,
 * 51-60 E, below 51 F). Treat as a configurable default, not an official rule.
 */
export const AZ_100_SCALE: GradingScale = {
  id: "az-100-default",
  label: "Azerbaijan 100-point scale (ASSUMED default; verify with your university)",
  bands: [
    { min: 91, letter: "A", points: 4.0 },
    { min: 81, letter: "B", points: 3.0 },
    { min: 71, letter: "C", points: 2.0 },
    { min: 61, letter: "D", points: 1.0 },
    { min: 51, letter: "E", points: 0.5 },
    { min: 0, letter: "F", points: 0 },
  ],
};

/** Standard 4.0 letter scale. */
export const LETTER_4_SCALE = {
  id: "letter-4.0",
  label: "4.0 letter scale",
  letters: {
    "A+": 4.0, A: 4.0, "A-": 3.7, "B+": 3.3, B: 3.0, "B-": 2.7,
    "C+": 2.3, C: 2.0, "C-": 1.7, "D+": 1.3, D: 1.0, "D-": 0.7, F: 0,
  } as Record<string, number>,
};

const bandSchema = z.object({ min: z.number().finite(), letter: z.string().min(1), points: z.number().min(0) });
export const gradingScaleSchema = z
  .object({ id: z.string().min(1), label: z.string(), bands: z.array(bandSchema).min(1) })
  .refine((s) => s.bands.some((b) => b.min <= 0), { message: "scale must have a band covering the lowest score" });

export const courseSchema = z.object({
  name: z.string().optional(),
  credits: z.number().finite().min(0),
  score: z.number().finite().min(0).optional(),
  letter: z.string().optional(),
});
export type Course = z.infer<typeof courseSchema>;

export function scoreToBand(score: number, scale: GradingScale = AZ_100_SCALE): GradeBand {
  if (!Number.isFinite(score) || score < 0) throw new RangeError("invalid score");
  const sorted = [...scale.bands].sort((a, b) => b.min - a.min);
  const band = sorted.find((b) => score >= b.min);
  if (!band) throw new RangeError("score below scale range");
  return band;
}

export function letterToPoints(letter: string): number {
  const p = LETTER_4_SCALE.letters[letter.trim().toUpperCase()];
  if (p === undefined) throw new RangeError(`unknown letter grade: ${letter}`);
  return p;
}

export interface GpaResult {
  /** null when there are no credit-bearing courses. */
  gpa: number | null;
  totalCredits: number;
  courseCount: number;
}

/**
 * Credit-weighted GPA. Courses with a numeric `score` use `scale`; courses with a `letter` use the
 * 4.0 letter scale. Zero-credit courses are ignored. Throws ZodError on malformed input.
 */
export function weightedGpa(courses: unknown, scale: GradingScale = AZ_100_SCALE): GpaResult {
  const list = z.array(courseSchema).parse(courses);
  const validScale = gradingScaleSchema.parse(scale);
  let totalCredits = 0;
  let totalPoints = 0;
  let courseCount = 0;
  for (const c of list) {
    if (c.credits === 0) continue;
    let points: number;
    if (c.score !== undefined) points = scoreToBand(c.score, validScale).points;
    else if (c.letter !== undefined) points = letterToPoints(c.letter);
    else throw new RangeError(`course ${c.name ?? ""} needs a score or letter`);
    totalCredits += c.credits;
    totalPoints += points * c.credits;
    courseCount++;
  }
  if (totalCredits === 0) return { gpa: null, totalCredits: 0, courseCount: 0 };
  return { gpa: Math.round((totalPoints / totalCredits) * 1000) / 1000, totalCredits, courseCount };
}
