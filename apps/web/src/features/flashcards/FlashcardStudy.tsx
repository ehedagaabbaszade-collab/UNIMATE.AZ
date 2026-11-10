"use client";

import { Button, EmptyState } from "@unimate/ui";
import type { ReviewGrade } from "@unimate/core";
import { useState } from "react";
import { useI18n } from "@unimate/i18n/react";
import type { FlashcardRow } from "@/lib/db";
import { getBrowserClient } from "@/lib/supabase/browser";
import { dropReviewed, parseReviewResult } from "./review";

const GRADES: ReviewGrade[] = ["again", "hard", "good", "easy"];

/**
 * Reviews the given due cards one by one. The schedule (SM-2) and XP are decided by the server (review_flashcard):
 * the client only sends the grade and shows what came back. A card the server says is not due simply leaves the queue.
 */
export function FlashcardStudy({ cards, onDone }: { cards: FlashcardRow[]; onDone: () => void }) {
  const { t, dateTime } = useI18n();
  const [queue, setQueue] = useState(cards);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [error, setError] = useState(false);
  const [nextInfo, setNextInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (queue.length === 0)
    return (
      <EmptyState
        title={reviewed > 0 ? t("cards.sessionDone", { n: reviewed }) : t("cards.nothingDue")}
        action={<Button onClick={onDone}>{t("common.back")}</Button>}
      />
    );

  const card = queue[0]!;

  async function rate(grade: ReviewGrade) {
    setBusy(true);
    setError(false);
    const { data, error: err } = await getBrowserClient().rpc("review_flashcard", { p_card_id: card.id, p_grade: grade });
    setBusy(false);
    const res = err ? null : parseReviewResult(data);
    if (!res) return setError(true);
    if (res.reviewed) {
      setReviewed((n) => n + 1);
      const when = res.due_at ? t("cards.next", { date: dateTime(new Date(res.due_at)) }) : null;
      const xp = res.awarded > 0 ? t("cards.xpEarned", { n: res.awarded }) : null;
      setNextInfo([when, xp].filter(Boolean).join(" · ") || null);
    }
    setFlipped(false);
    // "again" cards are due again in 10 minutes (server clock); a local re-queue would only get not_due replies.
    setQueue((q) => dropReviewed(q, card.id));
  }

  return (
    <div className="stack">
      <p className="um-muted" role="status">
        {t("cards.dueNow", { n: queue.length })}
        {nextInfo ? ` · ${nextInfo}` : ""}
      </p>
      <div className="flip">
        <button type="button" className="flip__card" aria-pressed={flipped} onClick={() => setFlipped((f) => !f)}>
          <span className="flip__face" aria-hidden={flipped}>
            <span className="flip__tag">{t("cards.front")}</span>
            <span>{card.front}</span>
          </span>
          <span className="flip__face flip__face--back" aria-hidden={!flipped}>
            <span className="flip__tag">{t("cards.back")}</span>
            <span>{card.back}</span>
          </span>
        </button>
      </div>
      {error ? <p className="err-box" role="alert">{t("cards.saveFailed")}</p> : null}
      {flipped ? (
        <div className="rate-row">
          {GRADES.map((g) => (
            <Button key={g} variant={g === "good" ? "primary" : "secondary"} disabled={busy} onClick={() => void rate(g)}>
              {t(`cards.${g}`)}
            </Button>
          ))}
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setFlipped(true)}>
          {t("cards.flip")}
        </Button>
      )}
    </div>
  );
}
