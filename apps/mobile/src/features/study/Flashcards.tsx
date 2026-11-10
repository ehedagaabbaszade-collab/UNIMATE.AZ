import { isDue, type ReviewGrade } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { EdgeNotice } from "../../components/EdgeNotice";
import { AppText, Button, EmptyState, Notice, Skeleton } from "../../components/ui";
import type { FlashcardRow } from "../../lib/db";
import type { EdgeError } from "../../lib/edge";
import { generateFlashcardMaterial } from "../../lib/edge-client";
import { dropReviewed, parseReviewResult } from "../../lib/review";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { radii } from "../../theme/tokens";

const GRADES: ReviewGrade[] = ["again", "hard", "good", "easy"];

/**
 * Reviews the given due cards one by one. The schedule (SM-2) and XP are decided by the server (`review_flashcard`):
 * the client only sends the grade and shows what came back. A card the server says is not due leaves the queue.
 */
export function FlashcardStudy({ cards, onDone }: { cards: FlashcardRow[]; onDone: () => void }) {
  const { t, dateTime } = useI18n();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const [queue, setQueue] = useState(cards);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [error, setError] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (queue.length === 0) return <EmptyState title={reviewed > 0 ? t("cards.sessionDone", { n: reviewed }) : t("cards.nothingDue")} action={<Button title={t("common.back")} onPress={onDone} />} />;
  const card = queue[0]!;

  async function rate(grade: ReviewGrade) {
    setBusy(true);
    setError(false);
    const { data, error: err } = await sb.rpc("review_flashcard", { p_card_id: card.id, p_grade: grade });
    setBusy(false);
    const res = err ? null : parseReviewResult(data);
    if (!res) return setError(true);
    if (res.reviewed) {
      setReviewed((n) => n + 1);
      const when = res.due_at ? t("cards.next", { date: dateTime(new Date(res.due_at)) }) : null;
      const xp = res.awarded > 0 ? t("cards.xpEarned", { n: res.awarded }) : null;
      setInfo([when, xp].filter(Boolean).join(" · ") || null);
    }
    setFlipped(false);
    setQueue((q) => dropReviewed(q, card.id));
  }

  return (
    <View style={{ gap: 12 }}>
      <AppText muted accessibilityLiveRegion="polite">
        {t("cards.dueNow", { n: queue.length })}
        {info ? ` · ${info}` : ""}
      </AppText>
      <Pressable onPress={() => setFlipped((f) => !f)} accessibilityRole="button" accessibilityState={{ selected: flipped }} accessibilityLabel={`${flipped ? t("cards.back") : t("cards.front")}: ${flipped ? card.back : card.front}`} style={{ minHeight: 200, borderRadius: radii.xl, borderWidth: 1, borderColor: theme.cardBorder, backgroundColor: theme.cardStrong, padding: 20, justifyContent: "center", gap: 8 }}>
        <AppText variant="caption" muted>
          {flipped ? t("cards.back") : t("cards.front")}
        </AppText>
        <AppText variant="heading">{flipped ? card.back : card.front}</AppText>
      </Pressable>
      {error ? <Notice text={t("cards.saveFailed")} /> : null}
      {flipped ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {GRADES.map((g) => (
            <Button key={g} small style={{ flexGrow: 1 }} title={t(`cards.${g}`)} variant={g === "good" ? "primary" : "secondary"} disabled={busy} onPress={() => void rate(g)} />
          ))}
        </View>
      ) : (
        <Button title={t("cards.flip")} variant="secondary" onPress={() => setFlipped(true)} />
      )}
    </View>
  );
}

/** Cards for one document (documentId set, with generation) or across all documents (omitted). */
export function CardsView({ documentId, outputLanguage }: { documentId?: string; outputLanguage?: string }) {
  const { t, locale } = useI18n();
  const { user, supabase: sb } = useUser();
  const cards = useAsync<FlashcardRow[]>(async () => {
    let q = sb.from("flashcards").select("id,document_id,front,back,due_at,ease,interval_days,repetitions").order("due_at");
    if (documentId) q = q.eq("document_id", documentId);
    return unwrap(await q) as FlashcardRow[];
  }, [documentId]);
  const [studying, setStudying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<EdgeError | null>(null);
  const [dbErr, setDbErr] = useState<string | null>(null);

  async function generate() {
    if (!documentId) return;
    setBusy(true);
    setErr(null);
    setDbErr(null);
    const res = await generateFlashcardMaterial(documentId, 15, outputLanguage ?? locale);
    if (!res.ok) {
      setBusy(false);
      return setErr(res.error);
    }
    const { error } = await sb.from("flashcards").insert(res.data.output.cards.map((c) => ({ user_id: user.id, document_id: documentId, front: c.front, back: c.back })));
    setBusy(false);
    if (error) return setDbErr(error.message);
    cards.reload();
  }

  if (cards.loading && !cards.data) return <Skeleton height={160} />;
  const all = cards.data ?? [];
  const now = new Date();
  const due = all.filter((c) => isDue(c.due_at, now));
  if (studying)
    return (
      <FlashcardStudy
        cards={due}
        onDone={() => {
          setStudying(false);
          cards.reload();
        }}
      />
    );

  return (
    <View style={{ gap: 12 }}>
      {cards.error ? <Notice text={cards.error} /> : null}
      {all.length === 0 ? (
        <AppText muted>{t("cards.none")}</AppText>
      ) : (
        <AppText>
          {t("cards.total", { n: all.length })} · <AppText style={{ fontWeight: "700" }}>{t("cards.dueNow", { n: due.length })}</AppText>
        </AppText>
      )}
      {due.length > 0 ? <Button title={t("cards.study")} onPress={() => setStudying(true)} /> : all.length > 0 ? <AppText muted>{t("cards.nothingDue")}</AppText> : null}
      {documentId ? <Button title={busy ? t("cards.generating") : t("cards.generate")} variant={all.length ? "secondary" : "primary"} loading={busy} onPress={generate} /> : null}
      {err ? <EdgeNotice error={err} /> : null}
      {dbErr ? <Notice text={dbErr} /> : null}
    </View>
  );
}
