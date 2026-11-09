import type { StructuredCitation } from "@/lib/edge";

export type AnswerPart = { type: "text"; text: string } | { type: "cite"; chunkId: string; index: number };

const UUID_MARKER = /\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi;
const NOT_GROUNDED_PREFIX = "[Not source-grounded] ";

/**
 * Splits an answer into text and citation parts. A citation part is produced ONLY for a marker whose id appears
 * in the server-validated structured `citations` array. Any other id-shaped marker is dropped, so a model (or an
 * injected document) cannot make the UI show a source that the server did not validate.
 * Returned `index` is the 1-based position in `citations` (used as the chip number).
 */
export function segmentAnswer(answer: string, citations: readonly StructuredCitation[]): AnswerPart[] {
  const order = new Map<string, number>();
  citations.forEach((c, i) => order.set(c.chunk_id.toLowerCase(), i + 1));
  const text = answer.startsWith(NOT_GROUNDED_PREFIX) ? answer.slice(NOT_GROUNDED_PREFIX.length) : answer;

  const parts: AnswerPart[] = [];
  let last = 0;
  const push = (t: string) => {
    if (!t) return;
    const prev = parts[parts.length - 1];
    if (prev?.type === "text") prev.text += t;
    else parts.push({ type: "text", text: t });
  };
  for (const m of text.matchAll(UUID_MARKER)) {
    const start = m.index ?? 0;
    push(text.slice(last, start));
    const id = m[1]!.toLowerCase();
    const index = order.get(id);
    if (index !== undefined) parts.push({ type: "cite", chunkId: id, index });
    last = start + m[0].length;
  }
  push(text.slice(last));
  return parts;
}

export const isUngroundedAnswer = (answer: string) => answer.startsWith(NOT_GROUNDED_PREFIX);

export function pageLabel(c: Pick<StructuredCitation, "page_start" | "page_end">): { kind: "none" } | { kind: "single"; n: number } | { kind: "range"; a: number; b: number } {
  if (c.page_start == null) return { kind: "none" };
  if (c.page_end == null || c.page_end === c.page_start) return { kind: "single", n: c.page_start };
  return { kind: "range", a: c.page_start, b: c.page_end };
}
