"use client";

import { NOTE_PAGE_SIZE, type NoteListItem } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@unimate/ui";
import Link from "next/link";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { getContributor, searchNotes } from "./api";
import { NoteCard, Stars } from "./parts";

export function Contributor({ userId }: { userId: string }) {
  const { t, number } = useI18n();
  const profile = useAsync(() => getContributor(getBrowserClient(), userId), [userId]);
  const [extra, setExtra] = useState<NoteListItem[]>([]);
  const [more, setMore] = useState(true);
  const list = useAsync(async () => {
    const rows = await searchNotes(getBrowserClient(), { q: "", courseId: "", kind: "", sort: "newest", offset: 0, uploaderId: userId });
    setMore(rows.length === NOTE_PAGE_SIZE);
    return rows;
  }, [userId]);
  const items = [...(list.data ?? []), ...extra];

  async function loadMore() {
    const rows = await searchNotes(getBrowserClient(), { q: "", courseId: "", kind: "", sort: "newest", offset: items.length, uploaderId: userId });
    setExtra((e) => [...e, ...rows]);
    setMore(rows.length === NOTE_PAGE_SIZE);
  }

  return (
    <div className="stack-lg">
      <div>
        <Link href="/notes" className="um-btn um-btn--ghost um-btn--sm">
          {t("common.back")}
        </Link>
      </div>
      {profile.loading && !profile.data ? (
        <Skeleton height={140} />
      ) : profile.error ? (
        <ErrorState title={t("notes.loadFailed")} description={profile.error} action={<Button onClick={profile.reload}>{t("common.retry")}</Button>} />
      ) : !profile.data ? (
        <EmptyState title={t("notes.contributor.notFound")} />
      ) : (
        <>
          <Card>
            <h1>{profile.data.displayName ?? t("notes.anonymous")}</h1>
            {profile.data.universityName ? <p className="um-muted">{profile.data.universityName}</p> : null}
            <Stars value={profile.data.avgRating} count={profile.data.ratingCount} />
            <dl className="row" style={{ gap: 32 }}>
              <div>
                <dt className="um-muted">{t("notes.contributor.resources")}</dt>
                <dd>{number(profile.data.resourceCount)}</dd>
              </div>
              <div>
                <dt className="um-muted">{t("notes.contributor.saves")}</dt>
                <dd>{number(profile.data.totalSaves)}</dd>
              </div>
            </dl>
          </Card>
          {list.loading && !list.data ? (
            <Skeleton height={140} />
          ) : items.length === 0 ? (
            <EmptyState title={t("notes.contributor.empty")} />
          ) : (
            <>
              <div className="grid-auto">
                {items.map((n) => (
                  <NoteCard key={n.id} item={n} />
                ))}
              </div>
              {more ? (
                <div className="row">
                  <Button variant="secondary" onClick={() => void loadMore()}>
                    {t("notes.loadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
