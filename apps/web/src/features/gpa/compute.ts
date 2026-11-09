import { AZ_100_SCALE, LETTER_4_SCALE, gradingScaleSchema, weightedGpa, type GradingScale } from "@unimate/core";
import type { MessageKey } from "@/i18n";

export type ScaleMode = "az" | "letter" | "custom";
export interface GpaRow {
  id: string;
  name: string;
  credits: string;
  score: string;
  letter: string;
}
export interface BandInput {
  id: string;
  min: string;
  letter: string;
  points: string;
}

export type GpaOutcome =
  | { ok: true; gpa: number | null; totalCredits: number; rowErrors: Record<string, MessageKey> }
  | { ok: false; reason: "scale" | "rows"; rowErrors: Record<string, MessageKey> };

export const LETTERS = Object.keys(LETTER_4_SCALE.letters);

const num = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function buildScale(mode: ScaleMode, bands: readonly BandInput[]): GradingScale | null {
  if (mode !== "custom") return AZ_100_SCALE;
  const parsed = bands.map((b) => ({ min: num(b.min), letter: b.letter.trim(), points: num(b.points) }));
  if (parsed.some((b) => b.min === null || b.points === null || !b.letter)) return null;
  const scale = { id: "custom", label: "Custom", bands: parsed.map((b) => ({ min: b.min!, letter: b.letter, points: b.points! })) };
  return gradingScaleSchema.safeParse(scale).success ? scale : null;
}

/** Validates every row, then delegates the arithmetic to core's weightedGpa. Rows with no credits and no grade are ignored. */
export function computeGpa(mode: ScaleMode, bands: readonly BandInput[], rows: readonly GpaRow[]): GpaOutcome {
  const scale = buildScale(mode, bands);
  if (!scale) return { ok: false, reason: "scale", rowErrors: {} };

  const rowErrors: Record<string, MessageKey> = {};
  const courses: Array<{ name?: string; credits: number; score?: number; letter?: string }> = [];
  for (const r of rows) {
    const blank = r.credits.trim() === "" && r.score.trim() === "" && r.letter.trim() === "";
    if (blank) continue;
    const credits = num(r.credits);
    if (credits === null || credits < 0 || credits > 60) {
      rowErrors[r.id] = "validation.credits";
      continue;
    }
    if (mode === "letter") {
      if (!r.letter || !(r.letter in LETTER_4_SCALE.letters)) {
        rowErrors[r.id] = "validation.required";
        continue;
      }
      courses.push({ name: r.name, credits, letter: r.letter });
    } else {
      const score = num(r.score);
      if (score === null || score < 0 || score > 100) {
        rowErrors[r.id] = "validation.score";
        continue;
      }
      courses.push({ name: r.name, credits, score });
    }
  }
  if (Object.keys(rowErrors).length > 0) return { ok: false, reason: "rows", rowErrors };
  const res = weightedGpa(courses, scale);
  return { ok: true, gpa: res.gpa, totalCredits: res.totalCredits, rowErrors };
}
