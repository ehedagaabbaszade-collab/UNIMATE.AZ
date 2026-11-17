import { useI18n } from "@unimate/i18n/react";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, ExpandCard, Input, Notice, Screen, ScreenHeader, Skeleton, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { spacing } from "../../theme/tokens";
import { getCommunity } from "../campus/api";
import { SUBMISSION_BUCKET, deleteAssignment, gradeSubmission, listAssignments, listSubmissions, submissionPath, submissionUrl, submitAssignment, type ClassAssignment, type SubmissionRow } from "./api";
import { useClassError } from "./ClassesScreen";

const MAX_BYTES = 20 * 1024 * 1024; // the bucket's limit
const MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "text/plain"];

/** One assignment: the teacher grades what was handed in; a student hands in text and/or one file. */
export function AssignmentScreen({ id, cls }: { id: string; cls: string }) {
  const { t, dateTime } = useI18n();
  const { supabase: sb } = useUser();
  const info = useAsync(() => getCommunity(sb, cls), [sb, cls]);
  const list = useAsync(() => listAssignments(sb, cls), [sb, cls]);
  const a = list.data?.find((x) => x.id === id);
  const teaching = info.data?.my_role === "owner" || info.data?.my_role === "moderator";

  if ((list.loading && !list.data) || (info.loading && !info.data)) return <Screen><ScreenHeader title={t("teach.class.assignments")} /><Skeleton height={140} /></Screen>;
  if (!a)
    return (
      <Screen>
        <ScreenHeader title={t("teach.class.assignments")} />
        <ErrorState title={t("teach.class.errors.notFound")} action={<Button title={t("common.retry")} onPress={list.reload} />} />
      </Screen>
    );
  return (
    <Screen ambient>
      <ScreenHeader title={a.title} />
      <Card style={{ gap: spacing.sm }}>
        <AppText variant="heading">{a.title}</AppText>
        {a.due_at ? (
          <AppText variant="caption" muted>
            {t("teach.class.dueOn", { date: dateTime(a.due_at) })}
          </AppText>
        ) : null}
        {a.body ? <AppText selectable>{a.body}</AppText> : null}
      </Card>
      {teaching ? <TeacherView a={a} /> : <StudentView a={a} onDone={list.reload} />}
    </Screen>
  );
}

function TeacherView({ a }: { a: ClassAssignment }) {
  const { t } = useI18n();
  const router = useRouter();
  const onError = useClassError();
  const { supabase: sb } = useUser();
  const subs = useAsync(() => listSubmissions(sb, a.id), [sb, a.id]);
  const remove = () =>
    Alert.alert(t("teach.class.deleteAssignment"), t("teach.class.deleteAssignmentConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await deleteAssignment(sb, a.id);
            router.back();
          } catch (e) {
            onError(e);
          }
        },
      },
    ]);
  return (
    <>
      {subs.loading && !subs.data ? (
        <Skeleton height={100} />
      ) : !subs.data ? (
        <ErrorState title={t("teach.class.errors.generic")} action={<Button title={t("common.retry")} onPress={subs.reload} />} />
      ) : subs.data.length === 0 ? (
        <EmptyState title={t("teach.class.noSubmissions")} />
      ) : (
        subs.data.map((s) => <SubmissionCard key={s.id} s={s} onGraded={subs.reload} />)
      )}
      <Button variant="danger" title={t("teach.class.deleteAssignment")} onPress={remove} />
    </>
  );
}

