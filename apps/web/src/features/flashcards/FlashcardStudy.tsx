"use client";

import { Button, EmptyState } from "@unimate/ui";
import { scheduleReview, type ReviewGrade } from "@unimate/core";
import { useState } from "react";
import { useI18n } from "@/i18n/provider";
import type { FlashcardRow } from "@/lib/db";
import { getBrowserClient } from "@/lib/supabase/browser";

const GRADES: ReviewGrade[] = ["again", "hard", "good", "easy"];

/** Reviews the given due cards one by one; each rating is scheduled by the pure SM-2 helper and persisted. */
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
    const next = scheduleReview({ ease: Number(card.ease), intervalDays: card.interval_days, repetitions: card.repetitions }, grade, new Date());
    const { error: err } = await getBrowserClient()
      .from("flashcards")
      .update({ ease: next.ease, interval_days: next.intervalDays, repetitions: next.repetitions, due_at: next.dueAt.toISOString() })
      .eq("id", card.id);
    setBusy(false);
    if (err) return setError(true);
    setNextInfo(t("cards.next", { date: dateTime(next.dueAt) }));
    setReviewed((n) => n + 1);
    setFlipped(false);
    // "again" cards come back in this session (10 minutes is shorter than a study sitting); the rest leave the queue.
    setQueue((q) => (grade === "again" ? [...q.slice(1), { ...card, ease: next.ease, interval_days: next.intervalDays, repetitions: next.repetitions }] : q.slice(1)));
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
