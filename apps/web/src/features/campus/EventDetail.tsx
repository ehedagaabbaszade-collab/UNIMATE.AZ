"use client";

import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Icon, Skeleton, useOnlineStatus, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { addEventToPlanner, cancelEvent, editEvent, getEvent, moderateEvent, myCommunities, rsvpEvent } from "./api";
import { EventForm } from "./CampusHub";
import { LanguageTag, RichText, useCampusError } from "./parts";

const sb = () => getBrowserClient();
/** Value for <input type="datetime-local"> in the browser's time zone. */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function EventDetail({ id }: { id: string }) {
  const { t, dateTime } = useI18n();
  const router = useRouter();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const onError = useCampusError();
  const ev = useAsync(() => getEvent(sb(), id), [id]);
  const mine = useAsync(() => myCommunities(sb()), []);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const e = ev.data;
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
  const back = (
    <p>
      <Link href="/campus">← {t("campus.title")}</Link>
    </p>
  );
  if (ev.loading && !e)
    return (
      <div className="stack-lg">
        {back}
        <Skeleton height={180} />
      </div>
    );
  if (ev.error && !e)
    return (
      <div className="stack-lg">
        {back}
        <ErrorState title={t("campus.loadFailed")} {...(online ? {} : { description: t("campus.offline") })} action={<Button onClick={ev.reload}>{t("common.retry")}</Button>} />
      </div>
    );
  if (!e)
    return (
      <div className="stack-lg">
        {back}
        <EmptyState title={t("campus.notFound")} />
      </div>
    );
  const full = e.capacity != null && e.going_count >= e.capacity && e.my_rsvp !== "going";
  const published = e.status === "published";
  return (
    <div className="stack-lg">
      {back}
      <Card>
        <div className="stack">
          <div className="row">
            <Icon name="event" size={18} />
            <strong>{dateTime(e.starts_at)}</strong>
            {e.ends_at ? <span className="um-muted">→ {dateTime(e.ends_at)}</span> : null}
            {!published ? <Badge tone="warning">{t("campus.events.pendingReview")}</Badge> : null}
            <LanguageTag language={e.language} />
          </div>
          <h1 style={{ margin: 0 }}>{e.title}</h1>
          {e.location ? <p className="um-muted">{e.location}</p> : null}
          {e.description ? <RichText text={e.description} /> : null}
          {e.community_name && e.community_id ? <Link href={`/campus/community/${e.community_id}`}>{e.community_name}</Link> : null}
          <p className="um-muted">{[t("campus.events.goingCount", { n: e.going_count }), t("campus.events.interestedCount", { n: e.interested_count }), e.capacity != null ? t("campus.events.capacityLeft", { n: e.capacity }) : null].filter(Boolean).join(" · ")}</p>
        </div>
      </Card>

      {published ? (
        <Card>
          <div className="row">
            <Button variant={e.my_rsvp === "going" ? "primary" : "secondary"} aria-pressed={e.my_rsvp === "going"} disabled={full} loading={busy} onClick={() => void run(async () => { await rsvpEvent(sb(), id, e.my_rsvp === "going" ? "none" : "going"); })}>
              {full ? t("campus.events.full") : t("campus.events.rsvpGoing")}
            </Button>
            <Button variant={e.my_rsvp === "interested" ? "primary" : "secondary"} aria-pressed={e.my_rsvp === "interested"} onClick={() => void run(async () => { await rsvpEvent(sb(), id, e.my_rsvp === "interested" ? "none" : "interested"); })}>
              {t("campus.events.rsvpInterested")}
            </Button>
            <Button variant="ghost" disabled={e.in_planner} onClick={() => void run(async () => { await addEventToPlanner(sb(), id); toast(t("campus.events.addedToPlanner"), "success"); })}>
              <Icon name="planner" size={16} /> {e.in_planner ? t("campus.events.inPlanner") : t("campus.events.addToPlanner")}
            </Button>
          </div>
        </Card>
      ) : null}

      {!published && e.can_moderate ? (
        <Card>
          <div className="row">
            <Button onClick={() => void run(() => moderateEvent(sb(), id, true))}>{t("campus.events.approve")}</Button>
            <Button variant="danger" onClick={() => void run(async () => { await moderateEvent(sb(), id, false); router.push("/campus"); })}>
              {t("campus.events.reject")}
            </Button>
          </div>
        </Card>
      ) : null}

      {e.is_mine || e.can_moderate ? (
        <div className="row">
          {e.is_mine ? (
            <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
              {t("campus.events.edit")}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
            {t("campus.events.cancel")}
          </Button>
        </div>
      ) : null}

      {editing && e.is_mine ? (
        <EventForm
          communities={mine.data ?? []}
          initial={{ title: e.title, description: e.description ?? "", location: e.location ?? "", startsAt: toLocalInput(e.starts_at), endsAt: toLocalInput(e.ends_at), capacity: e.capacity != null ? String(e.capacity) : "" }}
          submitLabel={t("campus.post.save")}
          onSubmit={async (v) => {
            try {
              const status = await editEvent(sb(), id, v);
              toast(t(status === "pending" ? "campus.events.editedReview" : "campus.events.saved"), "success");
              setEditing(false);
              ev.reload();
            } catch (err) {
              onError(err);
            }
          }}
        />
      ) : null}

      <Dialog
        open={confirmCancel}
        title={t("campus.events.cancelConfirm")}
        onClose={() => setConfirmCancel(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await cancelEvent(sb(), id);
                  toast(t("campus.events.cancelled"), "success");
                  router.push("/campus");
                } catch (err) {
                  onError(err);
                }
              }}
            >
              {t("campus.events.cancel")}
            </Button>
          </>
        }
      />
    </div>
  );
}
