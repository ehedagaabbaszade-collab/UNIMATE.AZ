"use client";

import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton, Textarea, useToast } from "@unimate/ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { getCommunity } from "../campus/api";
import { SUBMISSION_BUCKET, deleteAssignment, gradeSubmission, listAssignments, listSubmissions, submissionPath, submissionUrl, submitAssignment, type ClassAssignment, type SubmissionRow } from "./api";
import { useClassError } from "./hooks";

const MAX_BYTES = 20 * 1024 * 1024; // the bucket's limit
const MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "text/plain"];

/** One assignment: the teacher grades what was handed in; a student hands in text and/or one file. */
export function AssignmentScreen({ id, cls }: { id: string; cls: string }) {
  const { t, dateTime } = useI18n();
  const info = useAsync(() => getCommunity(getBrowserClient(), cls), [cls]);
  const list = useAsync(() => listAssignments(getBrowserClient(), cls), [cls]);
  const a = list.data?.find((x) => x.id === id);
  const teaching = info.data?.my_role === "owner" || info.data?.my_role === "moderator";

  if ((list.loading && !list.data) || (info.loading && !info.data)) return <Skeleton height={140} />;
  if (!a) return <ErrorState title={t("teach.class.errors.notFound")} action={<Button onClick={list.reload}>{t("common.retry")}</Button>} />;
  return (
    <div className="stack">
      <header className="page-head">
        <h1>{a.title}</h1>
        {a.due_at ? <p>{t("teach.class.dueOn", { date: dateTime(a.due_at) })}</p> : null}
      </header>
      {a.body ? (
        <div className="um-card">
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.body}</p>
        </div>
      ) : null}
      {teaching ? <TeacherView a={a} /> : <StudentView a={a} onDone={list.reload} />}
    </div>
  );
}

function TeacherView({ a }: { a: ClassAssignment }) {
  const { t } = useI18n();
  const router = useRouter();
  const onError = useClassError();
  const subs = useAsync(() => listSubmissions(getBrowserClient(), a.id), [a.id]);
  const remove = async () => {
    if (!window.confirm(`${t("teach.class.deleteAssignment")}\n${t("teach.class.deleteAssignmentConfirm")}`)) return;
    try {
      await deleteAssignment(getBrowserClient(), a.id);
      router.back();
    } catch (e) {
      onError(e);
    }
  };
  return (
    <>
      {subs.loading && !subs.data ? (
        <Skeleton height={100} />
      ) : !subs.data ? (
        <ErrorState title={t("teach.class.errors.generic")} action={<Button onClick={subs.reload}>{t("common.retry")}</Button>} />
      ) : subs.data.length === 0 ? (
        <EmptyState title={t("teach.class.noSubmissions")} />
      ) : (
        subs.data.map((s) => <SubmissionCard key={s.id} s={s} onGraded={subs.reload} />)
      )}
      <div className="row">
        <Button variant="danger" onClick={() => void remove()}>
          {t("teach.class.deleteAssignment")}
        </Button>
      </div>
    </>
  );
}

function SubmissionCard({ s, onGraded }: { s: SubmissionRow; onGraded: () => void }) {
  const { t, dateTime } = useI18n();
  const { toast } = useToast();
  const onError = useClassError();
  const [grade, setGrade] = useState(s.grade === null ? "" : String(s.grade));
  const [feedback, setFeedback] = useState(s.feedback ?? "");
  const [busy, setBusy] = useState(false);
  const n = Number(grade.replace(",", "."));
  const valid = grade.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 100;
  const name = s.display_name ?? "—";
  return (
    <details className="um-card">
      <summary className="row row--between">
        <span className="list-item__main">
          <strong>{name}</strong>
          <span className="list-item__meta">{t("teach.class.handedIn", { date: dateTime(s.submitted_at) })}</span>
        </span>
        <span className="row">
          {s.late ? <Badge tone="warning">{t("teach.class.late")}</Badge> : null}
          {s.grade !== null ? <Badge tone="success">{t("teach.class.gradeLine", { g: s.grade })}</Badge> : null}
        </span>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        {s.body ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{s.body}</p> : null}
        {s.file_path ? (
          <div className="row">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                const w = window.open("", "_blank"); // opened synchronously: a window opened after an await is popup-blocked
                try {
                  const url = await submissionUrl(getBrowserClient(), s.file_path!);
                  if (w) {
                    w.opener = null;
                    w.location.href = url;
                  } else window.location.assign(url);
                } catch (e) {
                  w?.close();
                  onError(e);
                }
              }}
            >
              {`${t("teach.class.openFile")}${s.file_name ? `: ${s.file_name}` : ""}`}
            </Button>
          </div>
        ) : null}
        <Input label={t("teach.class.gradeInput")} value={grade} onChange={(e) => setGrade(e.target.value.replace(/[^0-9.,]/g, ""))} inputMode="decimal" maxLength={5} />
        <Textarea label={t("teach.class.feedbackInput")} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} />
        <div className="row">
          <Button
            loading={busy}
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await gradeSubmission(getBrowserClient(), s.id, n, feedback.trim());
                toast(t("teach.class.saved"), "success");
                onGraded();
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("teach.class.save")}
          </Button>
        </div>
      </div>
    </details>
  );
}

function StudentView({ a, onDone }: { a: ClassAssignment; onDone: () => void }) {
  const { t, dateTime } = useI18n();
  const { toast } = useToast();
  const onError = useClassError();
  const { id: uid } = useUser();
  const [body, setBody] = useState(a.my_body ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setBody(a.my_body ?? ""), [a.my_body]);
  const graded = a.my_grade !== null;

  function pick(f: File | undefined) {
    if (!f) return;
    if (!MIME.includes(f.type)) return toast(t("teach.class.fileType"), "error");
    if (f.size > MAX_BYTES) return toast(t("teach.class.fileTooBig"), "error");
    setFile(f);
  }

  async function handIn() {
    setBusy(true);
    const sb = getBrowserClient();
    let uploaded: string | null = null;
    try {
      if (file) {
        const path = submissionPath(uid, a.id, file.name);
        const up = await sb.storage.from(SUBMISSION_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
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
      {a.my_submitted_at ? <p className="ok-box" role="status">{t("teach.class.handedIn", { date: dateTime(a.my_submitted_at) })}</p> : null}
      {graded ? (
        <div className="um-card stack">
          <h2>{t("teach.class.gradeLine", { g: a.my_grade! })}</h2>
          {a.my_feedback ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{t("teach.class.feedbackLine", { f: a.my_feedback })}</p> : null}
        </div>
      ) : (
        <div className="um-card stack">
          <Textarea label={t("teach.class.yourAnswer")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} rows={7} />
          {a.my_file_name && !file ? <p className="um-muted">{t("teach.class.attached", { name: a.my_file_name })}</p> : null}
          <input ref={input} type="file" accept={MIME.join(",")} hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          {file ? (
            <div className="row">
              <span style={{ flex: 1, overflowWrap: "anywhere" }}>{t("teach.class.attached", { name: file.name })}</span>
              <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
                {t("teach.class.removeFile")}
              </Button>
            </div>
          ) : (
            <div className="row">
              <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
                {t("teach.class.attach")}
              </Button>
            </div>
          )}
          <div className="row">
            <Button loading={busy} disabled={busy || (!body.trim() && !file)} onClick={() => void handIn()}>
              {t("teach.class.handIn")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
