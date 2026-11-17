import { CAMPUS_LIMITS, buildCommentTree, campusTextProblem, canReplyTo, type CommentNode, type PostCard, type ReportTarget } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Screen, ScreenHeader, Skeleton, useOnline, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { createComment, deleteComment, deletePost, editComment, editPost, getPost, modRemoveContent, postComments, react, setAcceptedAnswer } from "./api";
import { LanguageTag, ReportDialog, RichText, authorLabel, useCampusError } from "./parts";

interface Ctx {
  post: PostCard;
  isQuestion: boolean;
  onReply: (c: CommentNode) => void;
  onChanged: () => void;
  onReport: (target: ReportTarget, id: string) => void;
  onRemove: (kind: "post" | "comment", id: string) => void;
  onProfile: (id: string) => void;
}

function CommentView({ node, ctx }: { node: CommentNode; ctx: Ctx }) {
  const { t, dateTime } = useI18n();
  const { theme } = useTheme();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(node.body ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const author = authorLabel(t as (k: string) => string, { is_mine: node.is_mine, author_name: node.author_name, author_username: node.author_username });
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      ctx.onChanged();
    } catch (e) {
      onError(e);
    }
  };
  const canAccept = ctx.isQuestion && (ctx.post.is_mine || ctx.post.can_moderate) && !node.is_deleted;
  return (
    <View style={{ gap: 8, marginLeft: node.depth > 0 ? 14 : 0, borderLeftWidth: node.depth > 0 ? 2 : 0, borderLeftColor: theme.border, paddingLeft: node.depth > 0 ? 10 : 0 }}>
      <Card strong={node.is_accepted}>
        {node.is_deleted ? (
          <AppText muted>{t("campus.post.removedComment")}</AppText>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <AppText variant="label" accessibilityRole={node.author_id && !node.is_mine ? "link" : "text"} onPress={node.author_id && !node.is_mine ? () => ctx.onProfile(node.author_id!) : undefined}>
                {author}
              </AppText>
              <AppText variant="caption" muted>
                {dateTime(node.created_at)}
                {node.edited_at ? ` · ${t("campus.post.edited")}` : ""}
              </AppText>
              {node.is_accepted ? <Badge tone="success">{t("campus.post.accepted")}</Badge> : null}
              <LanguageTag language={node.language} />
            </View>
            {editing ? (
              <>
                <Input label={t("campus.post.edit")} value={text} onChangeText={setText} multiline maxLength={CAMPUS_LIMITS.comment} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button small title={t("campus.post.save")} disabled={!text.trim() || !!campusTextProblem(text)} onPress={() => void run(async () => { await editComment(sb, node.id, text.trim()); setEditing(false); })} />
                  <Button small variant="ghost" title={t("common.cancel")} onPress={() => setEditing(false)} />
                </View>
              </>
            ) : (
              <RichText text={node.body ?? ""} />
            )}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {!node.is_mine ? (
                <Button small variant={node.my_liked ? "primary" : "secondary"} title={`${node.my_liked ? t("campus.post.liked") : t("campus.post.like")} · ${node.like_count}`} accessibilityLabel={`${t("campus.post.like")}, ${t("campus.post.likes", { n: node.like_count })}`} onPress={() => void run(() => react(sb, "comment", node.id, "like", !node.my_liked))} />
              ) : null}
              {ctx.isQuestion && !node.is_mine ? (
                <Button small variant={node.my_helpful ? "primary" : "secondary"} title={`${t("campus.post.helpful")} · ${node.helpful_count}`} accessibilityLabel={`${t("campus.post.helpful")}, ${t("campus.post.helpfulCount", { n: node.helpful_count })}`} onPress={() => void run(() => react(sb, "comment", node.id, "helpful", !node.my_helpful))} />
              ) : null}
              {canReplyTo(node.depth) ? <Button small variant="ghost" title={t("campus.post.reply")} onPress={() => ctx.onReply(node)} /> : <AppText variant="caption" muted>{t("campus.post.replyLimit")}</AppText>}
              {canAccept ? (
                <Button small variant="ghost" title={node.is_accepted ? t("campus.post.unaccept") : t("campus.post.accept")} onPress={() => void run(() => setAcceptedAnswer(sb, ctx.post.id, node.is_accepted ? null : node.id))} />
              ) : null}
              {node.is_mine ? (
                <>
                  <Button small variant="ghost" title={t("campus.post.edit")} onPress={() => setEditing(true)} />
                  <Button small variant="ghost" title={t("campus.post.delete")} onPress={() => setConfirmDelete(true)} />
                </>
              ) : (
                <Button small variant="ghost" title={t("campus.safety.report")} onPress={() => ctx.onReport("comment", node.id)} />
              )}
              {ctx.post.can_moderate && !node.is_mine ? <Button small variant="ghost" title={t("campus.post.removeAsMod")} onPress={() => ctx.onRemove("comment", node.id)} /> : null}
            </View>
          </>
        )}
      </Card>
      <Dialog
        open={confirmDelete}
        title={t("campus.post.deleteConfirm")}
        onClose={() => setConfirmDelete(false)}
        actions={
          <>
            <Button title={t("campus.post.delete")} variant="danger" onPress={() => void run(async () => { await deleteComment(sb, node.id); setConfirmDelete(false); toast(t("campus.moderation.removed"), "success"); })} />
            <Button title={t("common.cancel")} variant="ghost" onPress={() => setConfirmDelete(false)} />
          </>
        }
      >
        <View />
      </Dialog>
      {node.children.map((c) => (
        <CommentView key={c.id} node={c} ctx={ctx} />
      ))}
    </View>
  );
}

