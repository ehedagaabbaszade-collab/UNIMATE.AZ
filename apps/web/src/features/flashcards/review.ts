import { z } from "zod";

/** Shape of public.review_flashcard's return value (server-side SM-2 + XP). */
const reviewResultSchema = z.object({
  reviewed: z.boolean(),
  awarded: z.number().int().min(0).default(0),
  reason: z.string().nullable().optional(),
  due_at: z.string().optional(),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;

export function parseReviewResult(raw: unknown): ReviewResult | null {
  const r = reviewResultSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * The card leaves the session queue after ANY accepted server answer: reviewed, or "not_due" (already reviewed elsewhere,
 * or an "again" card whose 10-minute timer the server owns). Re-queueing locally would only produce not_due replies.
 */
export const dropReviewed = <T extends { id: string }>(queue: readonly T[], cardId: string): T[] => queue.filter((c) => c.id !== cardId);
