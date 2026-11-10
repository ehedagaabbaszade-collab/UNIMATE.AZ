import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AppText, Button, Card, EmptyState, ErrorState, Screen, ScreenHeader, Skeleton, useOnline } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { blockUser, blockedUsers, campusProfile, followUser, react, setDiscoverable, userPosts } from "./api";
import { usePagedPosts } from "./hooks";
import { BlockDialog, Chips, PostCardView, ReportDialog, useCampusError } from "./parts";

export function UserScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const prof = useAsync(() => campusProfile(sb, id), [sb, id]);
  const feed = usePagedPosts((cursor) => userPosts(sb, id, { cursor }), id);
  const [report, setReport] = useState(false);
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = prof.data;
  const back = () => router.back();
  if (prof.loading && p === undefined) return (
    <Screen>
      <ScreenHeader title={t("campus.profile.title")} onBack={back} />
      <Skeleton height={140} />
    </Screen>
  );
  if (prof.error && p === undefined) return (
    <Screen>
      <ScreenHeader title={t("campus.profile.title")} onBack={back} />
      <ErrorState title={t("campus.loadFailed")} description={online ? undefined : t("campus.offline")} action={<Button title={t("common.retry")} onPress={prof.reload} />} />
    </Screen>
  );
  if (!p) return (
    <Screen>
      <ScreenHeader title={t("campus.profile.title")} onBack={back} />
      <EmptyState title={t("campus.profile.unavailable")} />
    </Screen>
  );
  const name = p.display_name ?? p.username ?? t("campus.post.anonymousAuthor");
  const visible = p.follower_count != null;
  return (
    <Screen>
      <ScreenHeader title={t("campus.profile.title")} onBack={back} />
      <Card>
        <AppText variant="title" accessibilityRole="header">
          {name}
        </AppText>
        {p.username ? <AppText muted>@{p.username}</AppText> : null}
        {p.university_name ? (
          <AppText variant="caption" muted>
            {t("campus.profile.university")}: {p.university_name}
          </AppText>
        ) : null}
        {visible ? (
          <>
            <AppText muted={!p.bio}>{p.bio ?? t("campus.profile.noBio")}</AppText>
            <AppText variant="caption" muted>
              {[t("campus.profile.followers", { n: p.follower_count ?? 0 }), t("campus.profile.following", { n: p.following_count ?? 0 }), t("campus.profile.posts", { n: p.post_count ?? 0 })].join(" · ")}
            </AppText>
          </>
        ) : (
          <AppText muted>{t("campus.profile.privateProfile")}</AppText>
        )}
        {!p.is_self ? (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button
              small
              variant={p.is_following ? "secondary" : "primary"}
              title={p.is_following ? t("campus.profile.unfollow") : t("campus.profile.follow")}
              loading={busy}
              onPress={async () => {
                setBusy(true);
                try {
                  await followUser(sb, id, !p.is_following);
                  prof.reload();
                } catch (e) {
                  onError(e);
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button small variant="ghost" title={t("campus.safety.report")} onPress={() => setReport(true)} />
            <Button small variant="ghost" title={t("campus.safety.block")} onPress={() => setBlock(true)} />
          </View>
        ) : (
          <SelfPrivacy discoverable={p.discoverable} onChanged={prof.reload} />
        )}
      </Card>
      {visible ? (
        feed.loading && feed.items.length === 0 ? (
          <Skeleton height={120} />
        ) : feed.error && feed.items.length === 0 ? (
          <ErrorState title={t("campus.loadFailed")} action={<Button title={t("common.retry")} onPress={feed.reload} />} />
        ) : feed.items.length === 0 ? (
          <EmptyState title={t("campus.feed.userEmpty")} />
        ) : (
          <View style={{ gap: 12 }}>
            {feed.items.map((post) => (
              <PostCardView
                key={post.id}
                post={post}
                onOpen={() => router.push(`/campus/post/${post.id}`)}
                onLike={async () => {
                  try {
                    const r = await react(sb, "post", post.id, "like", !post.my_liked);
                    feed.patch(post.id, { like_count: Number(r.like_count), my_liked: r.my_like });
                  } catch (e) {
                    onError(e);
                  }
                }}
              />
            ))}
            {feed.hasMore ? <Button title={t("campus.loadMore")} variant="secondary" loading={feed.loading} onPress={feed.more} /> : null}
          </View>
        )
      ) : null}
      {p.is_self ? <BlockedList /> : null}
      {report ? <ReportDialog target="user" id={id} onClose={() => setReport(false)} /> : null}
      {block ? (
        <BlockDialog
          user={id}
          onClose={(blocked) => {
            setBlock(false);
            if (blocked) back();
          }}
        />
      ) : null}
    </Screen>
  );
}

function SelfPrivacy({ discoverable, onChanged }: { discoverable: boolean; onChanged: () => void }) {
  const { t } = useI18n();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="label">{t("campus.profile.discoverable")}</AppText>
      <Chips
        label={t("campus.profile.discoverable")}
        value={discoverable ? "on" : "off"}
        onChange={async (v) => {
          try {
            await setDiscoverable(sb, v === "on");
            onChanged();
          } catch (e) {
            onError(e);
          }
        }}
        options={[{ value: "on", label: t("campus.profile.discoverableOn") }, { value: "off", label: t("campus.profile.discoverableOff") }]}
      />
      <AppText variant="caption" muted>
        {t("campus.profile.discoverableHint")}
      </AppText>
    </View>
  );
}

function BlockedList() {
  const { t } = useI18n();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const list = useAsync(() => blockedUsers(sb), [sb]);
  return (
    <Card>
      <AppText variant="heading">{t("campus.profile.blockedList")}</AppText>
      {(list.data ?? []).length === 0 ? (
        <AppText muted>{t("campus.profile.noBlocked")}</AppText>
      ) : (
        (list.data ?? []).map((u) => (
          <View key={u.user_id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <AppText style={{ flex: 1 }}>{u.display_name ?? u.username ?? t("campus.post.anonymousAuthor")}</AppText>
            <Button
              small
              variant="secondary"
              title={t("campus.safety.unblock")}
              onPress={async () => {
                try {
                  await blockUser(sb, u.user_id, false);
                  list.reload();
                } catch (e) {
                  onError(e);
                }
              }}
            />
          </View>
        ))
      )}
    </Card>
  );
}
