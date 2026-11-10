import { CAMPUS_LANGUAGES, REPORT_CATEGORIES, linkify, type CampusLanguage, type CommunityListItem, type EventRow, type PostCard, type ReportCategory, type ReportTarget } from "@unimate/core";
import { LOCALE_NAMES } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { Linking, View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Button, Card, Dialog, Input, useToast, PressableScale } from "../../components/ui";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { CampusApiError, blockUser, reportContent } from "./api";

/** Toasts a translated message for any error thrown by the campus API (server messages are never shown raw). */
export function useCampusError() {
  const { t } = useI18n();
  const { toast } = useToast();
  return (e: unknown) => toast(t(`campus.errors.${e instanceof CampusApiError ? e.key : "generic"}`), "error");
}

/** Single-choice wrapping chip group. */
export function Chips<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: string }> }) {
  const { theme } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <PressableScale
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 22, borderWidth: 1, borderColor: on ? theme.active : theme.border, backgroundColor: on ? theme.primarySoft : "transparent" }}
          >
            <AppText variant="label" style={{ color: on ? theme.active : theme.text }}>
              {o.label}
            </AppText>
          </PressableScale>
        );
      })}
    </View>
  );
}

export const languageOptions = (noneLabel: string): Array<{ value: CampusLanguage | ""; label: string }> => [{ value: "", label: noneLabel }, ...CAMPUS_LANGUAGES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))];

/** Text with https links made tappable; nothing else is interpreted (no HTML, no markdown). */
export function RichText({ text, variant = "body" }: { text: string; variant?: "body" | "caption" }) {
  const { theme } = useTheme();
  return (
    <AppText variant={variant}>
      {linkify(text).map((p, i) =>
        p.href ? (
          <AppText key={i} variant={variant} accessibilityRole="link" style={{ color: theme.active, textDecorationLine: "underline" }} onPress={() => void Linking.openURL(p.href!)}>
            {p.text}
          </AppText>
        ) : (
          p.text
        ),
      )}
    </AppText>
  );
}

export function LanguageTag({ language }: { language: CampusLanguage | null }) {
  return language ? <Badge tone="neutral">{LOCALE_NAMES[language]}</Badge> : null;
}

/** Author label; anonymous posts never show a name. */
export function authorLabel(t: (k: string) => string, p: { is_anonymous?: boolean; is_mine: boolean; author_name: string | null; author_username: string | null }): string {
  if (p.is_anonymous) return p.is_mine ? `${t("campus.post.anonymousAuthor")} (${t("campus.post.you")})` : t("campus.post.anonymousAuthor");
  return p.is_mine ? t("campus.post.you") : (p.author_name ?? p.author_username ?? t("campus.post.anonymousAuthor"));
}

export function PostCardView({ post, onOpen, onLike, onAuthor }: { post: PostCard; onOpen: () => void; onLike: () => void; onAuthor?: (() => void) | undefined }) {
  const { t, dateTime } = useI18n();
  const { theme } = useTheme();
  const author = authorLabel(t as (k: string) => string, post);
  const canOpenAuthor = !!onAuthor && !!post.author_id && !post.is_mine;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name={post.kind === "question" ? "comment" : "post"} size="sm" color={theme.active} />
        <PressableScale disabled={!canOpenAuthor} onPress={onAuthor} accessibilityRole={canOpenAuthor ? "link" : "text"} hitSlop={6}>
          <AppText variant="label">{author}</AppText>
        </PressableScale>
        <AppText variant="caption" muted>
          · {post.community_name} · {dateTime(post.created_at)}
        </AppText>
      </View>
      <PressableScale onPress={onOpen} accessibilityRole="button" accessibilityLabel={post.title}>
        <AppText variant="heading">{post.title}</AppText>
        {post.body ? (
          <AppText muted numberOfLines={4}>
            {post.body}
          </AppText>
        ) : null}
      </PressableScale>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {post.kind === "question" ? <Badge tone="info">{t("campus.post.question")}</Badge> : null}
        {post.accepted_comment_id ? <Badge tone="success">{t("campus.post.accepted")}</Badge> : null}
        <LanguageTag language={post.language} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <PressableScale onPress={onLike} disabled={post.is_mine} accessibilityRole="button" accessibilityState={{ selected: post.my_liked, disabled: post.is_mine }} accessibilityLabel={`${post.my_liked ? t("campus.post.liked") : t("campus.post.like")}, ${t("campus.post.likes", { n: post.like_count })}`} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 }}>
          <Icon name="reaction" size="sm" color={post.my_liked ? theme.danger : theme.textMuted} />
          <AppText variant="caption" muted>
            {post.like_count}
          </AppText>
        </PressableScale>
        <PressableScale onPress={onOpen} accessibilityRole="button" accessibilityLabel={t(post.kind === "question" ? "campus.post.answers" : "campus.post.comments", { n: post.comment_count })} style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 }}>
          <Icon name="comment" size="sm" color={theme.textMuted} />
          <AppText variant="caption" muted>
            {post.comment_count}
          </AppText>
        </PressableScale>
      </View>
    </Card>
  );
}

