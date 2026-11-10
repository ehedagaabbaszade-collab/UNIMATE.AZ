"use client";

import { CAMPUS_LANGUAGES, REPORT_CATEGORIES, linkify, type CampusLanguage, type CommunityListItem, type EventRow, type PostCard, type ReportCategory, type ReportTarget } from "@unimate/core";
import { LOCALE_NAMES } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, Icon, Textarea, useToast } from "@unimate/ui";
import Link from "next/link";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { CampusApiError, blockUser, reportContent } from "./api";

/** Toasts a translated message for any error thrown by the campus API (server messages are never shown raw). */
export function useCampusError() {
  const { t } = useI18n();
  const { toast } = useToast();
  return (e: unknown) => toast(t(`campus.errors.${e instanceof CampusApiError ? e.key : "generic"}`), "error");
}

/** Single-choice chip group (keyboard accessible buttons with aria-pressed). */
export function Chips<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: string }> }) {
  return (
    <div role="group" aria-label={label} className="row" style={{ gap: 8 }}>
      {options.map((o) => (
        <button key={o.value} type="button" className="cite-chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const languageOptions = (noneLabel: string): Array<{ value: CampusLanguage | ""; label: string }> => [{ value: "", label: noneLabel }, ...CAMPUS_LANGUAGES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))];

/** Text with https links made clickable; nothing else is interpreted (no HTML, no markdown). React escapes the rest. */
export function RichText({ text }: { text: string }) {
  return (
    <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {linkify(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow ugc">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

export function LanguageTag({ language }: { language: CampusLanguage | null }) {
  return language ? <Badge>{LOCALE_NAMES[language]}</Badge> : null;
}

/** Author label; anonymous posts never show a name. */
export function authorLabel(t: (k: string) => string, p: { is_anonymous?: boolean; is_mine: boolean; author_name: string | null; author_username: string | null }): string {
  if (p.is_anonymous) return p.is_mine ? `${t("campus.post.anonymousAuthor")} (${t("campus.post.you")})` : t("campus.post.anonymousAuthor");
  return p.is_mine ? t("campus.post.you") : (p.author_name ?? p.author_username ?? t("campus.post.anonymousAuthor"));
}

export function PostCardView({ post, onLike }: { post: PostCard; onLike: () => void }) {
  const { t, dateTime } = useI18n();
  const author = authorLabel(t as (k: string) => string, post);
  return (
    <Card>
      <div className="stack">
        <div className="row">
          <Icon name={post.kind === "question" ? "comment" : "post"} size={18} />
          {post.author_id && !post.is_mine ? <Link href={`/campus/user/${post.author_id}`}>{author}</Link> : <strong>{author}</strong>}
          <span className="um-muted">
            · <Link href={`/campus/community/${post.community_id}`}>{post.community_name}</Link> · {dateTime(post.created_at)}
          </span>
        </div>
        <h3 style={{ margin: 0 }}>
          <Link href={`/campus/post/${post.id}`}>{post.title}</Link>
        </h3>
        {post.body ? (
          <p className="um-muted" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {post.body}
          </p>
        ) : null}
        <div className="row">
          {post.kind === "question" ? <Badge tone="info">{t("campus.post.question")}</Badge> : null}
          {post.accepted_comment_id ? <Badge tone="success">{t("campus.post.accepted")}</Badge> : null}
          <LanguageTag language={post.language} />
        </div>
        <div className="row">
          <Button variant={post.my_liked ? "primary" : "secondary"} size="sm" disabled={post.is_mine} aria-pressed={post.my_liked} aria-label={`${post.my_liked ? t("campus.post.liked") : t("campus.post.like")}, ${t("campus.post.likes", { n: post.like_count })}`} onClick={onLike}>
            <Icon name="reaction" size={16} /> {post.like_count}
          </Button>
          <Link className="um-btn um-btn--ghost um-btn--sm" href={`/campus/post/${post.id}`} aria-label={t(post.kind === "question" ? "campus.post.answers" : "campus.post.comments", { n: post.comment_count })}>
            <Icon name="comment" size={16} /> {post.comment_count}
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function CommunityCardView({ c }: { c: CommunityListItem }) {
  const { t } = useI18n();
  return (
    <Card>
      <div className="stack">
        <div className="row">
          <Icon name="group" size={18} />
          <Badge tone="info">{t(`campus.communities.kind.${c.kind}`)}</Badge>
          <Badge>{t(c.visibility === "public" ? "campus.communities.visibilityPublic" : "campus.communities.visibilityPrivate")}</Badge>
          {c.my_status === "active" ? <Badge tone="success">{t("campus.communities.joined")}</Badge> : null}
          {c.my_status === "pending" ? <Badge tone="warning">{t("campus.communities.requested")}</Badge> : null}
        </div>
        <h3 style={{ margin: 0 }}>
          <Link href={`/campus/community/${c.id}`}>{c.name}</Link>
        </h3>
        {c.description ? <p className="um-muted">{c.description}</p> : null}
        <p className="um-muted">{t("campus.communities.members", { n: c.member_count })}</p>
      </div>
    </Card>
  );
}

export function EventCardView({ e }: { e: EventRow }) {
  const { t, dateTime } = useI18n();
  return (
    <Card>
      <div className="stack">
        <div className="row">
          <Icon name="event" size={18} />
          <strong>{dateTime(e.starts_at)}</strong>
          {e.status === "pending" ? <Badge tone="warning">{t("campus.events.pendingReview")}</Badge> : null}
          {e.my_rsvp ? <Badge tone="success">{t(e.my_rsvp === "going" ? "campus.events.rsvpGoing" : "campus.events.rsvpInterested")}</Badge> : null}
        </div>
        <h3 style={{ margin: 0 }}>
          <Link href={`/campus/event/${e.id}`}>{e.title}</Link>
        </h3>
        {e.location ? <p className="um-muted">{e.location}</p> : null}
        <p className="um-muted">{[e.community_name, t("campus.events.goingCount", { n: e.going_count }), e.capacity != null && e.going_count >= e.capacity ? t("campus.events.full") : null].filter(Boolean).join(" · ")}</p>
      </div>
    </Card>
  );
}

/** Report sheet: category + optional details; the server allows one open report per reporter and target. */
export function ReportDialog({ target, id, onClose }: { target: ReportTarget; id: string; onClose: (sent: boolean) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const [category, setCategory] = useState<ReportCategory>("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await reportContent(getBrowserClient(), target, id, category, details);
      toast(t("campus.safety.reportSent"), "success");
      onClose(true);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`${t("campus.safety.reportTitle")}: ${t(`campus.safety.target.${target}`)}`}
      onClose={() => onClose(false)}
      actions={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={() => void send()}>
            {t("campus.safety.reportSend")}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Chips label={t("campus.safety.reportCategory")} value={category} onChange={setCategory} options={REPORT_CATEGORIES.map((c) => ({ value: c, label: t(`campus.safety.category.${c}`) }))} />
        <Textarea label={t("campus.safety.reportDetails")} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} />
      </div>
    </Dialog>
  );
}

export function BlockDialog({ user, onClose }: { user: string; onClose: (blocked: boolean) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await blockUser(getBrowserClient(), user, true);
      toast(t("campus.safety.blocked"), "success");
      onClose(true);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={t("campus.safety.blockTitle")}
      onClose={() => onClose(false)}
      actions={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void go()}>
            {t("campus.safety.block")}
          </Button>
        </>
      }
    >
      <p>{t("campus.safety.blockBody")}</p>
    </Dialog>
  );
}
