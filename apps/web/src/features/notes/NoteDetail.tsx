"use client";

import { NOTE_REPORT_MAX, NOTE_REPORT_MIN, NOTE_REVIEW_MAX, canStudyWithAi, courseLabel, noteStatusView } from "@unimate/core";
import { formatBytes } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Icon, Skeleton, Textarea, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useUser } from "@/components/user";
import { edgeErrorMessageKey } from "@/lib/edge";
import { importResource, resourceUrl } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { NotesApiError, deleteNote, getNote, listReviews, rateNote, reportCopyright, setSaved } from "./api";
import { StarInput, Stars } from "./parts";

export function NoteDetail({ id }: { id: string }) {
  const { t, date, locale } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const user = useUser();
  const note = useAsync(() => getNote(getBrowserClient(), id, user.id), [id, user.id]);
  const reviews = useAsync(() => listReviews(getBrowserClient(), id), [id], !!note.data && note.data.status === "published");
  const [saved, setSavedState] = useState(false);
  const [busy, setBusy] = useState<"open" | "study" | "save" | "rate" | "report" | null>(null);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [details, setDetails] = useState("");
  const [rateError, setRateError] = useState<string | null>(null);

  const mineReview = reviews.data?.find((r) => r.isMine);
  useEffect(() => {
    if (note.data) setSavedState(note.data.saved);
  }, [note.data]);
  useEffect(() => {
    if (mineReview) {
      setStars(mineReview.rating);
      setComment(mineReview.comment ?? "");
    }
  }, [mineReview]);

  if (note.loading && !note.data) return <Skeleton height={220} />;
  if (note.error) return <ErrorState title={t("notes.loadFailed")} description={note.error} action={<Button onClick={note.reload}>{t("common.retry")}</Button>} />;
  const n = note.data;
  if (!n) return <EmptyState title={t("notes.detail.notFound")} action={<Link className="um-btn um-btn--secondary" href="/notes">{t("common.back")}</Link>} />;

  const mine = n.uploaderId === user.id;
  const view = noteStatusView(n.status, n.takedownHold);
  const course = courseLabel({ code: n.courseCode, title: n.courseTitle });
  const sb = getBrowserClient();

  async function open() {
    setBusy("open");
    const r = await resourceUrl(id);
    setBusy(null);
    if (!r.ok) return toast(t("notes.detail.openFailed"), "error");
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }
  async function study() {
    setBusy("study");
    const r = await importResource(id);
    setBusy(null);
    if (!r.ok) return toast(t("notes.detail.studyFailed", { reason: t(edgeErrorMessageKey(r.error)) }), "error");
    toast(t("notes.detail.studyStarted"), "success");
    router.push(`/documents/${r.data.documentId}`);
  }
  async function toggleSave() {
    setBusy("save");
    const next = !saved;
    try {
      await setSaved(sb, user.id, id, next);
      setSavedState(next);
    } catch {
      toast(t("common.genericError"), "error");
    }
    setBusy(null);
  }
  async function submitRating() {
    setBusy("rate");
    setRateError(null);
    try {
      await rateNote(sb, id, stars, comment);
      toast(t("notes.reviews.thanks"), "success");
      note.reload();
      reviews.reload();
    } catch (e) {
      setRateError(e instanceof NotesApiError && e.code === "42501" ? t("notes.reviews.own") : t("notes.reviews.failed"));
    }
    setBusy(null);
  }
  async function sendReport() {
    setBusy("report");
    try {
      await reportCopyright(sb, id, details);
      setReportOpen(false);
      setDetails("");
      toast(t("notes.detail.reportSent"), "success");
      router.push("/notes");
    } catch (e) {
      toast(e instanceof NotesApiError && e.code === "42501" ? t("notes.detail.reportOwn") : t("notes.detail.reportFailed"), "error");
    }
    setBusy(null);
  }
  async function remove() {
    if (!window.confirm(t("notes.detail.deleteConfirm"))) return;
    try {
      await deleteNote(sb, id);
      toast(t("notes.detail.deleted"), "success");
      router.push("/notes");
    } catch {
      toast(t("common.genericError"), "error");
    }
  }

  return (
    <div className="stack-lg">
      <div>
        <Link href="/notes" className="um-btn um-btn--ghost um-btn--sm">
          {t("common.back")}
        </Link>
      </div>
      <Card>
        <div className="row">
          <Badge tone="info">{t(`notes.kind.${n.kind}`)}</Badge>
          {mine ? <Badge tone={view === "published" ? "success" : view === "removed" ? "danger" : "warning"}>{t(`notes.status.${view}`)}</Badge> : null}
        </div>
        <h1>{n.title}</h1>
        {mine && view !== "published" ? <p className="um-muted" role="status">{t(`notes.statusHint.${view}`)}</p> : null}
        {n.description ? <p>{n.description}</p> : null}
        <Stars value={n.avgRating} count={n.ratingCount} />
        <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
          {[
            t("notes.saveCount", { n: n.saveCount }),
            course ? `${t("notes.detail.course")}: ${course}` : null,
            n.universityName ? `${t("notes.detail.university")}: ${n.universityName}` : null,
            n.sizeBytes ? `${t("notes.detail.size")}: ${formatBytes(locale, n.sizeBytes)}` : null,
            `${t("notes.detail.uploaded")}: ${date(n.createdAt)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {n.tags.length ? (
          <div className="row" aria-label={t("notes.detail.tags")}>
            {n.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        ) : null}
        {!mine ? (
          <p>
            <Link href={`/notes/contributor/${n.uploaderId}`} aria-label={t("notes.detail.viewContributor")}>
              {t("notes.by", { name: n.uploaderName ?? t("notes.anonymous") })}
            </Link>
          </p>
        ) : null}
        <div className="row">
          <Button loading={busy === "open"} onClick={() => void open()}>
            <Icon name="download" size="sm" />
            {busy === "open" ? t("notes.detail.opening") : t("notes.detail.open")}
          </Button>
          {canStudyWithAi(n.mimeType) ? (
            <Button variant="secondary" loading={busy === "study"} onClick={() => void study()}>
              <Icon name="ai-study" size="sm" />
              {busy === "study" ? t("notes.detail.studying") : t("notes.detail.studyWithAi")}
            </Button>
          ) : null}
          {n.status === "published" ? (
            <Button variant="secondary" loading={busy === "save"} onClick={() => void toggleSave()} aria-pressed={saved}>
              <Icon name="saved" size="sm" />
              {saved ? t("notes.detail.unsave") : t("notes.detail.save")}
            </Button>
          ) : null}
          {mine ? (
            <Button variant="danger" onClick={() => void remove()}>
              {t("notes.detail.delete")}
            </Button>
          ) : n.status === "published" ? (
            <Button variant="ghost" onClick={() => setReportOpen(true)}>
              <Icon name="report" size="sm" />
              {t("notes.detail.report")}
            </Button>
          ) : null}
        </div>
        {!canStudyWithAi(n.mimeType) ? <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>{t("notes.detail.studyUnsupported")}</p> : null}
      </Card>

      {n.status === "published" ? (
        <section className="stack-lg" aria-labelledby="reviews-h">
          <h2 id="reviews-h">{t("notes.reviews.title")}</h2>
          {!mine ? (
            <Card>
              <StarInput value={stars} onChange={setStars} disabled={busy === "rate"} />
              <Textarea label={t("notes.reviews.mine")} placeholder={t("notes.reviews.placeholder")} value={comment} maxLength={NOTE_REVIEW_MAX} onChange={(e) => setComment(e.target.value)} />
              {rateError ? <p className="err-box" role="alert">{rateError}</p> : null}
              <div className="row">
                <Button disabled={stars < 1} loading={busy === "rate"} onClick={() => void submitRating()}>
                  {mineReview ? t("notes.reviews.update") : t("notes.reviews.submit")}
                </Button>
              </div>
            </Card>
          ) : null}
          {reviews.loading && !reviews.data ? (
            <Skeleton height={80} />
          ) : reviews.error ? (
            <ErrorState title={t("notes.loadFailed")} description={reviews.error} action={<Button onClick={reviews.reload}>{t("common.retry")}</Button>} />
          ) : !reviews.data?.length ? (
            <p className="um-muted">{t("notes.empty.reviews")}</p>
          ) : (
            reviews.data.map((r) => (
              <Card key={r.userId}>
                <Stars value={r.rating} />
                {r.comment ? <p>{r.comment}</p> : null}
                <p className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
                  {[r.isMine ? t("notes.reviews.mine") : (r.displayName ?? t("notes.anonymous")), date(r.createdAt)].join(" · ")}
                </p>
              </Card>
            ))
          )}
        </section>
      ) : null}

      <Dialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title={t("notes.detail.reportTitle")}
        actions={
          <>
            <Button variant="ghost" onClick={() => setReportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={details.trim().length < NOTE_REPORT_MIN} loading={busy === "report"} onClick={() => void sendReport()}>
              {t("notes.detail.reportSend")}
            </Button>
          </>
        }
      >
        <p className="um-muted">{t("notes.detail.reportHint")}</p>
        <Textarea label={t("notes.detail.report")} placeholder={t("notes.detail.reportPlaceholder")} value={details} maxLength={NOTE_REPORT_MAX} onChange={(e) => setDetails(e.target.value)} />
      </Dialog>
    </div>
  );
}
