import { AZ_100_SCALE, scoreToBand, type GradingScale } from "../planner/gpa";

/**
 * Azerbaijani credit-system defaults (Bologna 100-point model used by most universities):
 * 50 points during the semester (attendance 10 + seminars/labs + independent work), 50 in the exam,
 * at least 17 in the exam for it to count, 51 total to pass, and students who miss more than
 * ~25% of a course's hours are not admitted to the exam. Universities vary, so every value is editable.
 * Sources: edu.gov.az credit-system presentation; Western Caspian University assessment rules.
 */
export interface GradingRules {
  semesterMax: number;
  examMax: number;
  examMin: number;
  passTotal: number;
  absenceLimitPct: number;
  attendanceMax: number;
}
export const AZ_DEFAULT_RULES: GradingRules = { semesterMax: 50, examMax: 50, examMin: 17, passTotal: 51, absenceLimitPct: 25, attendanceMax: 10 };

export type AbsenceLevel = "ok" | "warn" | "over";
export interface AbsenceStatus {
  /** Missed share of the course hours, 0..100+. */
  pct: number;
  /** Hours that may still be missed before the limit is crossed (negative = already over). */
  remainingHours: number;
  /** Most hours that can be missed and still be admitted. */
  allowedHours: number;
  level: AbsenceLevel;
  /** Attendance points left: 1 point lost per started 10% of missed hours (common rule). */
  attendancePoints: number;
}

export function absenceStatus(totalHours: number, missedHours: number, rules: GradingRules = AZ_DEFAULT_RULES): AbsenceStatus {
  if (!(totalHours > 0) || !(missedHours >= 0)) throw new RangeError("invalid hours");
  const pct = (missedHours / totalHours) * 100;
  const allowedHours = Math.floor((totalHours * rules.absenceLimitPct) / 100);
  const remainingHours = allowedHours - missedHours;
  const level: AbsenceLevel = pct > rules.absenceLimitPct ? "over" : missedHours > 0 && remainingHours <= Math.max(2, allowedHours * 0.25) ? "warn" : "ok";
  const attendancePoints = Math.max(0, rules.attendanceMax - Math.floor(pct / 10));
  return { pct, remainingHours, allowedHours, level, attendancePoints };
}

export interface ExamTarget {
  letter: string;
  /** Total score needed for this band. */
  min: number;
  /** Exam points needed (never below examMin), or null when out of reach. */
  needed: number | null;
}

/** For each passing band: the exam score needed given the semester score. Ordered from pass upward. */
export function examTargets(semesterScore: number, rules: GradingRules = AZ_DEFAULT_RULES, scale: GradingScale = AZ_100_SCALE): ExamTarget[] {
  if (!(semesterScore >= 0) || semesterScore > rules.semesterMax) throw new RangeError("invalid semester score");
  return [...scale.bands]
    .filter((b) => b.min >= rules.passTotal)
    .sort((a, b) => a.min - b.min)
    .map((b) => {
      const need = Math.max(rules.examMin, b.min - semesterScore);
      return { letter: b.letter, min: b.min, needed: need <= rules.examMax ? need : null };
    });
}

/** Final result once the exam is known. The exam counts only if it reaches examMin. */
export function finalResult(semesterScore: number, examScore: number, rules: GradingRules = AZ_DEFAULT_RULES, scale: GradingScale = AZ_100_SCALE) {
  if (!(examScore >= 0) || examScore > rules.examMax) throw new RangeError("invalid exam score");
  const examCounts = examScore >= rules.examMin;
  const total = semesterScore + (examCounts ? examScore : 0);
  const passed = examCounts && total >= rules.passTotal;
  return { total, examCounts, passed, letter: passed ? scoreToBand(total, scale).letter : "F" };
}
