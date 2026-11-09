/**
 * Data export. There is no server-side export function in the backend (no RPC, no request table), so this reads the
 * signed-in user's own rows through the normal client under RLS and packages them as JSON. It can only contain
 * what RLS lets the user read; uploaded original files are not included.
 */
export const EXPORT_TABLES = [
  "profiles",
  "documents",
  "summaries",
  "conversations",
  "messages",
  "quizzes",
  "questions",
  "attempts",
  "flashcards",
  "study_sessions",
  "tasks",
  "exams",
  "timetable_entries",
  "enrollments",
  "subscriptions",
  "usage_counters",
  "xp_events",
  "streaks",
  "notifications",
] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

/**
 * Column that identifies the owner, used to filter every export query. RLS alone is not enough: profiles are readable
 * by other signed-in users (profiles_select), so an unfiltered select would export other students' profiles.
 * null = child table whose RLS policy is owner-only through its parent (messages -> conversations, questions -> quizzes).
 */
export const OWNER_COLUMN: Record<ExportTable, string | null> = {
  profiles: "id",
  documents: "user_id",
  summaries: "user_id",
  conversations: "user_id",
  messages: null,
  quizzes: "user_id",
  questions: null,
  attempts: "user_id",
  flashcards: "user_id",
  study_sessions: "user_id",
  tasks: "user_id",
  exams: "user_id",
  timetable_entries: "user_id",
  enrollments: "user_id",
  subscriptions: "user_id",
  usage_counters: "user_id",
  xp_events: "user_id",
  streaks: "user_id",
  notifications: "user_id",
};

export interface ExportBundle {
  exportedAt: string;
  userId: string;
  source: "client-side read under row-level security";
  tables: Record<string, unknown[]>;
  errors: Record<string, string>;
}

export function buildExport(userId: string, results: Array<{ table: string; rows: unknown[] | null; error?: string | null }>, now: Date): ExportBundle {
  const tables: Record<string, unknown[]> = {};
  const errors: Record<string, string> = {};
  for (const r of results) {
    if (r.error || !r.rows) errors[r.table] = r.error ?? "no data";
    else tables[r.table] = r.rows;
  }
  return { exportedAt: now.toISOString(), userId, source: "client-side read under row-level security", tables, errors };
}
