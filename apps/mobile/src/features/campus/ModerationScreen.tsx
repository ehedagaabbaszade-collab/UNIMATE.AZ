import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Screen, ScreenHeader, Skeleton, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { communityMembers, getCommunity, listEvents, moderateEvent, modRemoveContent, moderationQueue, resolveReport, reviewJoinRequest, setMemberBan } from "./api";
import { useCampusError } from "./parts";

/** Moderator tools for ONE community: reports, join requests, pending events, bans. Everything is enforced by the server. */
export function ModerationScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const c = useAsync(() => getCommunity(sb, id), [sb, id]);
  const allowed = !!c.data?.can_moderate;
  const queue = useAsync(() => moderationQueue(sb, id), [sb, id], allowed);
  const requests = useAsync(() => communityMembers(sb, id, "pending"), [sb, id], allowed);
  const banned = useAsync(() => communityMembers(sb, id, "banned"), [sb, id], allowed);
  const members = useAsync(() => communityMembers(sb, id, "active"), [sb, id], allowed);
  const pendingEvents = useAsync(() => listEvents(sb, "pending", id), [sb, id], allowed);
  const [removal, setRemoval] = useState<{ kind: "post" | "comment"; id: string; report: string } | null>(null);
  const [reason, setReason] = useState("");
  const reloadAll = () => {
    queue.reload();
    requests.reload();
    banned.reload();
    members.reload();
    pendingEvents.reload();
  };
  const act = async (fn: () => Promise<unknown>, message: string) => {
    try {
      await fn();
      toast(message, "success");
      reloadAll();
    } catch (e) {
      onError(e);
    }
  };
  const back = () => router.back();
  if (c.loading && !c.data) return (
    <Screen>
      <ScreenHeader title={t("campus.moderation.title")} onBack={back} />
      <Skeleton height={120} />
    </Screen>
  );
  if (!allowed) return (
    <Screen>
      <ScreenHeader title={t("campus.moderation.title")} onBack={back} />
      <EmptyState title={t("campus.moderation.forbidden")} />
    </Screen>
  );
  const name = (m: { display_name: string | null; username: string | null }) => m.display_name ?? m.username ?? t("campus.post.anonymousAuthor");
  return (
    <Screen>
      <ScreenHeader title={`${t("campus.moderation.title")}: ${c.data?.name ?? ""}`} onBack={back} />

      <AppText variant="heading">{t("campus.moderation.queue")}</AppText>
      {queue.loading && !queue.data ? (
        <Skeleton height={80} />
      ) : queue.error && !queue.data ? (
        <ErrorState title={t("campus.loadFailed")} action={<Button title={t("common.retry")} onPress={queue.reload} />} />
      ) : (queue.data ?? []).length === 0 ? (
        <EmptyState title={t("campus.moderation.empty")} />
      ) : (
        <View style={{ gap: 10 }}>
          {(queue.data ?? []).map((r) => (
            <Card key={r.report_id}>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Badge tone="warning">{t(`campus.safety.category.${r.category}`)}</Badge>
                <Badge tone="neutral">{t(`campus.safety.target.${r.target_kind}`)}</Badge>
              </View>
              {r.excerpt ? <AppText numberOfLines={4}>{r.excerpt}</AppText> : null}
              <AppText variant="caption" muted>
                {t("campus.moderation.reason")}: {r.reason}
              </AppText>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {r.target_kind !== "community" ? <Button small variant="danger" title={t("campus.moderation.remove")} onPress={() => setRemoval({ kind: r.target_kind as "post" | "comment", id: r.target_id, report: r.report_id })} /> : null}
                {r.target_kind === "post" ? <Button small variant="ghost" title={t("campus.community.tabFeed")} onPress={() => router.push(`/campus/post/${r.target_id}`)} /> : null}
                {r.author_id ? <Button small variant="ghost" title={t("campus.moderation.ban")} onPress={() => void act(() => setMemberBan(sb, id, r.author_id!, true, r.reason), t("campus.moderation.banned"))} /> : null}
                <Button small variant="secondary" title={t("campus.moderation.actioned")} onPress={() => void act(() => resolveReport(sb, r.report_id, "actioned"), t("campus.moderation.resolved"))} />
                <Button small variant="ghost" title={t("campus.moderation.dismiss")} onPress={() => void act(() => resolveReport(sb, r.report_id, "dismissed"), t("campus.moderation.resolved"))} />
              </View>
            </Card>
          ))}
        </View>
      )}

      <AppText variant="heading">{t("campus.moderation.requests")}</AppText>
      {(requests.data ?? []).length === 0 ? (
        <AppText muted>{t("campus.moderation.noRequests")}</AppText>
      ) : (
        (requests.data ?? []).map((m) => (
          <Card key={m.user_id}>
            <AppText variant="label">{name(m)}</AppText>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button small title={t("campus.moderation.approve")} onPress={() => void act(() => reviewJoinRequest(sb, id, m.user_id, true), t("campus.moderation.approve"))} />
              <Button small variant="danger" title={t("campus.moderation.reject")} onPress={() => void act(() => reviewJoinRequest(sb, id, m.user_id, false), t("campus.moderation.reject"))} />
            </View>
          </Card>
        ))
      )}

      <AppText variant="heading">{t("campus.moderation.pendingEvents")}</AppText>
      {(pendingEvents.data ?? []).length === 0 ? (
        <AppText muted>{t("campus.events.empty")}</AppText>
      ) : (
        (pendingEvents.data ?? []).map((e) => (
          <Card key={e.id}>
            <AppText variant="label" onPress={() => router.push(`/campus/event/${e.id}`)} accessibilityRole="link">
              {e.title}
            </AppText>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button small title={t("campus.events.approve")} onPress={() => void act(() => moderateEvent(sb, e.id, true), t("campus.events.approve"))} />
              <Button small variant="danger" title={t("campus.events.reject")} onPress={() => void act(() => moderateEvent(sb, e.id, false), t("campus.events.reject"))} />
            </View>
          </Card>
        ))
      )}

      <AppText variant="heading">{t("campus.community.tabMembers")}</AppText>
      {(members.data ?? [])
        .filter((m) => m.role === "member")
        .map((m) => (
          <Card key={m.user_id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <AppText variant="label" style={{ flex: 1 }}>
                {name(m)}
              </AppText>
              <Button small variant="ghost" title={t("campus.moderation.ban")} onPress={() => void act(() => setMemberBan(sb, id, m.user_id, true), t("campus.moderation.banned"))} />
            </View>
          </Card>
        ))}

      <AppText variant="heading">{t("campus.moderation.bannedList")}</AppText>
      {(banned.data ?? []).length === 0 ? (
        <AppText muted>{t("campus.moderation.noBanned")}</AppText>
      ) : (
        (banned.data ?? []).map((m) => (
          <Card key={m.user_id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <AppText variant="label" style={{ flex: 1 }}>
                {name(m)}
              </AppText>
              <Button small variant="secondary" title={t("campus.moderation.unban")} onPress={() => void act(() => setMemberBan(sb, id, m.user_id, false), t("campus.moderation.unbanned"))} />
            </View>
          </Card>
        ))
      )}

      <Dialog
        open={!!removal}
        title={t("campus.moderation.remove")}
        onClose={() => setRemoval(null)}
        actions={
          <>
            <Button
              title={t("campus.moderation.remove")}
              variant="danger"
              disabled={reason.trim().length < 3}
              onPress={async () => {
                const r = removal!;
                await act(async () => {
                  await modRemoveContent(sb, r.kind, r.id, reason.trim());
                  await resolveReport(sb, r.report, "actioned");
                }, t("campus.moderation.removed"));
                setRemoval(null);
                setReason("");
              }}
            />
            <Button title={t("common.cancel")} variant="ghost" onPress={() => setRemoval(null)} />
          </>
        }
      >
        <Input label={t("campus.post.removeReason")} value={reason} onChangeText={setReason} maxLength={500} />
      </Dialog>
    </Screen>
  );
}
