"use client";

import { CAMPUS_LIMITS, buildCommentTree, campusTextProblem, canReplyTo, type CommentNode, type PostCard, type ReportTarget } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Icon, Input, Skeleton, Textarea, useOnlineStatus, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { createComment, deleteComment, deletePost, editComment, editPost, getPost, modRemoveContent, postComments, react, setAcceptedAnswer } from "./api";
import { LanguageTag, ReportDialog, RichText, authorLabel, useCampusError } from "./parts";

const sb = () => getBrowserClient();

interface Ctx {
  post: PostCard;
  isQuestion: boolean;
  onReply: (c: CommentNode) => void;
  onChanged: () => void;
  onReport: (target: ReportTarget, id: string) => void;
  onRemove: (kind: "post" | "comment", id: string) => void;
}

function CommentView({ node, ctx }: { node: CommentNode; ctx: Ctx }) {
  const { t, dateTime } = useI18n();
  const onError = useCampusError();
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
    <li style={{ listStyle: "none", marginLeft: node.depth > 0 ? 16 : 0, paddingLeft: node.depth > 0 ? 12 : 0, borderLeft: node.depth > 0 ? "2px solid var(--border)" : undefined }}>
      <div className="stack">
        <Card>
          {node.is_deleted ? (
            <p className="um-muted">{t("campus.post.removedComment")}</p>
          ) : (
            <div className="stack">
              <div className="row">
                {node.author_id && !node.is_mine ? <Link href={`/campus/user/${node.author_id}`}>{author}</Link> : <strong>{author}</strong>}
                <span className="um-muted">
                  {dateTime(node.created_at)}
                  {node.edited_at ? ` · ${t("campus.post.edited")}` : ""}
                </span>
                {node.is_accepted ? <Badge tone="success">{t("campus.post.accepted")}</Badge> : null}
                <LanguageTag language={node.language} />
              </div>
              {editing ? (
                <>
                  <Textarea label={t("campus.post.edit")} value={text} onChange={(e) => setText(e.target.value)} maxLength={CAMPUS_LIMITS.comment} />
                  <div className="row">
                    <Button size="sm" disabled={!text.trim() || !!campusTextProblem(text)} onClick={() => void run(async () => { await editComment(sb(), node.id, text.trim()); setEditing(false); })}>
                      {t("campus.post.save")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                </>
              ) : (
                <RichText text={node.body ?? ""} />
              )}
              <div className="row">
                {!node.is_mine ? (
                  <Button size="sm" variant={node.my_liked ? "primary" : "secondary"} aria-pressed={node.my_liked} aria-label={`${t("campus.post.like")}, ${t("campus.post.likes", { n: node.like_count })}`} onClick={() => void run(() => react(sb(), "comment", node.id, "like", !node.my_liked))}>
                    <Icon name="reaction" size={14} /> {node.like_count}
                  </Button>
                ) : null}
                {ctx.isQuestion && !node.is_mine ? (
                  <Button size="sm" variant={node.my_helpful ? "primary" : "secondary"} aria-pressed={node.my_helpful} aria-label={`${t("campus.post.helpful")}, ${t("campus.post.helpfulCount", { n: node.helpful_count })}`} onClick={() => void run(() => react(sb(), "comment", node.id, "helpful", !node.my_helpful))}>
                    {t("campus.post.helpful")} · {node.helpful_count}
                  </Button>
                ) : null}
                {canReplyTo(node.depth) ? (
                  <Button size="sm" variant="ghost" onClick={() => ctx.onReply(node)}>
                    {t("campus.post.reply")}
                  </Button>
                ) : (
                  <span className="um-muted">{t("campus.post.replyLimit")}</span>
                )}
                {canAccept ? (
                  <Button size="sm" variant="ghost" onClick={() => void run(() => setAcceptedAnswer(sb(), ctx.post.id, node.is_accepted ? null : node.id))}>
                    {node.is_accepted ? t("campus.post.unaccept") : t("campus.post.accept")}
                  </Button>
                ) : null}
                {node.is_mine ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                      {t("campus.post.edit")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                      {t("campus.post.delete")}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => ctx.onReport("comment", node.id)}>
                    {t("campus.safety.report")}
                  </Button>
                )}
                {ctx.post.can_moderate && !node.is_mine ? (
                  <Button size="sm" variant="ghost" onClick={() => ctx.onRemove("comment", node.id)}>
                    {t("campus.post.removeAsMod")}
                  </Button>
                ) : null}
              </div>
            </div>
          )}
        </Card>
        {node.children.length ? (
          <ul className="stack" style={{ margin: 0, padding: 0 }}>
            {node.children.map((c) => (
              <CommentView key={c.id} node={c} ctx={ctx} />
            ))}
          </ul>
        ) : null}
      </div>
      <Dialog
        open={confirmDelete}
        title={t("campus.post.deleteConfirm")}
        onClose={() => setConfirmDelete(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void run(async () => { await deleteComment(sb(), node.id); setConfirmDelete(false); })}>
              {t("campus.post.delete")}
            </Button>
          </>
        }
      />
    </li>
  );
}

