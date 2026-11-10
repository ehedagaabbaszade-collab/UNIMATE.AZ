import type { CommunityDetail } from "@unimate/core";
import { CAMPUS_LIMITS, campusTextProblem } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, Share, View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Screen, ScreenHeader, Segmented, Skeleton, useOnline, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { communityFeed, communityMembers, getCommunity, inviteCode, joinCommunity, leaveCommunity, listEvents, react, updateCommunity } from "./api";
import { usePagedPosts } from "./hooks";
import { EventCardView, PostCardView, ReportDialog, useCampusError } from "./parts";

type Tab = "feed" | "members" | "events" | "about";

function GroupInvite({ id }: { id: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const code = useAsync(() => inviteCode(sb, id), [sb, id]);
  if (!code.data && !code.error) return null;
  return (
    <Card>
      <AppText variant="label">{t("campus.groups.inviteCode")}</AppText>
      <AppText variant="title" selectable accessibilityLabel={`${t("campus.groups.inviteCode")}: ${code.data ?? ""}`} style={{ letterSpacing: 2 }}>
        {code.data ?? "…"}
      </AppText>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button small variant="secondary" title={t("campus.groups.copy")} disabled={!code.data} onPress={() => void Share.share({ message: code.data! })} />
        <Button
          small
          variant="ghost"
          title={t("campus.groups.rotate")}
          onPress={async () => {
            try {
              code.setData(await inviteCode(sb, id, true));
              toast(t("campus.groups.rotated"), "success");
            } catch (e) {
              onError(e);
            }
          }}
        />
      </View>
    </Card>
  );
}

function AboutTab({ c, onSaved }: { c: CommunityDetail; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(c.description ?? "");
  const [rules, setRules] = useState(c.rules ?? "");
  return (
    <View style={{ gap: 12 }}>
      {c.kind === "group" && c.can_moderate ? <GroupInvite id={c.id} /> : null}
      <Card>
        {editing ? (
          <>
            <Input label={t("campus.communities.createDescription")} value={description} onChangeText={setDescription} multiline maxLength={CAMPUS_LIMITS.description} />
            <Input label={t("campus.communities.createRules")} value={rules} onChangeText={setRules} multiline maxLength={CAMPUS_LIMITS.rules} />
            <Button
              title={t("campus.post.save")}
              disabled={!!campusTextProblem(description + rules)}
              onPress={async () => {
                try {
                  await updateCommunity(sb, c.id, description.trim(), rules.trim());
                  toast(t("campus.community.saved"), "success");
                  setEditing(false);
                  onSaved();
                } catch (e) {
                  onError(e);
                }
              }}
            />
          </>
        ) : (
          <>
            <AppText variant="heading">{t("campus.community.about")}</AppText>
            <AppText muted={!c.description}>{c.description ?? t("campus.community.noDescription")}</AppText>
            <AppText variant="heading">{t("campus.community.rules")}</AppText>
            <AppText muted={!c.rules}>{c.rules ?? t("campus.community.noRules")}</AppText>
            {c.my_role === "owner" || c.my_role === "moderator" ? <Button small variant="secondary" title={t("campus.community.editAbout")} onPress={() => setEditing(true)} /> : null}
          </>
        )}
      </Card>
    </View>
  );
}

export function CommunityScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const c = useAsync(() => getCommunity(sb, id), [sb, id]);
  const [tab, setTab] = useState<Tab>("feed");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [report, setReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = c.data;
  const member = d?.my_status === "active";
  const feed = usePagedPosts((cursor) => communityFeed(sb, id, { cursor }), id);
  const members = useAsync(() => communityMembers(sb, id), [sb, id, member], tab === "members" && member);
  const events = useAsync(() => listEvents(sb, "upcoming", id), [sb, id], tab === "events");
  const back = () => router.back();

  if (c.loading && !d) return (
    <Screen>
      <ScreenHeader title={t("campus.title")} onBack={back} />
      <Skeleton height={140} />
    </Screen>
  );
  if (c.error && !d) return (
    <Screen>
      <ScreenHeader title={t("campus.title")} onBack={back} />
      <ErrorState title={t("campus.loadFailed")} description={online ? undefined : t("campus.offline")} action={<Button title={t("common.retry")} onPress={c.reload} />} />
    </Screen>
  );
  if (!d) return (
    <Screen>
      <ScreenHeader title={t("campus.title")} onBack={back} />
      <EmptyState title={t("campus.notFound")} />
    </Screen>
  );

  async function join() {
    setBusy(true);
    try {
      await joinCommunity(sb, id);
      c.reload();
      feed.reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <ScreenHeader title={d.name} onBack={back} />
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Icon name="group" size="sm" />
          <Badge tone="info">{t(`campus.communities.kind.${d.kind}`)}</Badge>
          <Badge tone="neutral">{t(d.visibility === "public" ? "campus.communities.visibilityPublic" : "campus.communities.visibilityPrivate")}</Badge>
          {d.my_role ? <Badge tone="success">{t(`campus.community.role.${d.my_role}`)}</Badge> : null}
        </View>
        <AppText variant="caption" muted>
          {t("campus.communities.members", { n: d.member_count })}
        </AppText>
        {d.my_status === "pending" ? <AppText muted>{t("campus.community.pendingNotice")}</AppText> : null}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {!d.my_status ? <Button small title={t(d.visibility === "public" ? "campus.communities.join" : "campus.communities.requestJoin")} loading={busy} onPress={() => void join()} /> : null}
          {member && d.my_role !== "owner" ? <Button small variant="ghost" title={t("campus.communities.leave")} onPress={() => setConfirmLeave(true)} /> : null}
          {d.can_moderate ? (
            <Pressable onPress={() => router.push(`/campus/moderation/${id}`)} accessibilityRole="button" style={{ minHeight: 36, justifyContent: "center" }}>
              <Badge tone="warning">{`${t("campus.community.moderate")}${d.pending_requests ? ` (${d.pending_requests})` : ""}`}</Badge>
            </Pressable>
          ) : null}
          {!d.can_moderate ? <Button small variant="ghost" title={t("campus.safety.report")} onPress={() => setReport(true)} /> : null}
        </View>
      </Card>
      <Segmented label={t("campus.tabs.label")} value={tab} onChange={setTab} options={[{ value: "feed", label: t("campus.community.tabFeed") }, { value: "members", label: t("campus.community.tabMembers") }, { value: "events", label: t("campus.community.tabEvents") }, { value: "about", label: t("campus.community.tabAbout") }]} />

      {tab === "feed" ? (
        <View style={{ gap: 12 }}>
          {!member ? <AppText muted>{t("campus.community.joinToPost")}</AppText> : null}
          {feed.loading && feed.items.length === 0 ? (
            <Skeleton height={120} />
          ) : feed.error && feed.items.length === 0 ? (
            <ErrorState title={t("campus.loadFailed")} action={<Button title={t("common.retry")} onPress={feed.reload} />} />
          ) : feed.items.length === 0 ? (
            <EmptyState title={t("campus.feed.empty")} />
          ) : (
            <>
              {feed.items.map((p) => (
                <PostCardView
                  key={p.id}
                  post={p}
                  onOpen={() => router.push(`/campus/post/${p.id}`)}
                  onAuthor={() => p.author_id && router.push(`/campus/user/${p.author_id}`)}
                  onLike={async () => {
                    try {
                      const r = await react(sb, "post", p.id, "like", !p.my_liked);
                      feed.patch(p.id, { like_count: Number(r.like_count), my_liked: r.my_like });
                    } catch (e) {
                      onError(e);
                    }
                  }}
                />
              ))}
              {feed.hasMore ? <Button title={t("campus.loadMore")} variant="secondary" loading={feed.loading} onPress={feed.more} /> : null}
            </>
          )}
        </View>
      ) : null}

      {tab === "members" ? (
        !member ? (
          <AppText muted>{t("campus.community.membersHidden")}</AppText>
        ) : members.loading && !members.data ? (
          <Skeleton height={80} />
        ) : (members.data ?? []).length === 0 ? (
          <EmptyState title={t("campus.community.noMembers")} />
        ) : (
          <View style={{ gap: 8 }}>
            {(members.data ?? []).map((m) => (
              <Pressable key={m.user_id} onPress={() => router.push(`/campus/user/${m.user_id}`)} accessibilityRole="button" accessibilityLabel={`${m.display_name ?? m.username ?? ""}, ${t(`campus.community.role.${m.role}`)}`}>
                <Card>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <AppText variant="label" style={{ flex: 1 }}>
                      {m.display_name ?? m.username ?? t("campus.post.anonymousAuthor")}
                    </AppText>
                    {m.role !== "member" ? <Badge tone="info">{t(`campus.community.role.${m.role}`)}</Badge> : null}
                  </View>
                </Card>
              </Pressable>
            ))}
          </View>
        )
      ) : null}

      {tab === "events" ? (
        events.loading && !events.data ? (
          <Skeleton height={80} />
        ) : events.error && !events.data ? (
          <ErrorState title={t("campus.loadFailed")} action={<Button title={t("common.retry")} onPress={events.reload} />} />
        ) : (events.data ?? []).length === 0 ? (
          <EmptyState title={t("campus.events.empty")} />
        ) : (
          <View style={{ gap: 12 }}>
            {(events.data ?? []).map((e) => (
              <EventCardView key={e.id} e={e} onOpen={() => router.push(`/campus/event/${e.id}`)} />
            ))}
          </View>
        )
      ) : null}

      {tab === "about" ? <AboutTab c={d} onSaved={c.reload} /> : null}

      <Dialog
        open={confirmLeave}
        title={t("campus.communities.leaveConfirm")}
        onClose={() => setConfirmLeave(false)}
        actions={
          <>
            <Button
              title={t("campus.communities.leave")}
              variant="danger"
              onPress={async () => {
                try {
                  await leaveCommunity(sb, id);
                  setConfirmLeave(false);
                  toast(t("campus.communities.leave"), "success");
                  c.reload();
                  feed.reload();
                } catch (e) {
                  onError(e);
                }
              }}
            />
            <Button title={t("common.cancel")} variant="ghost" onPress={() => setConfirmLeave(false)} />
          </>
        }
      >
        <View />
      </Dialog>
      {report ? <ReportDialog target="community" id={id} onClose={() => setReport(false)} /> : null}
    </Screen>
  );
}
