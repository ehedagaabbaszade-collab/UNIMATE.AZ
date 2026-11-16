import type { SupabaseClient } from "@supabase/supabase-js";
import type { Exam } from "@unimate/core";

/**
 * Teacher classes (migration 20260101005300). A class is a private campus study group; its owner/moderators teach it.
 * Everything goes through RPCs: the server checks membership, the teacher role, the one-attempt rule, the time limit,
 * and keeps the answer key from students. Nothing here trusts the client.
 */
export type ClassErrorKey = "notTeacher" | "teacherCannotTake" | "alreadyTaken" | "notOpen" | "alreadyGraded" | "notFound" | "rateLimited" | "invalid" | "generic";

/** Server messages -> stable keys (teach.class.errors.<key>). Pure; tested. */
export function classErrorKey(message: string): ClassErrorKey {
  const m = message.toLowerCase();
  if (m.includes("only the class teacher")) return "notTeacher";
  if (m.includes("teachers cannot take")) return "teacherCannotTake";
  if (m.includes("already took") || m.includes("already submitted")) return "alreadyTaken";
  if (m.includes("not open")) return "notOpen";
  if (m.includes("already graded")) return "alreadyGraded";
  if (m.includes("not found")) return "notFound";
  if (m.includes("rate limit") || m.includes("too many")) return "rateLimited";
  if (m.includes("invalid") || m.includes("must be") || m.includes("write an answer") || m.includes("needs")) return "invalid";
  return "generic";
}

export class ClassApiError extends Error {
  readonly key: ClassErrorKey;
  constructor(message: string) {
    super(message);
    this.name = "ClassApiError";
    this.key = classErrorKey(message);
  }
}
const ok = <T>(res: { data: T | null; error: { message: string } | null }): T => {
  if (res.error) throw new ClassApiError(res.error.message);
  return res.data as T;
};
const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface ClassItem {
  id: string;
  name: string;
  member_count: number;
  teaching: boolean;
}
/** The caller's classes (joined private study groups). `teaching` = owner or moderator. */
export async function myClasses(sb: SupabaseClient): Promise<ClassItem[]> {
  const r = rows<Record<string, unknown>>(ok(await sb.rpc("discover_communities", { p_q: null, p_kind: "group", p_joined: true, p_limit: 100, p_offset: 0 })));
  return r.map((c) => ({ id: String(c.id), name: String(c.name), member_count: Number(c.member_count ?? 0), teaching: c.my_role === "owner" || c.my_role === "moderator" }));
}
export const createClass = async (sb: SupabaseClient, name: string): Promise<string> =>
  ok(await sb.rpc("create_community", { p_name: name, p_kind: "group", p_visibility: "private", p_description: null, p_rules: null })) as string;
export const joinClass = async (sb: SupabaseClient, code: string): Promise<string> => ok(await sb.rpc("join_by_code", { p_code: code })) as string;
export const classInviteCode = async (sb: SupabaseClient, id: string, rotate = false): Promise<string | null> =>
  ok(await sb.rpc("get_invite_code", { p_community: id, p_rotate: rotate })) as string | null;

// ------------------------------------------------------------------ exams
export interface ClassExam {
  id: string;
  title: string;
  subject: string;
  minutes: number;
  question_count: number;
  max_score: number;
  opens_at: string;
  closes_at: string | null;
  created_at: string;
  my_status: "not_started" | "in_progress" | "submitted";
  my_score: number | null;
  my_pending_open: boolean;
  attempt_count: number | null;
}
export async function listClassExams(sb: SupabaseClient, cls: string): Promise<ClassExam[]> {
  return rows<Record<string, unknown>>(ok(await sb.rpc("list_class_exams", { p_community: cls }))).map((e) => ({
    ...(e as unknown as ClassExam),
    max_score: Number(e.max_score),
    my_score: num(e.my_score),
    attempt_count: num(e.attempt_count),
  }));
}
/** Publishes a saved device exam to a class: the server splits the key out and keeps it. */
export const publishExam = async (sb: SupabaseClient, cls: string, e: Exam, closesAt: string | null): Promise<string> =>
  ok(await sb.rpc("publish_class_exam", { p_community: cls, p_title: e.title, p_subject: e.subject, p_minutes: e.minutes, p_questions: e.questions, p_opens_at: null, p_closes_at: closesAt })) as string;
export const deleteClassExam = async (sb: SupabaseClient, id: string) => void ok(await sb.rpc("delete_class_exam", { p_exam: id }));

export interface PublicQuestion {
  id: string;
  kind: "choice" | "open";
  text: string;
  options: string[];
  points: number;
}
export type Answers = Record<string, number | string>;
export interface StartedExam {
  attempt_id: string;
  deadline_at: string;
  title: string;
  minutes: number;
  questions: PublicQuestion[];
  answers: Answers;
}
export const startExam = async (sb: SupabaseClient, id: string): Promise<StartedExam> => ok(await sb.rpc("start_class_exam", { p_exam: id })) as StartedExam;
export const saveAnswers = async (sb: SupabaseClient, attempt: string, answers: Answers) =>
  void ok(await sb.rpc("submit_class_exam", { p_attempt: attempt, p_answers: answers, p_final: false }));
export const submitExam = async (sb: SupabaseClient, attempt: string, answers: Answers) =>
  ok(await sb.rpc("submit_class_exam", { p_attempt: attempt, p_answers: answers, p_final: true })) as { score: number; max_score: number; late: boolean; pending_open: boolean };

