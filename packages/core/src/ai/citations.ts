export interface RetrievedChunk {
  id: string;
  page?: number;
  text?: string;
}
export interface Segment {
  text: string;
  kind: "grounded" | "external";
  /** Valid chunk ids supporting this segment (empty for external). Sole source of truth for UI chips. */
  citations: string[];
}
export interface CitationResult {
  /** Answer with invalid markers removed (valid markers kept). Unicode is NFKC-normalised and format chars removed. */
  cleanedAnswer: string;
  segments: Segment[];
  validIds: string[];
  /** Id-shaped parts cited by the model that are not in the retrieved set. */
  rejectedIds: string[];
  hadInvalid: boolean;
  /** True when the answer exceeded MAX_ANSWER_CHARS and the excess was dropped. */
  truncated: boolean;
}

/** Input cap: the sentence splitter is regex based, so unbounded input is a CPU risk. */
export const MAX_ANSWER_CHARS = 100_000;

const MARKER = /\[([^\]\[]+)\](\([^)\n]*\))?/g;
const SPLITTER = /(?:\[[^\]\[\n.!?]*\]|[^.!?\n])+[.!?]*(?:[ \t]*\[[^\]\[\n.!?]*\])*\s*|\n+|[.!?]+/g;
const BRACKET = /\[([^\]\[]+)\]/g;

/** NFKC-normalise (folds fullwidth brackets etc.) and drop invisible format characters (zero-width, bidi). */
const normalise = (s: string): string => s.normalize("NFKC").replace(/\p{Cf}/gu, "");

/**
 * Id-shaped: no whitespace, has a letter, and a digit/underscore/colon or a "chunk-"-style prefix.
 * Pure numbers ([1]) and plain words ([note]) are prose. Non-ASCII letters (e.g. Cyrillic look-alikes)
 * count as letters, so a spoofed id is treated as an id and rejected.
 */
function isIdLike(p: string): boolean {
  if (p.length < 2 || p.length > 128 || /\s/u.test(p)) return false;
  if (!/\p{L}/u.test(p)) return false;
  return /[\p{N}_:]/u.test(p) || /^(c|chunk|doc|src|source|ref|id)-/i.test(p);
}

/**
 * Validates [chunkId] / [a, b] markers (and optional structured citation ids) against the
 * retrieved set. Validity is decided per part: every part of a bracket that is not a known id is
 * stripped (id-shaped ones are also reported as rejected), unless the whole bracket is clearly prose
 * (no known id, no id-shaped part), in which case it is left untouched. A `(...)` link target directly
 * after a citation marker is removed. A segment (sentence) is "grounded" only if it retains at least
 * one valid citation; otherwise it is "external".
 */
export function validateCitations(
  rawAnswer: string,
  retrieved: RetrievedChunk[],
  structured: string[] = [],
): CitationResult {
  const truncated = rawAnswer.length > MAX_ANSWER_CHARS;
  const answer = normalise(truncated ? rawAnswer.slice(0, MAX_ANSWER_CHARS) : rawAnswer);
  const known = new Set(retrieved.map((c) => normalise(c.id)));
  const rejected = new Set<string>();
  const valid = new Set<string>();

  for (const raw of structured) {
    const id = normalise(raw);
    (known.has(id) ? valid : rejected).add(id);
  }

  const splitParts = (inner: string) => inner.split(/[,;\s]+/).filter(Boolean);

  // Pass 1: decide every marker once. Afterwards every remaining bracket is either all-known or prose.
  const decided = answer
    .replace(MARKER, (m, inner: string) => {
      const parts = splitParts(inner);
      if (parts.length === 0) return m;
      const isCitation = parts.some((p) => known.has(p) || isIdLike(p));
      if (!isCitation) return m;
      const good: string[] = [];
      for (const p of parts) {
        if (known.has(p)) good.push(p);
        else if (isIdLike(p)) rejected.add(p);
      }
      return good.length ? `[${[...new Set(good)].join(", ")}]` : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1");

  const pieces = decided.match(SPLITTER) ?? [];
  const segments: Segment[] = [];
  for (const piece of pieces) {
    const text = piece.trim();
    if (!text) continue;
    const ids: string[] = [];
    for (const m of piece.matchAll(BRACKET)) {
      for (const p of splitParts(m[1]!)) if (known.has(p)) ids.push(p);
    }
    const uniq = [...new Set(ids)];
    for (const id of uniq) valid.add(id);
    segments.push({ text, kind: uniq.length ? "grounded" : "external", citations: uniq });
  }
  return {
    cleanedAnswer: decided.trim(),
    segments,
    validIds: [...valid],
    rejectedIds: [...rejected],
    hadInvalid: rejected.size > 0,
    truncated,
  };
}
