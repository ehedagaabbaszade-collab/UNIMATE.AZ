import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { formatLocalDateTime } from "../../lib/datetime";
import { useState } from "react";
import { View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, Screen, ScreenHeader, Skeleton, useOnline, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { addEventToPlanner, cancelEvent, editEvent, getEvent, moderateEvent, myCommunities, rsvpEvent } from "./api";
import { EventForm } from "./CampusScreen";
import { LanguageTag, RichText, useCampusError } from "./parts";

/** "YYYY-MM-DD HH:MM" in the app time zone (Asia/Baku), the format EventForm expects. */
const toLocalInput = (iso: string | null): string => (iso ? formatLocalDateTime(new Date(iso)) : "");

export function EventDetailScreen({ id }: { id: string }) {
  const { t, dateTime } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const { theme } = useTheme();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const ev = useAsync(() => getEvent(sb, id), [sb, id]);
  const mine = useAsync(() => myCommunities(sb), [sb]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const e = ev.data;
  const back = () => router.back();
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      ev.reload();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  if (ev.loading && !e) return (
    <Screen>
      <ScreenHeader title={t("campus.events.title")} onBack={back} />
      <Skeleton height={160} />
    </Screen>
  );
  if (ev.error && !e) return (
    <Screen>
      <ScreenHeader title={t("campus.events.title")} onBack={back} />
      <ErrorState title={t("campus.loadFailed")} description={online ? undefined : t("campus.offline")} action={<Button title={t("common.retry")} onPress={ev.reload} />} />
    </Screen>
  );
  if (!e) return (
    <Screen>
      <ScreenHeader title={t("campus.events.title")} onBack={back} />
      <EmptyState title={t("campus.notFound")} />
    </Screen>
  );
  const full = e.capacity != null && e.going_count >= e.capacity && e.my_rsvp !== "going";
  const published = e.status === "published";
  return (
    <Screen>
      <ScreenHeader title={t("campus.events.title")} onBack={back} />
      <Card>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Icon name="event" size="sm" color={theme.active} />
          <AppText variant="label">{dateTime(e.starts_at)}</AppText>
          {e.ends_at ? <AppText variant="caption" muted>→ {dateTime(e.ends_at)}</AppText> : null}
          {!published ? <Badge tone="warning">{t("campus.events.pendingReview")}</Badge> : null}
          <LanguageTag language={e.language} />
        </View>
        <AppText variant="title" accessibilityRole="header">
          {e.title}
        </AppText>
        {e.location ? <AppText muted>{e.location}</AppText> : null}
        {e.description ? <RichText text={e.description} /> : null}
        {e.community_name ? (
          <AppText variant="caption" muted onPress={() => e.community_id && router.push(`/campus/community/${e.community_id}`)} accessibilityRole="link">
            {e.community_name}
          </AppText>
        ) : null}
        <AppText variant="caption" muted>
          {[t("campus.events.goingCount", { n: e.going_count }), t("campus.events.interestedCount", { n: e.interested_count }), e.capacity != null ? t("campus.events.capacityLeft", { n: e.capacity }) : null].filter(Boolean).join(" · ")}
        </AppText>
      </Card>

      {published ? (
        <Card>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Button small variant={e.my_rsvp === "going" ? "primary" : "secondary"} title={full ? t("campus.events.full") : t("campus.events.rsvpGoing")} disabled={full} loading={busy} onPress={() => void run(async () => { await rsvpEvent(sb, id, e.my_rsvp === "going" ? "none" : "going"); })} />
            <Button small variant={e.my_rsvp === "interested" ? "primary" : "secondary"} title={t("campus.events.rsvpInterested")} onPress={() => void run(async () => { await rsvpEvent(sb, id, e.my_rsvp === "interested" ? "none" : "interested"); })} />
          </View>
          <Button
            small
            variant={e.in_planner ? "ghost" : "secondary"}
            title={e.in_planner ? t("campus.events.inPlanner") : t("campus.events.addToPlanner")}
            disabled={e.in_planner}
            onPress={() => void run(async () => { await addEventToPlanner(sb, id); toast(t("campus.events.addedToPlanner"), "success"); })}
          />
        </Card>
      ) : null}

      {!published && e.can_moderate ? (
        <Card>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button small title={t("campus.events.approve")} onPress={() => void run(() => moderateEvent(sb, id, true))} />
            <Button small variant="danger" title={t("campus.events.reject")} onPress={() => void run(async () => { await moderateEvent(sb, id, false); back(); })} />
          </View>
        </Card>
      ) : null}

      {e.is_mine || e.can_moderate ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {e.is_mine ? <Button small variant="secondary" title={t("campus.events.edit")} onPress={() => setEditing((v) => !v)} /> : null}
          <Button small variant="ghost" title={t("campus.events.cancel")} onPress={() => setConfirmCancel(true)} />
        </View>
      ) : null}

      {editing && e.is_mine ? (
        <EventFormEdit eventId={id} start={toLocalInput(e.starts_at)} end={toLocalInput(e.ends_at)} e={e} communities={mine.data ?? []} onDone={(msg) => { toast(msg, "success"); setEditing(false); ev.reload(); }} />
      ) : null}

      <Dialog
        open={confirmCancel}
        title={t("campus.events.cancelConfirm")}
        onClose={() => setConfirmCancel(false)}
        actions={
          <>
            <Button title={t("campus.events.cancel")} variant="danger" onPress={async () => { try { await cancelEvent(sb, id); toast(t("campus.events.cancelled"), "success"); setConfirmCancel(false); back(); } catch (err) { onError(err); } }} />
            <Button title={t("common.cancel")} variant="ghost" onPress={() => setConfirmCancel(false)} />
          </>
        }
      >
        <View />
      </Dialog>
    </Screen>
  );
}

function EventFormEdit({ eventId, e, start, end, communities, onDone }: { eventId: string; e: { title: string; description: string | null; location: string | null; capacity: number | null }; start: string; end: string; communities: Parameters<typeof EventForm>[0]["communities"]; onDone: (message: string) => void }) {
  const { t } = useI18n();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  return (
    <EventForm
      communities={communities}
      initial={{ title: e.title, description: e.description ?? "", location: e.location ?? "", startsAt: start, endsAt: end, capacity: e.capacity != null ? String(e.capacity) : "" }}
      submitLabel={t("campus.post.save")}
      onSubmit={async (v) => {
        try {
          const status = await editEvent(sb, eventId, v);
          onDone(t(status === "pending" ? "campus.events.editedReview" : "campus.events.saved"));
        } catch (err) {
          onError(err);
        }
      }}
    />
  );
}