export interface ExamAttemptRow {
  attempt_id: string;
  user_id: string;
  display_name: string | null;
  started_at: string;
  submitted_at: string | null;
  answers: Answers;
  auto_score: number;
  open_scores: Record<string, number>;
  total: number;
}
export async function examResults(sb: SupabaseClient, exam: string): Promise<ExamAttemptRow[]> {
  return rows<Record<string, unknown>>(ok(await sb.rpc("class_exam_results", { p_exam: exam }))).map((r) => ({
    ...(r as unknown as ExamAttemptRow),
    auto_score: Number(r.auto_score),
    total: Number(r.total),
  }));
}
/** Teacher only: the published questions and the answer key. */
export const examKey = async (sb: SupabaseClient, exam: string): Promise<{ questions: PublicQuestion[]; keys: Record<string, number> }> =>
  (ok(await sb.rpc("class_exam_key", { p_exam: exam })) as { questions: PublicQuestion[]; keys: Record<string, number> } | null) ?? { questions: [], keys: {} };
export const gradeOpen = async (sb: SupabaseClient, attempt: string, question: string, points: number) =>
  void ok(await sb.rpc("grade_class_exam_open", { p_attempt: attempt, p_question: question, p_points: points }));

// ------------------------------------------------------------------ assignments
export interface ClassAssignment {
  id: string;
  title: string;
  body: string;
  due_at: string | null;
  created_at: string;
  my_body: string | null;
  my_file_name: string | null;
  my_submitted_at: string | null;
  my_grade: number | null;
  my_feedback: string | null;
  submission_count: number | null;
}
export async function listAssignments(sb: SupabaseClient, cls: string): Promise<ClassAssignment[]> {
  return rows<Record<string, unknown>>(ok(await sb.rpc("list_class_assignments", { p_community: cls }))).map((a) => ({
    ...(a as unknown as ClassAssignment),
    my_grade: num(a.my_grade),
    submission_count: num(a.submission_count),
  }));
}
export const createAssignment = async (sb: SupabaseClient, cls: string, title: string, body: string, dueAt: string | null): Promise<string> =>
  ok(await sb.rpc("create_class_assignment", { p_community: cls, p_title: title, p_body: body, p_due_at: dueAt })) as string;
export const deleteAssignment = async (sb: SupabaseClient, id: string) => void ok(await sb.rpc("delete_class_assignment", { p_assignment: id }));

export const SUBMISSION_BUCKET = "submissions";
/** Storage path the server accepts: <uid>/<assignment>/<time>-<safe name>. Pure; tested. */
export const submissionPath = (uid: string, assignment: string, fileName: string, now = Date.now()) =>
  `${uid}/${assignment}/${now}-${fileName.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/\.{2,}/g, ".").replace(/_+/g, "_").slice(-80) || "file"}`;
export const submitAssignment = async (sb: SupabaseClient, assignment: string, body: string, file: { path: string; name: string } | null) =>
  void ok(await sb.rpc("submit_assignment", { p_assignment: assignment, p_body: body, p_file_path: file?.path ?? null, p_file_name: file?.name ?? null }));

export interface SubmissionRow {
  id: string;
  user_id: string;
  display_name: string | null;
  body: string;
  file_path: string | null;
  file_name: string | null;
  submitted_at: string;
  late: boolean;
  grade: number | null;
  feedback: string | null;
  graded_at: string | null;
}
export async function listSubmissions(sb: SupabaseClient, assignment: string): Promise<SubmissionRow[]> {
  return rows<Record<string, unknown>>(ok(await sb.rpc("assignment_submissions_list", { p_assignment: assignment }))).map((s) => ({
    ...(s as unknown as SubmissionRow),
    grade: num(s.grade),
  }));
}
export const gradeSubmission = async (sb: SupabaseClient, id: string, grade: number, feedback: string) =>
  void ok(await sb.rpc("grade_assignment", { p_submission: id, p_grade: grade, p_feedback: feedback || null }));
/** Short-lived link to a handed-in file (the teacher's read access is enforced by the bucket policy). */
export async function submissionUrl(sb: SupabaseClient, path: string): Promise<string> {
  const r = await sb.storage.from(SUBMISSION_BUCKET).createSignedUrl(path, 300);
  if (r.error || !r.data) throw new ClassApiError(r.error?.message ?? "not found");
  return r.data.signedUrl;
}

export interface OpenClassWork {
  id: string;
  classId: string;
  kind: "assignment" | "classExam";
  title: string;
  /** Due date of the assignment, or when the exam closes. */
  at: string;
}
/** Open work with a deadline in the classes the caller studies in (not those they teach): assignments not handed in,
 *  exams not yet taken. Best effort per class; at most 20 classes. */
export async function openClassWork(sb: SupabaseClient): Promise<OpenClassWork[]> {
  const classes = (await myClasses(sb)).filter((c) => !c.teaching).slice(0, 20);
  const per = await Promise.all(
    classes.map(async (c): Promise<OpenClassWork[]> => {
      const [tasks, exams] = await Promise.all([listAssignments(sb, c.id).catch(() => []), listClassExams(sb, c.id).catch(() => [])]);
      return [
        ...tasks.filter((a) => a.due_at && !a.my_submitted_at).map((a) => ({ id: a.id, classId: c.id, kind: "assignment" as const, title: a.title, at: a.due_at! })),
        ...exams.filter((e) => e.closes_at && e.my_status !== "submitted").map((e) => ({ id: e.id, classId: c.id, kind: "classExam" as const, title: e.title, at: e.closes_at! })),
      ];
    }),
  );
  return per.flat().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Whole seconds left until `deadline` (never negative). Pure; tested. */
export const secondsLeft = (deadline: string, now = Date.now()) => Math.max(0, Math.floor((Date.parse(deadline) - now) / 1000));
/** "mm:ss", or "h:mm:ss" from one hour. Pure; tested. */
export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
