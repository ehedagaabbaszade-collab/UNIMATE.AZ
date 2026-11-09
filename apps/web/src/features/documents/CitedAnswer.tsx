"use client";

import { Badge } from "@unimate/ui";
import type { StructuredCitation } from "@/lib/edge";
import { useT } from "@/i18n/provider";
import { isUngroundedAnswer, pageLabel, segmentAnswer } from "./citations";

/** Renders an assistant answer. Chips come ONLY from the validated structured `citations`; the text is plain text. */
export function CitedAnswer({
  answer,
  citations,
  onSelect,
  selectedId,
}: {
  answer: string;
  citations: StructuredCitation[];
  onSelect: (chunkId: string) => void;
  selectedId?: string | null;
}) {
  const t = useT();
  const parts = segmentAnswer(answer, citations);
  const ungrounded = isUngroundedAnswer(answer) || citations.length === 0;

  const label = (c: StructuredCitation) => {
    const p = pageLabel(c);
    return p.kind === "single" ? t("chat.pageSingle", { n: p.n }) : p.kind === "range" ? t("chat.pageRange", { a: p.a, b: p.b }) : t("chat.sourceTitle");
  };

  return (
    <div>
      <p style={{ whiteSpace: "pre-wrap" }}>
        {parts.map((p, i) =>
          p.type === "text" ? (
            <span key={i}>{p.text}</span>
          ) : (
            <button
              key={i}
              type="button"
              className="cite-chip cite-chip--inline"
              aria-pressed={selectedId === p.chunkId}
              aria-label={`${t("chat.sourceTitle")} ${p.index}`}
              onClick={() => onSelect(p.chunkId)}
            >
              {p.index}
            </button>
          ),
        )}
      </p>
      {ungrounded ? (
        <p style={{ marginTop: "var(--space-2)" }}>
          <Badge tone="warning">{t("chat.notGrounded")}</Badge>
        </p>
      ) : null}
      {citations.length > 0 ? (
        <div className="cite-list" role="group" aria-label={t("chat.sources")}>
          {citations.map((c, i) => (
            <button key={c.chunk_id} type="button" className="cite-chip" aria-pressed={selectedId === c.chunk_id} onClick={() => onSelect(c.chunk_id)}>
              <span className="cite-chip__n">{i + 1}</span>
              {label(c)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
