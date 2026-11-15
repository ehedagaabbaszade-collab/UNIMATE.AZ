"use client";

import { Badge, Button, EmptyState, ErrorState, Skeleton, Tabs } from "@unimate/ui";
import Link from "next/link";
import { useI18n } from "@unimate/i18n/react";
import type { DocumentRow } from "@/lib/db";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useVisibleInterval } from "@/lib/use-visible-interval";
import { unwrap, useAsync } from "@/lib/use-async";
import { CardsView } from "../flashcards/CardsView";
import { ChatPanel } from "./ChatPanel";
import { DOC_COLUMNS, STATUS_TONE, isInFlight } from "./DocumentsList";
import { QuizPanel } from "./QuizPanel";
import { SummaryPanel } from "./SummaryPanel";

export function DocumentWorkspace({ documentId }: { documentId: string }) {
  const { t } = useI18n();
  const doc = useAsync<DocumentRow | null>(async () => {
    const res = await getBrowserClient().from("documents").select(DOC_COLUMNS).eq("id", documentId).maybeSingle<DocumentRow>();
    return unwrap(res);
  }, [documentId]);

  const inFlight = doc.data ? isInFlight(doc.data.status) : false;
  const reload = doc.reload;
  useVisibleInterval(reload, 4000, inFlight);

  if (doc.loading && doc.data === undefined) return <Skeleton height={240} />;
  if (doc.error) return <ErrorState title={t("documents.loadFailed")} description={doc.error} action={<Button onClick={doc.reload}>{t("common.retry")}</Button>} />;
  const d = doc.data;
  if (!d) return <EmptyState title={t("ai.notFound")} action={<Link className="um-btn" href="/documents">{t("common.back")}</Link>} />;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <Link href="/documents" style={{ fontSize: "var(--text-sm)" }}>← {t("documents.title")}</Link>
        <h1 style={{ overflowWrap: "anywhere" }}>{d.title}</h1>
        <div className="row">
          <Badge tone={STATUS_TONE[d.status]}>{t(`documents.status.${d.status}`)}</Badge>
          {d.page_count != null ? <span className="um-muted">{t("documents.pages", { n: d.page_count })}</span> : null}
        </div>
      </div>

      {d.status === "failed" ? (
        <ErrorState title={t("documents.failedTitle")} description={d.error ?? undefined} />
      ) : d.status !== "ready" ? (
        <EmptyState title={t("documents.notReadyTitle")} description={`${t("documents.notReadyBody")} ${t("documents.refreshing")}`} />
      ) : (
        <Tabs
          label={t("documents.tabs.label")}
          items={[
            { id: "summary", label: t("documents.tabs.summary"), content: <SummaryPanel documentId={d.id} /> },
            { id: "chat", label: t("documents.tabs.chat"), content: <ChatPanel documentId={d.id} /> },
            { id: "quiz", label: t("documents.tabs.quiz"), content: <QuizPanel documentId={d.id} /> },
            { id: "cards", label: t("documents.tabs.cards"), content: <CardsView documentId={d.id} /> },
          ]}
        />
      )}
    </div>
  );
}