function SubmissionCard({ s, onGraded }: { s: SubmissionRow; onGraded: () => void }) {
  const { t, dateTime } = useI18n();
  const { toast } = useToast();
  const onError = useClassError();
  const { supabase: sb } = useUser();
  const [grade, setGrade] = useState(s.grade === null ? "" : String(s.grade));
  const [feedback, setFeedback] = useState(s.feedback ?? "");
  const [busy, setBusy] = useState(false);
  const n = Number(grade.replace(",", "."));
  const valid = grade.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100;
  const name = s.display_name ?? "—";
  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <AppText variant="heading" numberOfLines={1}>
          {name}
        </AppText>
        <AppText variant="caption" muted>
          {t("teach.class.handedIn", { date: dateTime(s.submitted_at) })}
        </AppText>
      </View>
      {s.late ? <Badge tone="warning">{t("teach.class.late")}</Badge> : null}
      {s.grade !== null ? <Badge tone="success">{t("teach.class.gradeLine", { g: s.grade })}</Badge> : null}
    </View>
  );
  return (
    <ExpandCard label={name} header={header}>
      {s.body ? <AppText selectable>{s.body}</AppText> : null}
      {s.file_path ? (
        <Button
          small
          variant="secondary"
          title={`${t("teach.class.openFile")}${s.file_name ? `: ${s.file_name}` : ""}`}
          onPress={async () => {
            try {
              await Linking.openURL(await submissionUrl(sb, s.file_path!));
            } catch (e) {
              onError(e);
            }
          }}
        />
      ) : null}
      <Input label={t("teach.class.gradeInput")} value={grade} onChangeText={(v) => setGrade(v.replace(/[^0-9.,]/g, ""))} keyboardType="decimal-pad" maxLength={5} />
      <Input label={t("teach.class.feedbackInput")} value={feedback} onChangeText={setFeedback} multiline maxLength={2000} style={{ minHeight: 70, textAlignVertical: "top" }} />
      <Button
        title={t("teach.class.save")}
        loading={busy}
        disabled={!valid || busy}
        onPress={async () => {
          setBusy(true);
          try {
            await gradeSubmission(sb, s.id, n, feedback.trim());
            toast(t("teach.class.saved"), "success");
            onGraded();
          } catch (e) {
            onError(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </ExpandCard>
  );
}

function StudentView({ a, onDone }: { a: ClassAssignment; onDone: () => void }) {
  const { t, dateTime } = useI18n();
  const { toast } = useToast();
  const onError = useClassError();
  const { user, supabase: sb } = useUser();
  const [body, setBody] = useState(a.my_body ?? "");
  const [file, setFile] = useState<{ uri: string; name: string; mime: string; size: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setBody(a.my_body ?? ""), [a.my_body]);
  const graded = a.my_grade !== null;

  async function pick() {
    const r = await DocumentPicker.getDocumentAsync({ type: MIME, copyToCacheDirectory: true, multiple: false }).catch(() => null);
    const f = r && !r.canceled ? r.assets[0] : null;
    if (!f) return;
    if ((f.size ?? 0) > MAX_BYTES) return toast(t("teach.class.fileTooBig"), "error");
    setFile({ uri: f.uri, name: f.name, mime: f.mimeType ?? "application/octet-stream", size: f.size ?? 0 });
  }

  async function handIn() {
    setBusy(true);
    let uploaded: string | null = null;
    try {
      if (file) {
        const path = submissionPath(user.id, a.id, file.name);
        const bytes = await new File(file.uri).arrayBuffer();
        const up = await sb.storage.from(SUBMISSION_BUCKET).upload(path, bytes, { contentType: file.mime, upsert: false });
        if (up.error) {
          toast(t("teach.class.uploadFailed"), "error");
          return;
        }
        uploaded = path;
      }
      await submitAssignment(sb, a.id, body.trim(), uploaded ? { path: uploaded, name: file!.name } : null);
      toast(t("teach.class.submitted"), "success");
      setFile(null);
      onDone();
    } catch (e) {
      // the hand-in failed after the upload: do not leave an orphan file behind
      if (uploaded) await sb.storage.from(SUBMISSION_BUCKET).remove([uploaded]).catch(() => undefined);
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {a.my_submitted_at ? <Notice tone="success" text={t("teach.class.handedIn", { date: dateTime(a.my_submitted_at) })} /> : null}
      {graded ? (
        <Card style={{ gap: spacing.sm }}>
          <AppText variant="heading">{t("teach.class.gradeLine", { g: a.my_grade! })}</AppText>
          {a.my_feedback ? <AppText selectable>{t("teach.class.feedbackLine", { f: a.my_feedback })}</AppText> : null}
        </Card>
      ) : (
        <Card style={{ gap: spacing.md }}>
          <Input label={t("teach.class.yourAnswer")} value={body} onChangeText={setBody} multiline maxLength={8000} style={{ minHeight: 140, textAlignVertical: "top" }} />
          {a.my_file_name && !file ? (
            <AppText variant="caption" muted>
              {t("teach.class.attached", { name: a.my_file_name })}
            </AppText>
          ) : null}
          {file ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <AppText style={{ flex: 1 }} numberOfLines={1}>
                {t("teach.class.attached", { name: file.name })}
              </AppText>
              <Button small variant="ghost" title={t("teach.class.removeFile")} onPress={() => setFile(null)} />
            </View>
          ) : (
            <Button small variant="secondary" title={t("teach.class.attach")} onPress={() => void pick()} />
          )}
          <Button title={t("teach.class.handIn")} loading={busy} disabled={busy || (!body.trim() && !file)} onPress={() => void handIn()} />
        </Card>
      )}
    </>
  );
}
