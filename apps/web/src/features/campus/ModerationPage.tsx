"use client";

import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Skeleton, useToast } from "@unimate/ui";
import Link from "next/link";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { communityMembers, getCommunity, listEvents, moderateEvent, modRemoveContent, moderationQueue, resolveReport, reviewJoinRequest, setMemberBan } from "./api";
import { useCampusError } from "./parts";

const sb = () => getBrowserClient();

/** Moderator tools for ONE community: reports, join requests, pending events, bans. Everything is enforced by the server. */
export function ModerationPage({ id }: { id: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const c = useAsync(() => getCommunity(sb(), id), [id]);
  const allowed = !!c.data?.can_moderate;
  const queue = useAsync(() => moderationQueue(sb(), id), [id], allowed);
  const requests = useAsync(() => communityMembers(sb(), id, "pending"), [id], allowed);
  const banned = useAsync(() => communityMembers(sb(), id, "banned"), [id], allowed);
  const members = useAsync(() => communityMembers(sb(), id, "active"), [id], allowed);
  const pendingEvents = useAsync(() => listEvents(sb(), "pending", id), [id], allowed);
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
  const back = (
    <p>
      <Link href={`/campus/community/${id}`}>← {c.data?.name ?? t("campus.title")}</Link>
    </p>
  );
  if (c.loading && !c.data)
    return (
      <div className="stack-lg">
        {back}
        <Skeleton height={120} />
      </div>
    );
  if (!allowed)
    return (
      <div className="stack-lg">
        {back}
        <EmptyState title={t("campus.moderation.forbidden")} />
      </div>
    );
  const name = (m: { display_name: string | null; username: string | null }) => m.display_name ?? m.username ?? t("campus.post.anonymousAuthor");
  return (
    <div className="stack-lg">
      {back}
      <div className="page-head">
        <h1>{t("campus.moderation.title")}</h1>
        <p>{c.data?.name}</p>
      </div>

      <section className="stack" aria-labelledby="mq-h">
        <h2 id="mq-h" style={{ margin: 0 }}>
          {t("campus.moderation.queue")}
        </h2>
        {queue.loading && !queue.data ? (
          <Skeleton height={80} />
        ) : queue.error && !queue.data ? (
          <ErrorState title={t("campus.loadFailed")} action={<Button onClick={queue.reload}>{t("common.retry")}</Button>} />
        ) : (queue.data ?? []).length === 0 ? (
          <EmptyState title={t("campus.moderation.empty")} />
        ) : (
          (queue.data ?? []).map((r) => (
            <Card key={r.report_id}>
              <div className="stack">
                <div className="row">
                  <Badge tone="warning">{t(`campus.safety.category.${r.category}`)}</Badge>
                  <Badge>{t(`campus.safety.target.${r.target_kind}`)}</Badge>
                </div>
                {r.excerpt ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.excerpt}</p> : null}
                <p className="um-muted">
                  {t("campus.moderation.reason")}: {r.reason}
                </p>
                <div className="row">
                  {r.target_kind !== "community" ? (
                    <Button size="sm" variant="danger" onClick={() => setRemoval({ kind: r.target_kind as "post" | "comment", id: r.target_id, report: r.report_id })}>
                      {t("campus.moderation.remove")}
                    </Button>
                  ) : null}
                  {r.target_kind === "post" ? (
                    <Link className="um-btn um-btn--ghost um-btn--sm" href={`/campus/post/${r.target_id}`}>
                      {t("campus.community.tabFeed")}
                    </Link>
                  ) : null}
                  {r.author_id ? (
                    <Button size="sm" variant="ghost" onClick={() => void act(() => setMemberBan(sb(), id, r.author_id!, true, r.reason), t("campus.moderation.banned"))}>
                      {t("campus.moderation.ban")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={() => void act(() => resolveReport(sb(), r.report_id, "actioned"), t("campus.moderation.resolved"))}>
                    {t("campus.moderation.actioned")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void act(() => resolveReport(sb(), r.report_id, "dismissed"), t("campus.moderation.resolved"))}>
                    {t("campus.moderation.dismiss")}
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </section>

      <section className="stack" aria-labelledby="rq-h">
        <h2 id="rq-h" style={{ margin: 0 }}>
          {t("campus.moderation.requests")}
        </h2>
        {(requests.data ?? []).length === 0 ? (
          <p className="um-muted">{t("campus.moderation.noRequests")}</p>
        ) : (
          (requests.data ?? []).map((m) => (
            <Card key={m.user_id}>
              <div className="row row--between">
                <Link href={`/campus/user/${m.user_id}`}>{name(m)}</Link>
                <div className="row">
                  <Button size="sm" onClick={() => void act(() => reviewJoinRequest(sb(), id, m.user_id, true), t("campus.moderation.approve"))}>
                    {t("campus.moderation.approve")}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void act(() => reviewJoinRequest(sb(), id, m.user_id, false), t("campus.moderation.reject"))}>
                    {t("campus.moderation.reject")}
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </section>

      <section className="stack" aria-labelledby="pe-h">
        <h2 id="pe-h" style={{ margin: 0 }}>
          {t("campus.moderation.pendingEvents")}
        </h2>
        {(pendingEvents.data ?? []).length === 0 ? (
          <p className="um-muted">{t("campus.events.empty")}</p>
        ) : (
          (pendingEvents.data ?? []).map((e) => (
            <Card key={e.id}>
              <div className="row row--between">
                <Link href={`/campus/event/${e.id}`}>{e.title}</Link>
                <div className="row">
                  <Button size="sm" onClick={() => void act(() => moderateEvent(sb(), e.id, true), t("campus.events.approve"))}>
                    {t("campus.events.approve")}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void act(() => moderateEvent(sb(), e.id, false), t("campus.events.reject"))}>
                    {t("campus.events.reject")}
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </section>

      <section className="stack" aria-labelledby="mm-h">
        <h2 id="mm-h" style={{ margin: 0 }}>
          {t("campus.community.tabMembers")}
        </h2>
        <ul className="list">
          {(members.data ?? [])
            .filter((m) => m.role === "member")
            .map((m) => (
              <li key={m.user_id} className="list-item">
                <Link href={`/campus/user/${m.user_id}`}>{name(m)}</Link>
                <Button size="sm" variant="ghost" onClick={() => void act(() => setMemberBan(sb(), id, m.user_id, true), t("campus.moderation.banned"))}>
                  {t("campus.moderation.ban")}
                </Button>
              </li>
            ))}
        </ul>
      </section>

      <section className="stack" aria-labelledby="bn-h">
        <h2 id="bn-h" style={{ margin: 0 }}>
          {t("campus.moderation.bannedList")}
        </h2>
        {(banned.data ?? []).length === 0 ? (
          <p className="um-muted">{t("campus.moderation.noBanned")}</p>
        ) : (
          <ul className="list">
            {(banned.data ?? []).map((m) => (
              <li key={m.user_id} className="list-item">
                <span>{name(m)}</span>
                <Button size="sm" variant="secondary" onClick={() => void act(() => setMemberBan(sb(), id, m.user_id, false), t("campus.moderation.unbanned"))}>
                  {t("campus.moderation.unban")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={!!removal}
        title={t("campus.moderation.remove")}
        onClose={() => setRemoval(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setRemoval(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3}
              onClick={async () => {
                const r = removal!;
                await act(async () => {
                  await modRemoveContent(sb(), r.kind, r.id, reason.trim());
                  await resolveReport(sb(), r.report, "actioned");
                }, t("campus.moderation.removed"));
                setRemoval(null);
                setReason("");
              }}
            >
              {t("campus.moderation.remove")}
            </Button>
          </>
        }
      >
        <Input label={t("campus.post.removeReason")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Dialog>
    </div>
  );
}
