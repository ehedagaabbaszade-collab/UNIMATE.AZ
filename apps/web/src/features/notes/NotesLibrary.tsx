"use client";

import { NOTE_KINDS, NOTE_PAGE_SIZE, NOTE_SORTS, courseLabel, noteStatusView, type NoteKind, type NoteListItem, type NoteSort } from "@unimate/core";
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Input, Select, Skeleton, Tabs, useOnlineStatus } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { listCourses, listMyUploads, listSaved, searchNotes, type Course } from "./api";
import { NoteCard } from "./parts";

function Library({ courses }: { courses: Course[] | undefined }) {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const [q, setQ] = useState("");
  const [courseId, setCourseId] = useState("");
  const [kind, setKind] = useState<NoteKind | "">("");
  const [sort, setSort] = useState<NoteSort>("newest");
  const [items, setItems] = useState<NoteListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const rows = await searchNotes(getBrowserClient(), { q, courseId, kind, sort, offset });
        if (my !== seq.current) return;
        setItems((prev) => (offset === 0 ? rows : [...prev, ...rows]));
        setHasMore(rows.length === NOTE_PAGE_SIZE);
        setError(null);
      } catch (e) {
        if (my === seq.current) setError(e instanceof Error ? e.message : "error");
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [q, courseId, kind, sort],
  );
  useEffect(() => {
    const id = setTimeout(() => void load(0), q ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const filtered = !!(q || courseId || kind);
  return (
    <div className="stack-lg">
      <div className="grid-auto">
        <Input label={t("notes.searchLabel")} type="search" placeholder={t("notes.searchPlaceholder")} value={q} onChange={(e) => setQ(e.target.value)} />
        <Select label={t("notes.filters.course")} value={courseId} onChange={(e) => setCourseId(e.target.value)} hint={courses && courses.length === 0 ? t("notes.filters.noCourses") : undefined}>
          <option value="">{t("notes.filters.allCourses")}</option>
          {(courses ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {courseLabel(c)}
            </option>
          ))}
        </Select>
        <Select label={t("notes.filters.type")} value={kind} onChange={(e) => setKind(e.target.value as NoteKind | "")}>
          <option value="">{t("notes.filters.allTypes")}</option>
          {NOTE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`notes.kind.${k}`)}
            </option>
          ))}
        </Select>
        <Select label={t("notes.filters.sort")} value={sort} onChange={(e) => setSort(e.target.value as NoteSort)}>
          {NOTE_SORTS.map((s) => (
            <option key={s} value={s}>
              {t(`notes.sort.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      {!online ? <p className="um-muted" role="status">{t("notes.offline")}</p> : null}
      {loading && items.length === 0 ? (
        <div className="grid-auto">
          <Skeleton height={150} />
          <Skeleton height={150} />
        </div>
      ) : error && items.length === 0 ? (
        <ErrorState title={t("notes.loadFailed")} description={online ? error : t("notes.offline")} action={<Button onClick={() => void load(0)}>{t("common.retry")}</Button>} />
      ) : items.length === 0 ? (
        <EmptyState title={filtered ? t("notes.empty.search") : t("notes.empty.library")} {...(filtered ? {} : { description: t("notes.empty.libraryBody") })} />
      ) : (
        <>
          {error ? <p className="err-box" role="alert">{t("notes.loadFailed")}</p> : null}
          <div className="grid-auto">
            {items.map((n) => (
              <NoteCard key={n.id} item={n} />
            ))}
          </div>
          {hasMore ? (
            <div className="row">
              <Button variant="secondary" loading={loading} onClick={() => void load(items.length)}>
                {t("notes.loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function Mine() {
  const { t, date } = useI18n();
  const user = useUser();
  const mine = useAsync(() => listMyUploads(getBrowserClient(), user.id), [user.id]);
  if (mine.loading && !mine.data) return <Skeleton height={110} />;
  if (mine.error && !mine.data) return <ErrorState title={t("notes.loadFailed")} description={mine.error} action={<Button onClick={mine.reload}>{t("common.retry")}</Button>} />;
  if (!mine.data?.length)
    return (
      <EmptyState
        title={t("notes.empty.mine")}
        description={t("notes.empty.mineBody")}
        action={
          <Link className="um-btn um-btn--primary" href="/notes/upload">
            {t("notes.uploadCta")}
          </Link>
        }
      />
    );
  return (
    <div className="grid-auto">
      {mine.data.map((u) => {
        const view = noteStatusView(u.status, u.takedownHold);
        return (
          <Card key={u.id} className="doc-card">
            <div className="row row--between">
              <Badge tone={view === "published" ? "success" : view === "removed" ? "danger" : "warning"}>{t(`notes.status.${view}`)}</Badge>
              <span className="um-muted" style={{ fontSize: "var(--text-xs)" }}>{date(u.createdAt)}</span>
            </div>
            <h3>
              <Link href={`/notes/${u.id}`}>{u.title}</Link>
            </h3>
            {view !== "published" ? <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>{t(`notes.statusHint.${view}`)}</p> : null}
          </Card>
        );
      })}
    </div>
  );
}

function Saved() {
  const { t } = useI18n();
  const user = useUser();
  const saved = useAsync(() => listSaved(getBrowserClient(), user.id), [user.id]);
  if (saved.loading && !saved.data) return <Skeleton height={110} />;
  if (saved.error && !saved.data) return <ErrorState title={t("notes.loadFailed")} description={saved.error} action={<Button onClick={saved.reload}>{t("common.retry")}</Button>} />;
  if (!saved.data?.length) return <EmptyState title={t("notes.empty.saved")} description={t("notes.empty.savedBody")} />;
  return (
    <div className="grid-auto">
      {saved.data.map((n) => (
        <NoteCard key={n.id} item={n} />
      ))}
    </div>
  );
}

export function NotesLibrary() {
  const { t } = useI18n();
  const user = useUser();
  const courses = useAsync(() => listCourses(getBrowserClient(), user.id), [user.id]);
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("notes.title")}</h1>
        <p>{t("notes.subtitle")}</p>
        <Link className="um-btn um-btn--primary" href="/notes/upload">
          <Icon name="upload" size="sm" />
          {t("notes.uploadCta")}
        </Link>
      </div>
      <Tabs
        label={t("notes.tabs.label")}
        items={[
          { id: "library", label: t("notes.tabs.library"), content: <Library courses={courses.data} /> },
          { id: "mine", label: t("notes.tabs.mine"), content: <Mine /> },
          { id: "saved", label: t("notes.tabs.saved"), content: <Saved /> },
        ]}
      />
    </div>
  );
}
