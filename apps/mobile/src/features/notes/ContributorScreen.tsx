import { NOTE_PAGE_SIZE, type NoteListItem } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AppText, Button, Card, EmptyState, ErrorState, Screen, ScreenHeader, Skeleton } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { getContributor, searchNotes } from "./api";
import { NoteCard, Stars } from "./parts";

export function ContributorScreen({ userId }: { userId: string }) {
  const { t, number } = useI18n();
  const router = useRouter();
  const { supabase: sb } = useUser();
  const profile = useAsync(() => getContributor(sb, userId), [sb, userId]);
  const [extra, setExtra] = useState<NoteListItem[]>([]);
  const [more, setMore] = useState(true);
  const list = useAsync(async () => {
    const rows = await searchNotes(sb, { q: "", courseId: "", kind: "", sort: "newest", offset: 0, uploaderId: userId });
    setMore(rows.length === NOTE_PAGE_SIZE);
    return rows;
  }, [sb, userId]);
  const items = [...(list.data ?? []), ...extra];

  async function loadMore() {
    const rows = await searchNotes(sb, { q: "", courseId: "", kind: "", sort: "newest", offset: items.length, uploaderId: userId });
    setExtra((e) => [...e, ...rows]);
    setMore(rows.length === NOTE_PAGE_SIZE);
  }

  return (
    <Screen>
      <ScreenHeader title={t("notes.contributor.title")} onBack={() => router.back()} />
      {profile.loading && !profile.data ? (
        <Skeleton height={120} />
      ) : profile.error ? (
        <ErrorState title={t("notes.loadFailed")} description={profile.error} action={<Button title={t("common.retry")} onPress={profile.reload} />} />
      ) : !profile.data ? (
        <EmptyState title={t("notes.contributor.notFound")} />
      ) : (
        <>
          <Card strong>
            <AppText variant="title" accessibilityRole="header">
              {profile.data.displayName ?? t("notes.anonymous")}
            </AppText>
            {profile.data.universityName ? <AppText muted>{profile.data.universityName}</AppText> : null}
            <Stars value={profile.data.avgRating} count={profile.data.ratingCount} />
            <View style={{ flexDirection: "row", gap: 24 }}>
              <View>
                <AppText variant="heading">{number(profile.data.resourceCount)}</AppText>
                <AppText variant="caption" muted>
                  {t("notes.contributor.resources")}
                </AppText>
              </View>
              <View>
                <AppText variant="heading">{number(profile.data.totalSaves)}</AppText>
                <AppText variant="caption" muted>
                  {t("notes.contributor.saves")}
                </AppText>
              </View>
            </View>
          </Card>
          {list.loading && !list.data ? (
            <Skeleton height={110} />
          ) : items.length === 0 ? (
            <EmptyState title={t("notes.contributor.empty")} />
          ) : (
            <View style={{ gap: 12 }}>
              {items.map((n) => (
                <NoteCard key={n.id} item={n} onPress={() => router.push({ pathname: "/notes/[id]", params: { id: n.id } })} />
              ))}
              {more ? <Button title={t("notes.loadMore")} variant="secondary" onPress={() => void loadMore()} /> : null}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
