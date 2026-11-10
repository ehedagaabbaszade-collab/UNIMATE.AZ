"use client";

import { CAMPUS_LIMITS, campusTextProblem, type CommunityDetail } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Icon, Skeleton, Textarea, useOnlineStatus, useToast } from "@unimate/ui";
import Link from "next/link";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { communityFeed, communityMembers, getCommunity, inviteCode, joinCommunity, leaveCommunity, listEvents, react, updateCommunity } from "./api";
import { usePagedPosts } from "./hooks";
import { Chips, EventCardView, PostCardView, ReportDialog, useCampusError } from "./parts";

type Tab = "feed" | "members" | "events" | "about";
const sb = () => getBrowserClient();

function GroupInvite({ id }: { id: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const code = useAsync(() => inviteCode(sb(), id), [id]);
  if (!code.data && !code.error) return null;
  return (
    <Card>
      <div className="stack">
        <strong>{t("campus.groups.inviteCode")}</strong>
        <p aria-label={`${t("campus.groups.inviteCode")}: ${code.data ?? ""}`} style={{ fontSize: "var(--text-xl, 1.5rem)", letterSpacing: 2, fontWeight: 700, userSelect: "all" }}>
          {code.data ?? "…"}
        </p>
        <div className="row">
          <Button
            size="sm"
            variant="secondary"
            disabled={!code.data}
            onClick={async () => {
              if (!code.data) return;
              if (typeof navigator.share === "function") await navigator.share({ text: code.data }).catch(() => undefined);
              else await navigator.clipboard?.writeText(code.data).catch(() => undefined);
            }}
          >
            {t("campus.groups.copy")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                code.setData(await inviteCode(sb(), id, true));
                toast(t("campus.groups.rotated"), "success");
              } catch (e) {
                onError(e);
              }
            }}
          >
            {t("campus.groups.rotate")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AboutTab({ c, onSaved }: { c: CommunityDetail; onSaved: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(c.description ?? "");
  const [rules, setRules] = useState(c.rules ?? "");
  return (
    <div className="stack-lg">
      {c.kind === "group" && c.can_moderate ? <GroupInvite id={c.id} /> : null}
      <Card>
        {editing ? (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await updateCommunity(sb(), c.id, description.trim(), rules.trim());
                toast(t("campus.community.saved"), "success");
                setEditing(false);
                onSaved();
              } catch (err) {
                onError(err);
              }
            }}
          >
            <Textarea label={t("campus.communities.createDescription")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={CAMPUS_LIMITS.description} />
            <Textarea label={t("campus.communities.createRules")} value={rules} onChange={(e) => setRules(e.target.value)} maxLength={CAMPUS_LIMITS.rules} />
            <div className="row">
              <Button type="submit" disabled={!!campusTextProblem(description + rules)}>
                {t("campus.post.save")}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="stack">
            <h2 style={{ margin: 0 }}>{t("campus.community.about")}</h2>
            <p className={c.description ? undefined : "um-muted"} style={{ whiteSpace: "pre-wrap" }}>
              {c.description ?? t("campus.community.noDescription")}
            </p>
            <h2 style={{ margin: 0 }}>{t("campus.community.rules")}</h2>
            <p className={c.rules ? undefined : "um-muted"} style={{ whiteSpace: "pre-wrap" }}>
              {c.rules ?? t("campus.community.noRules")}
            </p>
            {c.my_role === "owner" || c.my_role === "moderator" ? (
              <div className="row">
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  {t("campus.community.editAbout")}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

export function CommunityPage({ id }: { id: string }) {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const onError = useCampusError();
  const c = useAsync(() => getCommunity(sb(), id), [id]);
  const [tab, setTab] = useState<Tab>("feed");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [report, setReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = c.data;
  const member = d?.my_status === "active";
  const feed = usePagedPosts((cursor) => communityFeed(sb(), id, { cursor }), id);
  const members = useAsync(() => communityMembers(sb(), id), [id, member], tab === "members" && member);
  const events = useAsync(() => listEvents(sb(), "upcoming", id), [id], tab === "events");
  const back = (
    <p>
      <Link href="/campus">← {t("campus.title")}</Link>
    </p>
  );
  if (c.loading && !d)
    return (
      <div className="stack-lg">
        {back}
        <Skeleton height={140} />
      </div>
    );
  if (c.error && !d)
    return (
      <div className="stack-lg">
        {back}
        <ErrorState title={t("campus.loadFailed")} {...(online ? {} : { description: t("campus.offline") })} action={<Button onClick={c.reload}>{t("common.retry")}</Button>} />
      </div>
    );
  if (!d)
    return (
      <div className="stack-lg">
        {back}
        <EmptyState title={t("campus.notFound")} />
      </div>
    );
  return (
    <div className="stack-lg">
      {back}
      <Card>
        <div className="stack">
          <h1 style={{ margin: 0 }}>{d.name}</h1>
          <div className="row">
            <Icon name="group" size={18} />
            <Badge tone="info">{t(`campus.communities.kind.${d.kind}`)}</Badge>
            <Badge>{t(d.visibility === "public" ? "campus.communities.visibilityPublic" : "campus.communities.visibilityPrivate")}</Badge>
            {d.my_role ? <Badge tone="success">{t(`campus.community.role.${d.my_role}`)}</Badge> : null}
            <span className="um-muted">{t("campus.communities.members", { n: d.member_count })}</span>
          </div>
          {d.my_status === "pending" ? <p className="um-muted">{t("campus.community.pendingNotice")}</p> : null}
          <div className="row">
            {!d.my_status ? (
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await joinCommunity(sb(), id);
                    c.reload();
                    feed.reload();
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t(d.visibility === "public" ? "campus.communities.join" : "campus.communities.requestJoin")}
              </Button>
            ) : null}
            {member && d.my_role !== "owner" ? (
              <Button variant="ghost" onClick={() => setConfirmLeave(true)}>
                {t("campus.communities.leave")}
              </Button>
            ) : null}
            {d.can_moderate ? (
              <Link className="um-btn um-btn--secondary" href={`/campus/moderation/${id}`}>
                {t("campus.community.moderate")}
                {d.pending_requests ? ` (${d.pending_requests})` : ""}
              </Link>
            ) : (
              <Button variant="ghost" onClick={() => setReport(true)}>
                {t("campus.safety.report")}
              </Button>
            )}
          </div>
        </div>
      </Card>
      <Chips label={t("campus.tabs.label")} value={tab} onChange={setTab} options={[{ value: "feed", label: t("campus.community.tabFeed") }, { value: "members", label: t("campus.community.tabMembers") }, { value: "events", label: t("campus.community.tabEvents") }, { value: "about", label: t("campus.community.tabAbout") }]} />

      {tab === "feed" ? (
        <div className="stack">
          {!member ? <p className="um-muted">{t("campus.community.joinToPost")}</p> : null}
          {feed.loading && feed.items.length === 0 ? (
            <Skeleton height={120} />
          ) : feed.error && feed.items.length === 0 ? (
            <ErrorState title={t("campus.loadFailed")} action={<Button onClick={feed.reload}>{t("common.retry")}</Button>} />
          ) : feed.items.length === 0 ? (
            <EmptyState title={t("campus.feed.empty")} />
          ) : (
            <>
              {feed.items.map((p) => (
                <PostCardView
                  key={p.id}
                  post={p}
                  onLike={async () => {
                    try {
                      const r = await react(sb(), "post", p.id, "like", !p.my_liked);
                      feed.patch(p.id, { like_count: Number(r.like_count), my_liked: r.my_like });
                    } catch (e) {
                      onError(e);
                    }
                  }}
                />
              ))}
              {feed.hasMore ? (
                <div className="row">
                  <Button variant="secondary" loading={feed.loading} onClick={feed.more}>
                    {t("campus.loadMore")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {tab === "members" ? (
        !member ? (
          <p className="um-muted">{t("campus.community.membersHidden")}</p>
        ) : members.loading && !members.data ? (
          <Skeleton height={80} />
        ) : (members.data ?? []).length === 0 ? (
          <EmptyState title={t("campus.community.noMembers")} />
        ) : (
          <ul className="list">
            {(members.data ?? []).map((m) => (
              <li key={m.user_id} className="list-item">
                <Link href={`/campus/user/${m.user_id}`}>{m.display_name ?? m.username ?? t("campus.post.anonymousAuthor")}</Link>
                {m.role !== "member" ? <Badge tone="info">{t(`campus.community.role.${m.role}`)}</Badge> : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "events" ? (
        events.loading && !events.data ? (
          <Skeleton height={80} />
        ) : events.error && !events.data ? (
          <ErrorState title={t("campus.loadFailed")} action={<Button onClick={events.reload}>{t("common.retry")}</Button>} />
        ) : (events.data ?? []).length === 0 ? (
          <EmptyState title={t("campus.events.empty")} />
        ) : (
          <div className="grid-auto">
            {(events.data ?? []).map((e) => (
              <EventCardView key={e.id} e={e} />
            ))}
          </div>
        )
      ) : null}

      {tab === "about" ? <AboutTab c={d} onSaved={c.reload} /> : null}

      <Dialog
        open={confirmLeave}
        title={t("campus.communities.leaveConfirm")}
        onClose={() => setConfirmLeave(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await leaveCommunity(sb(), id);
                  setConfirmLeave(false);
                  c.reload();
                  feed.reload();
                } catch (e) {
                  onError(e);
                }
              }}
            >
              {t("campus.communities.leave")}
            </Button>
          </>
        }
      />
      {report ? <ReportDialog target="community" id={id} onClose={() => setReport(false)} /> : null}
    </div>
  );
}
