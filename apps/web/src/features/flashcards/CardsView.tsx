"use client";

import { Button, Skeleton } from "@unimate/ui";
import { isDue } from "@unimate/core";
import { useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import { useUser } from "@/components/user";
import { useI18n } from "@unimate/i18n/react";
import type { FlashcardRow } from "@/lib/db";
import type { EdgeError } from "@/lib/edge";
import { generateFlashcardMaterial } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { FlashcardStudy } from "./FlashcardStudy";

/** Cards for one document (documentId set, with generation) or across all documents (documentId omitted). */
export function CardsView({ documentId }: { documentId?: string }) {
  const { t, locale } = useI18n();
  const user = useUser();
  const cards = useAsync<FlashcardRow[]>(async () => {
    let q = getBrowserClient().from("flashcards").select("id,document_id,front,back,due_at,ease,interval_days,repetitions").order("due_at");
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
    const res = await generateFlashcardMaterial(documentId, 15, locale);
    if (!res.ok) {
      setBusy(false);
      return setErr(res.error);
    }
    const { error } = await getBrowserClient()
      .from("flashcards")
      .insert(res.data.output.cards.map((c) => ({ user_id: user.id, document_id: documentId, front: c.front, back: c.back })));
    setBusy(false);
    if (error) return setDbErr(error.message);
    cards.reload();
  }

  if (cards.loading && !cards.data) return <Skeleton height={160} />;
  const all = cards.data ?? [];
  const now = new Date();
  const due = all.filter((c) => isDue(c.due_at, now));

  if (studying) return <FlashcardStudy cards={due} onDone={() => { setStudying(false); cards.reload(); }} />;

  return (
    <div className="stack">
      {cards.error ? <p className="err-box" role="alert">{cards.error}</p> : null}
      {all.length === 0 ? <p className="um-muted">{t("cards.none")}</p> : <p>{t("cards.total", { n: all.length })} · <strong>{t("cards.dueNow", { n: due.length })}</strong></p>}
      <div className="row">
        {due.length > 0 ? <Button onClick={() => setStudying(true)}>{t("cards.study")}</Button> : all.length > 0 ? <p className="um-muted">{t("cards.nothingDue")}</p> : null}
        {documentId ? (
          <Button variant={all.length ? "secondary" : "primary"} loading={busy} onClick={generate}>
            {busy ? t("cards.generating") : t("cards.generate")}
          </Button>
        ) : null}
      </div>
      {err ? <EdgeNotice error={err} /> : null}
      {dbErr ? <p className="err-box" role="alert">{dbErr}</p> : null}
    </div>
  );
}
