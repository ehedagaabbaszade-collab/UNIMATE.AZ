import { NOTE_KINDS, NOTE_PAGE_SIZE, NOTE_SORTS, courseLabel, noteStatusView, type NoteKind, type NoteListItem, type NoteSort } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Icon, ModuleIcon } from "../../components/Icon";
import { PickerField } from "../../components/PickerField";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, Input, Screen, Segmented, Skeleton, useOnline, PressableScale } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { listCourses, listMyUploads, listSaved, searchNotes, type Course } from "./api";
import { NoteCard } from "./parts";

type Tab = "library" | "mine" | "saved";

/** Library list with debounced search, filters and "load more". Keeps the last result visible when offline or on error. */
function useLibrary(filters: { q: string; courseId: string; kind: NoteKind | ""; sort: NoteSort }) {
  const { supabase: sb } = useUser();
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
        const rows = await searchNotes(sb, { ...filters, offset });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sb, filters.q, filters.courseId, filters.kind, filters.sort],
  );
  useEffect(() => {
    const id = setTimeout(() => void load(0), filters.q ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, filters.q]);
  return { items, hasMore, loading, error, reload: () => void load(0), more: () => void load(items.length) };
}

function Library({ courses }: { courses: Course[] | undefined }) {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const [q, setQ] = useState("");
  const [courseId, setCourseId] = useState("");
  const [kind, setKind] = useState<NoteKind | "">("");
  const [sort, setSort] = useState<NoteSort>("newest");
  const lib = useLibrary({ q, courseId, kind, sort });

  return (
    <View style={{ gap: 12 }}>
      <Input label={t("notes.searchLabel")} placeholder={t("notes.searchPlaceholder")} value={q} onChangeText={setQ} returnKeyType="search" autoCorrect={false} />
      <PickerField
        label={t("notes.filters.course")}
        sections={[{ data: [{ id: "", label: t("notes.filters.allCourses") }, ...(courses ?? []).map((c) => ({ id: c.id, label: courseLabel(c) }))] }]}
        value={courseId}
        searchable
        onChange={setCourseId}
        hint={courses && courses.length === 0 ? t("notes.filters.noCourses") : undefined}
      />
      <Segmented
        label={t("notes.filters.type")}
        value={kind}
        onChange={setKind}
        options={[{ value: "", label: t("notes.filters.allTypes") }, ...NOTE_KINDS.map((k) => ({ value: k, label: t(`notes.kind.${k}`) }))]}
      />
      <Segmented label={t("notes.filters.sort")} value={sort} onChange={setSort} options={NOTE_SORTS.map((s) => ({ value: s, label: t(`notes.sort.${s}`) }))} />
      {!online ? <AppText variant="caption" muted>{t("notes.offline")}</AppText> : null}

      {lib.loading && lib.items.length === 0 ? (
        <View style={{ gap: 12 }}>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      ) : lib.error && lib.items.length === 0 ? (
        <ErrorState title={t("notes.loadFailed")} description={online ? lib.error : t("notes.offline")} action={<Button title={t("common.retry")} onPress={lib.reload} />} />
      ) : lib.items.length === 0 ? (
        <EmptyState title={q || courseId || kind ? t("notes.empty.search") : t("notes.empty.library")} description={q || courseId || kind ? undefined : t("notes.empty.libraryBody")} />
      ) : (
        <View style={{ gap: 12 }}>
          {lib.error ? <ErrorState title={t("notes.loadFailed")} description={lib.error} action={<Button title={t("common.retry")} onPress={lib.reload} />} /> : null}
          {lib.items.map((n) => (
            <NoteCard key={n.id} item={n} onPress={() => router.push({ pathname: "/notes/[id]", params: { id: n.id } })} />
          ))}
          {lib.hasMore ? <Button title={t("notes.loadMore")} variant="secondary" loading={lib.loading} onPress={lib.more} /> : null}
        </View>
      )}
    </View>
  );
}

function Mine() {
  const { t, date } = useI18n();
  const router = useRouter();
  const { user, supabase: sb } = useUser();
  const mine = useAsync(() => listMyUploads(sb, user.id), [sb, user.id]);
  if (mine.loading && !mine.data) return <Skeleton height={100} />;
  if (mine.error && !mine.data) return <ErrorState title={t("notes.loadFailed")} description={mine.error} action={<Button title={t("common.retry")} onPress={mine.reload} />} />;
  if (!mine.data?.length) return <EmptyState title={t("notes.empty.mine")} description={t("notes.empty.mineBody")} action={<Button title={t("notes.uploadCta")} onPress={() => router.push("/notes/upload")} />} />;
  return (
    <View style={{ gap: 12 }}>
      {mine.data.map((u) => {
        const view = noteStatusView(u.status, u.takedownHold);
        return (
          <PressableScale key={u.id} accessibilityRole="button" accessibilityLabel={u.title} onPress={() => router.push({ pathname: "/notes/[id]", params: { id: u.id } })}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Badge tone={view === "published" ? "success" : view === "removed" ? "danger" : "warning"}>{t(`notes.status.${view}`)}</Badge>
                <AppText variant="caption" muted>
                  {date(u.createdAt)}
                </AppText>
              </View>
              <AppText variant="heading">{u.title}</AppText>
              {view !== "published" ? (
                <AppText variant="caption" muted>
                  {t(`notes.statusHint.${view === "pending" ? "pending" : view}`)}
                </AppText>
              ) : null}
            </Card>
          </PressableScale>
        );
      })}
    </View>
  );
}

function Saved() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, supabase: sb } = useUser();
  const saved = useAsync(() => listSaved(sb, user.id), [sb, user.id]);
  if (saved.loading && !saved.data) return <Skeleton height={100} />;
  if (saved.error && !saved.data) return <ErrorState title={t("notes.loadFailed")} description={saved.error} action={<Button title={t("common.retry")} onPress={saved.reload} />} />;
  if (!saved.data?.length) return <EmptyState title={t("notes.empty.saved")} description={t("notes.empty.savedBody")} />;
  return (
    <View style={{ gap: 12 }}>
      {saved.data.map((n) => (
        <NoteCard key={n.id} item={n} onPress={() => router.push({ pathname: "/notes/[id]", params: { id: n.id } })} />
      ))}
    </View>
  );
}

export function NotesScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user, supabase: sb } = useUser();
  const [tab, setTab] = useState<Tab>("library");
  const courses = useAsync(() => listCourses(sb, user.id), [sb, user.id]);
  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <ModuleIcon icon="notes" module="notes" size={48} />
        <View style={{ flex: 1 }}>
          <AppText variant="display" accessibilityRole="header">
            {t("notes.title")}
          </AppText>
          <AppText muted>{t("notes.subtitle")}</AppText>
        </View>
      </View>
      <Button title={t("notes.uploadCta")} icon={<Icon name="upload" size="sm" />} onPress={() => router.push("/notes/upload")} />
      <Segmented
        label={t("notes.tabs.label")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "library", label: t("notes.tabs.library") },
          { value: "mine", label: t("notes.tabs.mine") },
          { value: "saved", label: t("notes.tabs.saved") },
        ]}
      />
      {tab === "library" ? <Library courses={courses.data} /> : tab === "mine" ? <Mine /> : <Saved />}
    </Screen>
  );
}