export function PostDetailScreen({ id }: { id: string }) {
  const { t, dateTime } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const { theme } = useTheme();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const post = useAsync(() => getPost(sb, id), [sb, id]);
  const comments = useAsync(() => postComments(sb, id), [sb, id]);
  const [replyTo, setReplyTo] = useState<CommentNode | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ target: ReportTarget; id: string } | null>(null);
  const [removal, setRemoval] = useState<{ kind: "post" | "comment"; id: string } | null>(null);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const p = post.data;
  const back = () => router.back();
  const reload = () => {
    post.reload();
    comments.reload();
  };

  if (post.loading && !p) return (
    <Screen>
      <ScreenHeader title={t("campus.title")} onBack={back} />
      <Skeleton height={160} />
    </Screen>
  );
  if (post.error && !p) return (
    <Screen>
      <ScreenHeader title={t("campus.title")} onBack={back} />
      <ErrorState title={t("campus.loadFailed")} description={online ? undefined : t("campus.offline")} action={<Button title={t("common.retry")} onPress={reload} />} />
    </Screen>
  );
  if (!p) return (
    <Screen>
      <ScreenHeader title={t("campus.title")} onBack={back} />
      <EmptyState title={t("campus.notFound")} />
    </Screen>
  );
  const isQuestion = p.kind === "question";
  const tree = buildCommentTree(comments.data ?? []);
  const ctx: Ctx = { post: p, isQuestion, onReply: setReplyTo, onChanged: reload, onReport: (target, rid) => setReport({ target, id: rid }), onRemove: (kind, rid) => setRemoval({ kind, id: rid }), onProfile: (uid) => router.push(`/campus/user/${uid}`) };
  const bad = campusTextProblem(text);
  const author = authorLabel(t as (k: string) => string, p);
  async function send() {
    setBusy(true);
    try {
      await createComment(sb, id, text.trim(), replyTo?.id ?? null);
      setText("");
      setReplyTo(null);
      reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <ScreenHeader title={p.community_name} onBack={back} />
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Icon name={isQuestion ? "comment" : "post"} size="sm" color={theme.active} />
          <AppText variant="label" accessibilityRole={p.author_id && !p.is_mine ? "link" : "text"} onPress={p.author_id && !p.is_mine ? () => router.push(`/campus/user/${p.author_id}`) : undefined}>
            {author}
          </AppText>
          <AppText variant="caption" muted>
            {dateTime(p.created_at)}
            {p.edited_at ? ` · ${t("campus.post.edited")}` : ""}
          </AppText>
        </View>
        {editing ? (
          <>
            <Input label={t("campus.composer.title")} value={title} onChangeText={setTitle} maxLength={CAMPUS_LIMITS.title} />
            <Input label={t("campus.composer.body")} value={body} onChangeText={setBody} multiline maxLength={CAMPUS_LIMITS.body} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Button small title={t("campus.post.save")} disabled={!title.trim() || !!campusTextProblem(title + body)} onPress={async () => { try { await editPost(sb, id, title.trim(), body.trim()); setEditing(false); post.reload(); } catch (e) { onError(e); } }} />
              <Button small variant="ghost" title={t("common.cancel")} onPress={() => setEditing(false)} />
            </View>
          </>
        ) : (
          <>
            <AppText variant="title" accessibilityRole="header">
              {p.title}
            </AppText>
            {p.body ? <RichText text={p.body} /> : null}
          </>
        )}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {isQuestion ? <Badge tone="info">{t("campus.post.question")}</Badge> : null}
          {p.accepted_comment_id ? <Badge tone="success">{t("campus.post.accepted")}</Badge> : null}
          <LanguageTag language={p.language} />
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {!p.is_mine ? (
            <Button small variant={p.my_liked ? "primary" : "secondary"} title={`${p.my_liked ? t("campus.post.liked") : t("campus.post.like")} · ${p.like_count}`} accessibilityLabel={`${t("campus.post.like")}, ${t("campus.post.likes", { n: p.like_count })}`} onPress={async () => { if (p.is_mine) { toast(t("campus.post.ownLike")); return; } try { await react(sb, "post", id, "like", !p.my_liked); post.reload(); } catch (e) { onError(e); } }} />
          ) : null}
          {p.is_mine ? (
            <>
              <Button small variant="ghost" title={t("campus.post.edit")} onPress={() => { setTitle(p.title); setBody(p.body); setEditing(true); }} />
              <Button small variant="ghost" title={t("campus.post.delete")} onPress={() => setConfirmDelete(true)} />
            </>
          ) : (
            <Button small variant="ghost" title={t("campus.safety.report")} onPress={() => setReport({ target: "post", id })} />
          )}
          {p.can_moderate && !p.is_mine ? <Button small variant="ghost" title={t("campus.post.removeAsMod")} onPress={() => setRemoval({ kind: "post", id })} /> : null}
        </View>
      </Card>

      <AppText variant="heading">{t(isQuestion ? "campus.post.answers" : "campus.post.comments", { n: p.comment_count })}</AppText>
      {replyTo ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <AppText variant="caption" muted style={{ flex: 1 }} numberOfLines={1}>
            {t("campus.post.reply")}: {replyTo.author_name ?? replyTo.author_username ?? t("campus.post.anonymousAuthor")}
          </AppText>
          <Button small variant="ghost" title={t("common.cancel")} onPress={() => setReplyTo(null)} />
        </View>
      ) : null}
      <Input label={t(isQuestion ? "campus.post.writeAnswer" : "campus.post.writeComment")} value={text} onChangeText={setText} multiline maxLength={CAMPUS_LIMITS.comment} error={bad ? t("campus.errors.invalidText") : undefined} />
      <Button title={t("campus.post.send")} loading={busy} disabled={!text.trim() || !!bad} onPress={() => void send()} />
      {!online ? <AppText variant="caption" muted>{t("campus.offline")}</AppText> : null}
      {comments.loading && !comments.data ? (
        <Skeleton height={80} />
      ) : comments.error && !comments.data ? (
        <ErrorState title={t("campus.loadFailed")} action={<Button title={t("common.retry")} onPress={comments.reload} />} />
      ) : tree.length === 0 ? (
        <EmptyState title={t("campus.post.noComments")} />
      ) : (
        <View style={{ gap: 10 }}>
          {tree.map((n) => (
            <CommentView key={n.id} node={n} ctx={ctx} />
          ))}
        </View>
      )}

      {report ? <ReportDialog target={report.target} id={report.id} onClose={() => setReport(null)} /> : null}
      <Dialog
        open={!!removal}
        title={t("campus.post.removeAsMod")}
        onClose={() => setRemoval(null)}
        actions={
          <>
            <Button
              title={t("campus.moderation.remove")}
              variant="danger"
              disabled={reason.trim().length < 3}
              onPress={async () => {
                try {
                  await modRemoveContent(sb, removal!.kind, removal!.id, reason.trim());
                  toast(t("campus.moderation.removed"), "success");
                  const wasPost = removal!.kind === "post";
                  setRemoval(null);
                  setReason("");
                  if (wasPost) back();
                  else reload();
                } catch (e) {
                  onError(e);
                }
              }}
            />
            <Button title={t("common.cancel")} variant="ghost" onPress={() => setRemoval(null)} />
          </>
        }
      >
        <Input label={t("campus.post.removeReason")} value={reason} onChangeText={setReason} maxLength={500} />
      </Dialog>
      <Dialog
        open={confirmDelete}
        title={t("campus.post.deleteConfirm")}
        onClose={() => setConfirmDelete(false)}
        actions={
          <>
            <Button title={t("campus.post.delete")} variant="danger" onPress={async () => { try { await deletePost(sb, id); setConfirmDelete(false); back(); } catch (e) { onError(e); } }} />
            <Button title={t("common.cancel")} variant="ghost" onPress={() => setConfirmDelete(false)} />
          </>
        }
      >
        <View />
      </Dialog>
    </Screen>
  );
}
