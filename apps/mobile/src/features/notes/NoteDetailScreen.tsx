import { NOTE_REPORT_MAX, NOTE_REPORT_MIN, NOTE_REVIEW_MAX, canStudyWithAi, courseLabel, noteStatusView } from "@unimate/core";
import { formatBytes } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Notice, Screen, ScreenHeader, Skeleton, useToast } from "../../components/ui";
import { edgeErrorMessageKey } from "../../lib/edge";
import { importResource, resourceUrl } from "../../lib/edge-client";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { deleteNote, getNote, listReviews, rateNote, reportCopyright, setSaved, NotesApiError } from "./api";
import { StarInput, Stars } from "./parts";

export function NoteDetailScreen({ id }: { id: string }) {
  const { t, date, locale } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const { user, supabase: sb } = useUser();
  const note = useAsync(() => getNote(sb, id, user.id), [sb, id, user.id]);
  const reviews = useAsync(() => listReviews(sb, id), [sb, id], !!note.data && note.data.status === "published");
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

  if (note.loading && !note.data) {
    return (
      <Screen>
        <ScreenHeader title={t("notes.title")} onBack={() => router.back()} />
        <Skeleton height={180} />
      </Screen>
    );
  }
  if (note.error) {
    return (
      <Screen>
        <ScreenHeader title={t("notes.title")} onBack={() => router.back()} />
        <ErrorState title={t("notes.loadFailed")} description={note.error} action={<Button title={t("common.retry")} onPress={note.reload} />} />
      </Screen>
    );
  }
  const n = note.data;
  if (!n) {
    return (
      <Screen>
        <ScreenHeader title={t("notes.title")} onBack={() => router.back()} />
        <EmptyState title={t("notes.detail.notFound")} />
      </Screen>
    );
  }
  const mine = n.uploaderId === user.id;
  const view = noteStatusView(n.status, n.takedownHold);
  const course = courseLabel({ code: n.courseCode, title: n.courseTitle });

  async function open() {
    setBusy("open");
    const r = await resourceUrl(id);
    setBusy(null);
    if (!r.ok) return toast(t("notes.detail.openFailed"), "error");
    void Linking.openURL(r.data.url).catch(() => toast(t("notes.detail.openFailed"), "error"));
  }
  async function study() {
    setBusy("study");
    const r = await importResource(id);
    setBusy(null);
    if (!r.ok) return toast(t("notes.detail.studyFailed", { reason: t(edgeErrorMessageKey(r.error)) }), "error");
    toast(t("notes.detail.studyStarted"), "success");
    router.push({ pathname: "/documents/[id]", params: { id: r.data.documentId } });
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
      router.back();
    } catch (e) {
      toast(e instanceof NotesApiError && e.code === "42501" ? t("notes.detail.reportOwn") : t("notes.detail.reportFailed"), "error");
    }
    setBusy(null);
  }
  function confirmDelete() {
    Alert.alert(t("notes.detail.deleteConfirm"), n!.title, [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteNote(sb, id);
            toast(t("notes.detail.deleted"), "success");
            router.back();
          } catch {
            toast(t("common.genericError"), "error");
          }
        },
      },
    ]);
  }

  return (
    <Screen>
      <ScreenHeader title={t("notes.title")} onBack={() => router.back()} />
      <Card strong>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Badge tone="info">{t(`notes.kind.${n.kind}`)}</Badge>
          {mine ? <Badge tone={view === "published" ? "success" : view === "removed" ? "danger" : "warning"}>{t(`notes.status.${view}`)}</Badge> : null}
        </View>
        <AppText variant="title" accessibilityRole="header">
          {n.title}
        </AppText>
        {mine && view !== "published" ? <Notice tone="info" text={t(`notes.statusHint.${view}`)} /> : null}
        {n.description ? <AppText>{n.description}</AppText> : null}
        <Stars value={n.avgRating} count={n.ratingCount} />
        <AppText variant="caption" muted>
          {t("notes.saveCount", { n: n.saveCount })}
        </AppText>
        <View style={{ gap: 2 }}>
          {course ? <AppText variant="caption" muted>{`${t("notes.detail.course")}: ${course}`}</AppText> : null}
          {n.universityName ? <AppText variant="caption" muted>{`${t("notes.detail.university")}: ${n.universityName}`}</AppText> : null}
          {n.sizeBytes ? <AppText variant="caption" muted>{`${t("notes.detail.size")}: ${formatBytes(locale, n.sizeBytes)}`}</AppText> : null}
          <AppText variant="caption" muted>{`${t("notes.detail.uploaded")}: ${date(n.createdAt)}`}</AppText>
        </View>
        {n.tags.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }} accessibilityLabel={t("notes.detail.tags")}>
            {n.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </View>
        ) : null}
        {!mine ? (
          <Button
            small
            variant="ghost"
            title={t("notes.by", { name: n.uploaderName ?? t("notes.anonymous") })}
            accessibilityLabel={t("notes.detail.viewContributor")}
            onPress={() => router.push({ pathname: "/notes/contributor/[id]", params: { id: n.uploaderId } })}
          />
        ) : null}
      </Card>

      <View style={{ gap: 10 }}>
        <Button title={busy === "open" ? t("notes.detail.opening") : t("notes.detail.open")} icon={<Icon name="download" size="sm" color="#FFFFFF" />} loading={busy === "open"} onPress={() => void open()} />
        {canStudyWithAi(n.mimeType) ? (
          <Button title={busy === "study" ? t("notes.detail.studying") : t("notes.detail.studyWithAi")} variant="secondary" icon={<Icon name="ai-study" size="sm" color="#FFFFFF" />} loading={busy === "study"} onPress={() => void study()} />
        ) : (
          <AppText variant="caption" muted>
            {t("notes.detail.studyUnsupported")}
          </AppText>
        )}
        {n.status === "published" ? (
          <Button title={saved ? t("notes.detail.unsave") : t("notes.detail.save")} variant="secondary" icon={<Icon name="saved" size="sm" color="#FFFFFF" />} loading={busy === "save"} onPress={() => void toggleSave()} />
        ) : null}
        {mine ? (
          <Button title={t("notes.detail.delete")} variant="danger" onPress={confirmDelete} />
        ) : n.status === "published" ? (
          <Button title={t("notes.detail.report")} variant="ghost" icon={<Icon name="report" size="sm" color="#FFFFFF" />} onPress={() => setReportOpen(true)} />
        ) : null}
      </View>

      {n.status === "published" ? (
        <View style={{ gap: 12 }}>
          <AppText variant="heading" accessibilityRole="header">
            {t("notes.reviews.title")}
          </AppText>
          {!mine ? (
            <Card>
              <AppText variant="label">{t("notes.reviews.yourRating")}</AppText>
              <StarInput value={stars} onChange={setStars} disabled={busy === "rate"} />
              <Input label={t("notes.reviews.mine")} placeholder={t("notes.reviews.placeholder")} value={comment} onChangeText={setComment} multiline maxLength={NOTE_REVIEW_MAX} />
              {rateError ? <Notice text={rateError} /> : null}
              <Button title={mineReview ? t("notes.reviews.update") : t("notes.reviews.submit")} disabled={stars < 1} loading={busy === "rate"} onPress={() => void submitRating()} />
            </Card>
          ) : null}
          {reviews.loading && !reviews.data ? (
            <Skeleton height={70} />
          ) : reviews.error ? (
            <ErrorState title={t("notes.loadFailed")} description={reviews.error} action={<Button title={t("common.retry")} onPress={reviews.reload} />} />
          ) : !reviews.data?.length ? (
            <AppText muted>{t("notes.empty.reviews")}</AppText>
          ) : (
            reviews.data.map((r) => (
              <Card key={r.userId}>
                <Stars value={r.rating} />
                {r.comment ? <AppText>{r.comment}</AppText> : null}
                <AppText variant="caption" muted>
                  {[r.isMine ? t("notes.reviews.mine") : (r.displayName ?? t("notes.anonymous")), date(r.createdAt)].join(" · ")}
                </AppText>
              </Card>
            ))
          )}
        </View>
      ) : null}

      <Dialog
        open={reportOpen}
        title={t("notes.detail.reportTitle")}
        onClose={() => setReportOpen(false)}
        actions={
          <>
            <Button small variant="ghost" title={t("common.cancel")} onPress={() => setReportOpen(false)} />
            <Button small title={t("notes.detail.reportSend")} disabled={details.trim().length < NOTE_REPORT_MIN} loading={busy === "report"} onPress={() => void sendReport()} />
          </>
        }
      >
        <AppText muted>{t("notes.detail.reportHint")}</AppText>
        <Input label={t("notes.detail.report")} placeholder={t("notes.detail.reportPlaceholder")} value={details} onChangeText={setDetails} multiline maxLength={NOTE_REPORT_MAX} />
      </Dialog>
    </Screen>
  );
}