export function CommunityCardView({ c, onOpen }: { c: CommunityListItem; onOpen: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  return (
    <PressableScale onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${c.name}, ${t(`campus.communities.kind.${c.kind}`)}, ${t("campus.communities.members", { n: c.member_count })}`}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Icon name="group" size="sm" color={theme.active} />
          <Badge tone="info">{t(`campus.communities.kind.${c.kind}`)}</Badge>
          <Badge tone="neutral">{t(c.visibility === "public" ? "campus.communities.visibilityPublic" : "campus.communities.visibilityPrivate")}</Badge>
          {c.my_status === "active" ? <Badge tone="success">{t("campus.communities.joined")}</Badge> : null}
          {c.my_status === "pending" ? <Badge tone="warning">{t("campus.communities.requested")}</Badge> : null}
        </View>
        <AppText variant="heading">{c.name}</AppText>
        {c.description ? (
          <AppText muted numberOfLines={2}>
            {c.description}
          </AppText>
        ) : null}
        <AppText variant="caption" muted>
          {t("campus.communities.members", { n: c.member_count })}
        </AppText>
      </Card>
    </PressableScale>
  );
}

export function EventCardView({ e, onOpen }: { e: EventRow; onOpen: () => void }) {
  const { t, dateTime } = useI18n();
  const { theme } = useTheme();
  return (
    <PressableScale onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${e.title}, ${dateTime(e.starts_at)}`}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Icon name="event" size="sm" color={theme.active} />
          <AppText variant="label">{dateTime(e.starts_at)}</AppText>
          {e.status === "pending" ? <Badge tone="warning">{t("campus.events.pendingReview")}</Badge> : null}
          {e.my_rsvp ? <Badge tone="success">{t(e.my_rsvp === "going" ? "campus.events.rsvpGoing" : "campus.events.rsvpInterested")}</Badge> : null}
        </View>
        <AppText variant="heading">{e.title}</AppText>
        {e.location ? (
          <AppText muted numberOfLines={1}>
            {e.location}
          </AppText>
        ) : null}
        <AppText variant="caption" muted>
          {[e.community_name, t("campus.events.goingCount", { n: e.going_count }), e.capacity != null && e.going_count >= e.capacity ? t("campus.events.full") : null].filter(Boolean).join(" · ")}
        </AppText>
      </Card>
    </PressableScale>
  );
}

/** Report sheet: category + optional details; the server allows one open report per reporter and target. */
export function ReportDialog({ target, id, onClose }: { target: ReportTarget; id: string; onClose: (sent: boolean) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const [category, setCategory] = useState<ReportCategory>("spam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try {
      await reportContent(sb, target, id, category, details);
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
          <Button title={t("campus.safety.reportSend")} loading={busy} onPress={() => void send()} />
          <Button title={t("common.cancel")} variant="ghost" onPress={() => onClose(false)} />
        </>
      }
    >
      <Chips label={t("campus.safety.reportCategory")} value={category} onChange={setCategory} options={REPORT_CATEGORIES.map((c) => ({ value: c, label: t(`campus.safety.category.${c}`) }))} />
      <Input label={t("campus.safety.reportDetails")} value={details} onChangeText={setDetails} multiline maxLength={2000} />
    </Dialog>
  );
}

export function BlockDialog({ user, onClose }: { user: string; onClose: (blocked: boolean) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await blockUser(sb, user, true);
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
          <Button title={t("campus.safety.block")} variant="danger" loading={busy} onPress={() => void go()} />
          <Button title={t("common.cancel")} variant="ghost" onPress={() => onClose(false)} />
        </>
      }
    >
      <AppText>{t("campus.safety.blockBody")}</AppText>
    </Dialog>
  );
}