export function PostDetail({ id }: { id: string }) {
  const { t, dateTime } = useI18n();
  const router = useRouter();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const onError = useCampusError();
  const post = useAsync(() => getPost(sb(), id), [id]);
  const comments = useAsync(() => postComments(sb(), id), [id]);
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
  const reload = () => {
    post.reload();
    comments.reload();
  };
  const back = (
    <p>
      <Link href="/campus">← {t("campus.title")}</Link>
    </p>
  );
  if (post.loading && !p)
    return (
      <div className="stack-lg">
        {back}
        <Skeleton height={180} />
      </div>
    );
  if (post.error && !p)
    return (
      <div className="stack-lg">
        {back}
        <ErrorState title={t("campus.loadFailed")} {...(online ? {} : { description: t("campus.offline") })} action={<Button onClick={reload}>{t("common.retry")}</Button>} />
      </div>
    );
  if (!p)
    return (
      <div className="stack-lg">
        {back}
        <EmptyState title={t("campus.notFound")} />
      </div>
    );
  const isQuestion = p.kind === "question";
  const tree = buildCommentTree(comments.data ?? []);
  const ctx: Ctx = { post: p, isQuestion, onReply: setReplyTo, onChanged: reload, onReport: (target, rid) => setReport({ target, id: rid }), onRemove: (kind, rid) => setRemoval({ kind, id: rid }) };
  const bad = campusTextProblem(text);
  const author = authorLabel(t as (k: string) => string, p);
  return (
    <div className="stack-lg">
      {back}
      <Card>
        <div className="stack">
          <div className="row">
            <Icon name={isQuestion ? "comment" : "post"} size={18} />
            {p.author_id && !p.is_mine ? <Link href={`/campus/user/${p.author_id}`}>{author}</Link> : <strong>{author}</strong>}
            <span className="um-muted">
              · <Link href={`/campus/community/${p.community_id}`}>{p.community_name}</Link> · {dateTime(p.created_at)}
              {p.edited_at ? ` · ${t("campus.post.edited")}` : ""}
            </span>
          </div>
          {editing ? (
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await editPost(sb(), id, title.trim(), body.trim());
                  setEditing(false);
                  post.reload();
                } catch (err) {
                  onError(err);
                }
              }}
            >
              <Input label={t("campus.composer.title")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={CAMPUS_LIMITS.title} required />
              <Textarea label={t("campus.composer.body")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={CAMPUS_LIMITS.body} rows={5} />
              <div className="row">
                <Button type="submit" size="sm" disabled={!title.trim() || !!campusTextProblem(title + body)}>
                  {t("campus.post.save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <h1 style={{ margin: 0 }}>{p.title}</h1>
              {p.body ? <RichText text={p.body} /> : null}
            </>
          )}
          <div className="row">
            {isQuestion ? <Badge tone="info">{t("campus.post.question")}</Badge> : null}
            {p.accepted_comment_id ? <Badge tone="success">{t("campus.post.accepted")}</Badge> : null}
            <LanguageTag language={p.language} />
          </div>
          <div className="row">
            {!p.is_mine ? (
              <Button size="sm" variant={p.my_liked ? "primary" : "secondary"} aria-pressed={p.my_liked} aria-label={`${t("campus.post.like")}, ${t("campus.post.likes", { n: p.like_count })}`} onClick={async () => { try { await react(sb(), "post", id, "like", !p.my_liked); post.reload(); } catch (e) { onError(e); } }}>
                <Icon name="reaction" size={14} /> {p.like_count}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => { setTitle(p.title); setBody(p.body); setEditing(true); }}>
                  {t("campus.post.edit")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                  {t("campus.post.delete")}
                </Button>
              </>
            )}
            {!p.is_mine ? (
              <Button size="sm" variant="ghost" onClick={() => setReport({ target: "post", id })}>
                {t("campus.safety.report")}
              </Button>
            ) : null}
            {p.can_moderate && !p.is_mine ? (
              <Button size="sm" variant="ghost" onClick={() => setRemoval({ kind: "post", id })}>
                {t("campus.post.removeAsMod")}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      <section className="stack" aria-labelledby="comments-h">
        <h2 id="comments-h" style={{ margin: 0 }}>
          {t(isQuestion ? "campus.post.answers" : "campus.post.comments", { n: p.comment_count })}
        </h2>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await createComment(sb(), id, text.trim(), replyTo?.id ?? null);
              setText("");
              setReplyTo(null);
              reload();
            } catch (err) {
              onError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {replyTo ? (
            <div className="row">
              <span className="um-muted">
                {t("campus.post.reply")}: {replyTo.author_name ?? replyTo.author_username ?? t("campus.post.anonymousAuthor")}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          ) : null}
          <Textarea label={t(isQuestion ? "campus.post.writeAnswer" : "campus.post.writeComment")} value={text} onChange={(e) => setText(e.target.value)} maxLength={CAMPUS_LIMITS.comment} rows={3} error={bad ? t("campus.errors.invalidText") : undefined} />
          <div className="row">
            <Button type="submit" loading={busy} disabled={!text.trim() || !!bad}>
              {t("campus.post.send")}
            </Button>
          </div>
        </form>
        {!online ? (
          <p className="um-muted" role="status">
            {t("campus.offline")}
          </p>
        ) : null}
        {comments.loading && !comments.data ? (
          <Skeleton height={80} />
        ) : comments.error && !comments.data ? (
          <ErrorState title={t("campus.loadFailed")} action={<Button onClick={comments.reload}>{t("common.retry")}</Button>} />
        ) : tree.length === 0 ? (
          <EmptyState title={t("campus.post.noComments")} />
        ) : (
          <ul className="stack" style={{ margin: 0, padding: 0 }}>
            {tree.map((n) => (
              <CommentView key={n.id} node={n} ctx={ctx} />
            ))}
          </ul>
        )}
      </section>

      {report ? <ReportDialog target={report.target} id={report.id} onClose={() => setReport(null)} /> : null}
      <Dialog
        open={!!removal}
        title={t("campus.post.removeAsMod")}
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
                try {
                  await modRemoveContent(sb(), removal!.kind, removal!.id, reason.trim());
                  toast(t("campus.moderation.removed"), "success");
                  const wasPost = removal!.kind === "post";
                  setRemoval(null);
                  setReason("");
                  if (wasPost) router.push("/campus");
                  else reload();
                } catch (e) {
                  onError(e);
                }
              }}
            >
              {t("campus.moderation.remove")}
            </Button>
          </>
        }
      >
        <Input label={t("campus.post.removeReason")} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Dialog>
      <Dialog
        open={confirmDelete}
        title={t("campus.post.deleteConfirm")}
        onClose={() => setConfirmDelete(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={async () => { try { await deletePost(sb(), id); router.push("/campus"); } catch (e) { onError(e); } }}>
              {t("campus.post.delete")}
            </Button>
          </>
        }
      />
    </div>
  );
}
