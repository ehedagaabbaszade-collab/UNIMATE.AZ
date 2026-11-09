/** Row shapes for the tables the web app reads/writes (see supabase/migrations). No generated types exist yet. */
export interface University { id: string; name: string; short_name: string | null; city: string | null }
export interface Faculty { id: string; university_id: string; name: string }
export interface Major { id: string; faculty_id: string; name: string; degree_level: string }

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  university_id: string | null;
  major_id: string | null;
  study_year: number | null;
  locale: "az" | "en" | "ru";
}

export type DocStatus = "pending_upload" | "uploaded" | "processing" | "ready" | "failed";
export interface DocumentRow {
  id: string;
  title: string;
  original_filename: string | null;
  storage_path: string;
  mime_type: string;
  size_bytes: number | null;
  status: DocStatus;
  page_count: number | null;
  error: string | null;
  created_at: string;
}
export interface ChunkRow { id: string; chunk_index: number; page_start: number | null; page_end: number | null; content: string }
export interface SummaryRow { id: string; kind: string; content: string; created_at: string }
export interface MessageRow { id: string; conversation_id: string; role: "user" | "assistant" | "system"; content: string; citations: unknown; created_at: string }
export interface QuizRow { id: string; title: string; created_at: string }
export interface QuestionRow { id: string; quiz_id: string; position: number; prompt: string; options: unknown; answer: string; explanation: string | null }
export interface AttemptRow { id: string; quiz_id: string; score: number; max_score: number; completed_at: string | null; started_at: string }
export interface FlashcardRow { id: string; document_id: string | null; front: string; back: string; due_at: string; ease: number; interval_days: number; repetitions: number }

export interface TimetableRow { id: string; title: string; weekday: number; start_time: string; end_time: string; location: string | null }
export interface TaskRow { id: string; title: string; due_at: string | null; status: "todo" | "doing" | "done"; priority: number; completed_at: string | null }
export interface ExamRow { id: string; title: string; starts_at: string; duration_minutes: number | null; location: string | null; weight: number | null }
export interface StudySessionRow { id: string; started_at: string; ended_at: string | null; duration_seconds: number | null }
export interface SubscriptionRow { plan: "free" | "plus" | "pro"; status: string; current_period_end: string | null }
export interface UsageCounterRow { kind: "ai_message" | "upload_doc"; period_start: string; n: number }
