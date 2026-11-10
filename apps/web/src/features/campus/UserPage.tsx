"use client";

import { useI18n } from "@unimate/i18n/react";
import { Button, Card, EmptyState, ErrorState, Skeleton, useOnlineStatus } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { blockUser, blockedUsers, campusProfile, followUser, react, setDiscoverable, userPosts } from "./api";
import { usePagedPosts } from "./hooks";
import { BlockDialog, Chips, PostCardView, ReportDialog, useCampusError } from "./parts";

const sb = () => getBrowserClient();

function SelfPrivacy({ discoverable, onChanged }: { discoverable: boolean; onChanged: () => void }) {
  const { t } = useI18n();
  const onError = useCampusError();
  return (
    <div className="stack">
      <strong>{t("campus.profile.discoverable")}</strong>
      <Chips
        label={t("campus.profile.discoverable")}
        value={discoverable ? "on" : "off"}
        onChange={async (v) => {
          try {
            await setDiscoverable(sb(), v === "on");
            onChanged();
          } catch (e) {
            onError(e);
          }
        }}
        options={[{ value: "on", label: t("campus.profile.discoverableOn") }, { value: "off", label: t("campus.profile.discoverableOff") }]}
      />
      <p className="um-muted">{t("campus.profile.discoverableHint")}</p>
    </div>
  );
}

function BlockedList() {
  const { t } = useI18n();
  const onError = useCampusError();
  const list = useAsync(() => blockedUsers(sb()), []);
  return (
    <Card>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{t("campus.profile.blockedList")}</h2>
        {(list.data ?? []).length === 0 ? (
          <p className="um-muted">{t("campus.profile.noBlocked")}</p>
        ) : (
          <ul className="list">
            {(list.data ?? []).map((u) => (
              <li key={u.user_id} className="list-item">
                <span>{u.display_name ?? u.username ?? t("campus.post.anonymousAuthor")}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await blockUser(sb(), u.user_id, false);
                      list.reload();
                    } catch (e) {
                      onError(e);
                    }
                  }}
                >
                  {t("campus.safety.unblock")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function UserPage({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnlineStatus();
  const onError = useCampusError();
  const prof = useAsync(() => campusProfile(sb(), id), [id]);
  const feed = usePagedPosts((cursor) => userPosts(sb(), id, { cursor }), id);
  const [report, setReport] = useState(false);
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const p = prof.data;
  const back = (
    <p>
      <Link href="/campus">← {t("campus.title")}</Link>
    </p>
  );
  if (prof.loading && p === undefined)
    return (
      <div className="stack-lg">
        {back}
        <Skeleton height={140} />
      </div>
    );
  if (prof.error && p === undefined)
    return (
      <div className="stack-lg">
        {back}
        <ErrorState title={t("campus.loadFailed")} {...(online ? {} : { description: t("campus.offline") })} action={<Button onClick={prof.reload}>{t("common.retry")}</Button>} />
      </div>
    );
  if (!p)
    return (
      <div className="stack-lg">
        {back}
        <EmptyState title={t("campus.profile.unavailable")} />
      </div>
    );
  const name = p.display_name ?? p.username ?? t("campus.post.anonymousAuthor");
  const visible = p.follower_count != null;
  return (
    <div className="stack-lg">
      {back}
      <Card>
        <div className="stack">
          <h1 style={{ margin: 0 }}>{name}</h1>
          {p.username ? <p className="um-muted">@{p.username}</p> : null}
          {p.university_name ? (
            <p className="um-muted">
              {t("campus.profile.university")}: {p.university_name}
            </p>
          ) : null}
          {visible ? (
            <>
              <p className={p.bio ? undefined : "um-muted"} style={{ whiteSpace: "pre-wrap" }}>
                {p.bio ?? t("campus.profile.noBio")}
              </p>
              <p className="um-muted">{[t("campus.profile.followers", { n: p.follower_count ?? 0 }), t("campus.profile.following", { n: p.following_count ?? 0 }), t("campus.profile.posts", { n: p.post_count ?? 0 })].join(" · ")}</p>
            </>
          ) : (
            <p className="um-muted">{t("campus.profile.privateProfile")}</p>
          )}
          {!p.is_self ? (
            <div className="row">
              <Button
                variant={p.is_following ? "secondary" : "primary"}
                aria-pressed={p.is_following}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await followUser(sb(), id, !p.is_following);
                    prof.reload();
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {p.is_following ? t("campus.profile.unfollow") : t("campus.profile.follow")}
              </Button>
              <Button variant="ghost" onClick={() => setReport(true)}>
                {t("campus.safety.report")}
              </Button>
              <Button variant="ghost" onClick={() => setBlock(true)}>
                {t("campus.safety.block")}
              </Button>
            </div>
          ) : (
            <SelfPrivacy discoverable={p.discoverable} onChanged={prof.reload} />
          )}
        </div>
      </Card>
      {visible ? (
        feed.loading && feed.items.length === 0 ? (
          <Skeleton height={120} />
        ) : feed.error && feed.items.length === 0 ? (
          <ErrorState title={t("campus.loadFailed")} action={<Button onClick={feed.reload}>{t("common.retry")}</Button>} />
        ) : feed.items.length === 0 ? (
          <EmptyState title={t("campus.feed.userEmpty")} />
        ) : (
          <div className="stack">
            {feed.items.map((post) => (
              <PostCardView
                key={post.id}
                post={post}
                onLike={async () => {
                  try {
                    const r = await react(sb(), "post", post.id, "like", !post.my_liked);
                    feed.patch(post.id, { like_count: Number(r.like_count), my_liked: r.my_like });
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
          </div>
        )
      ) : null}
      {p.is_self ? <BlockedList /> : null}
      {report ? <ReportDialog target="user" id={id} onClose={() => setReport(false)} /> : null}
      {block ? (
        <BlockDialog
          user={id}
          onClose={(blocked) => {
            setBlock(false);
            if (blocked) router.push("/campus");
          }}
        />
      ) : null}
    </div>
  );
}
