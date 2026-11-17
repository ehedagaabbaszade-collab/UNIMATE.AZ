"use client";

import { examTotalPoints, type Exam } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Dialog, Icon, EmptyState, ErrorState, Input, Skeleton, Textarea, useToast } from "@unimate/ui";
import Link from "next/link";
import { useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { getCommunity } from "../campus/api";
import { Chips } from "../career/parts";
import { useExamStore } from "../teacher/store";
import { ClassApiError, classInviteCode, createAssignment, listAssignments, listClassExams, publishExam, type ClassAssignment, type ClassExam } from "./api";
import { optionalFuture, useClassError } from "./hooks";

type Section = "exams" | "assignments";

/** One class. The teacher manages exams and assignments; a student sees and does them. */
export function ClassScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const [section, setSection] = useState<Section>("exams");
  const info = useAsync(() => getCommunity(getBrowserClient(), id), [id]);
  const teaching = info.data?.my_role === "owner" || info.data?.my_role === "moderator";
  const exams = useAsync(() => listClassExams(getBrowserClient(), id), [id]);
  const tasks = useAsync(() => listAssignments(getBrowserClient(), id), [id]);

  if (info.loading && !info.data) return <Skeleton height={120} />;
  if (!info.data) return <ErrorState title={t("teach.class.errors.notFound")} action={<Button onClick={info.reload}>{t("common.retry")}</Button>} />;
  return (
    <div className="stack">
      <header className="page-head">
        <p>{teaching ? t("teach.class.teaching") : t("teach.class.title")}</p>
        <h1>{info.data.name}</h1>
      </header>
      {teaching ? <InviteCard id={id} name={info.data.name} /> : null}
      <Chips label={t("teach.class.title")} value={section} onChange={setSection} options={[{ value: "exams", label: t("teach.class.exams") }, { value: "assignments", label: t("teach.class.assignments") }]} />
      {section === "exams" ? (
        <>
          {teaching ? <PublishExam cls={id} onDone={exams.reload} /> : null}
          {exams.loading && !exams.data ? (
            <Skeleton height={90} />
          ) : exams.error && !exams.data ? (
            <ErrorState title={t("teach.class.errors.generic")} action={<Button onClick={exams.reload}>{t("common.retry")}</Button>} />
          ) : (exams.data ?? []).length === 0 ? (
            <EmptyState title={t("teach.class.exams")} {...(teaching ? { description: t("teach.class.noLocalExams") } : {})} />
          ) : (
            (exams.data ?? []).map((e) => <ExamRow key={e.id} e={e} teaching={teaching} />)
          )}
        </>
      ) : (
        <>
          {teaching ? <NewAssignment cls={id} onDone={tasks.reload} /> : null}
          {tasks.loading && !tasks.data ? (
            <Skeleton height={90} />
          ) : tasks.error && !tasks.data ? (
            <ErrorState title={t("teach.class.errors.generic")} action={<Button onClick={tasks.reload}>{t("common.retry")}</Button>} />
          ) : (tasks.data ?? []).length === 0 ? (
            <EmptyState title={t("teach.class.assignments")} description={t("teach.class.noSubmissions")} />
          ) : (
            (tasks.data ?? []).map((a) => <AssignmentRow key={a.id} a={a} cls={id} teaching={teaching} />)
          )}
        </>
      )}
    </div>
  );
}

function InviteCard({ id, name }: { id: string; name: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const code = useAsync(() => classInviteCode(getBrowserClient(), id), [id]);
  const text = t("teach.class.shareText", { name, code: code.data ?? "" });
  async function share() {
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
    } catch {
      /* dismissed share sheet or clipboard refused: nothing to report */
    }
  }
  return (
    <div className="um-card stack">
      <p className="um-label">{t("teach.class.code")}</p>
      <p style={{ fontSize: 24, fontWeight: 300, letterSpacing: 2, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere", userSelect: "all" }}>{code.data ?? "····················"}</p>
      <p className="um-muted">{t("teach.class.inviteHint")}</p>
      {code.error && !code.data ? (
        <Button size="sm" variant="secondary" onClick={code.reload}>
          {t("common.retry")}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          disabled={!code.data}
          onClick={() => {
            void share();
            toast(t("teach.class.shareCode"), "success");
          }}
        >
          {t("teach.class.shareCode")}
        </Button>
      )}
    </div>
  );
}

function ExamRow({ e, teaching }: { e: ClassExam; teaching: boolean }) {
  const { t, dateTime } = useI18n();
  const closed = e.closes_at !== null && Date.parse(e.closes_at) <= Date.now();
  const status = teaching ? (
    <Badge tone="info">{t("teach.class.attempts", { n: e.attempt_count ?? 0 })}</Badge>
  ) : e.my_status === "submitted" ? (
    <Badge tone={e.my_pending_open ? "warning" : "success"}>{e.my_score === null ? t("teach.class.submitted") : t("teach.class.scoreLine", { s: e.my_score, m: e.max_score })}</Badge>
  ) : closed ? (
    <Badge>{t("teach.class.closed")}</Badge>
  ) : (
    <Badge tone="primary">{e.my_status === "in_progress" ? t("teach.class.resume") : t("teach.class.start")}</Badge>
  );
  const canOpen = teaching || (e.my_status !== "submitted" && !closed);
  const body = (
    <>
      <span className="list-item__main">
        <span className="list-item__title">{e.title}</span>
        <span className="list-item__meta">{t("teach.class.examMeta", { q: e.question_count, p: e.max_score, m: e.minutes })}</span>
        {e.closes_at ? <span className="list-item__meta">{t("teach.class.closesOn", { date: dateTime(e.closes_at) })}</span> : null}
        {!teaching && e.my_status === "submitted" && e.my_pending_open ? <span className="list-item__meta">{t("teach.class.pendingOpen")}</span> : null}
      </span>
      {status}
    </>
  );
  return canOpen ? (
    <Link href={teaching ? `/class/results/${e.id}` : `/class/exam/${e.id}`} className="list-item">
      {body}
    </Link>
  ) : (
    <div className="list-item" aria-disabled="true">
      {body}
    </div>
  );
}

function AssignmentRow({ a, cls, teaching }: { a: ClassAssignment; cls: string; teaching: boolean }) {
  const { t, dateTime } = useI18n();
  const badge = teaching ? (
    <Badge tone="info">{t("teach.class.submissions", { n: a.submission_count ?? 0 })}</Badge>
  ) : a.my_grade !== null ? (
    <Badge tone="success">{t("teach.class.gradeLine", { g: a.my_grade })}</Badge>
  ) : a.my_submitted_at ? (
    <Badge tone="primary">{t("teach.class.submitted")}</Badge>
  ) : null;
  return (
    <Link href={`/class/assignment/${a.id}?cls=${cls}`} className="list-item">
      <span className="list-item__main">
        <span className="list-item__title">{a.title}</span>
        {a.due_at ? <span className="list-item__meta">{t("teach.class.dueOn", { date: dateTime(a.due_at) })}</span> : null}
      </span>
      {badge}
    </Link>
  );
}

/** Teacher: pick one of the exams saved on this device and publish it to the class (the server keeps the key). */
function PublishExam({ cls, onDone }: { cls: string; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { id: uid } = useUser();
  const store = useExamStore(uid);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Exam | null>(null);
  const [closes, setCloses] = useState("");
  const [badDate, setBadDate] = useState(false);
  const [busy, setBusy] = useState(false);
  async function publish() {
    if (!picked) return;
    const c = optionalFuture(closes);
    if (c === false) return setBadDate(true);
    setBusy(true);
    setError(null);
    try {
      await publishExam(getBrowserClient(), cls, picked, c);
      toast(t("teach.class.published"), "success");
      setOpen(false);
      setPicked(null);
      setCloses("");
      onDone();
    } catch (e) {
      setError(t(`teach.class.errors.${e instanceof ClassApiError ? e.key : "generic"}`));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="row">
        <Button
          onClick={() => {
            store.reload();
            setOpen(true);
          }}
        >
          {t("teach.class.publish")}
        </Button>
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("teach.class.publishPick")}
        actions={
          <>
            <Button loading={busy} disabled={!picked || busy} onClick={() => void publish()}>
              {t("teach.class.publish")}
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t("common.close")}
            </Button>
          </>
        }
      >
        <div className="stack">
          {store.exams.length === 0 ? (
            <p className="um-muted">{t("teach.class.noLocalExams")}</p>
          ) : (
            store.exams.map((e) => (
              <button key={e.id} type="button" className="list-item" style={{ textAlign: "start", width: "100%", cursor: "pointer" }} aria-pressed={picked?.id === e.id} onClick={() => setPicked(e)}>
                <span className="list-item__main">
                  <span className="list-item__title">{e.title}</span>
                  <span className="list-item__meta">{t("teach.class.examMeta", { q: e.questions.length, p: examTotalPoints(e), m: e.minutes })}</span>
                </span>
                {picked?.id === e.id ? <Icon name="check" size="sm" /> : null}
              </button>
            ))
          )}
          <Input
            label={t("teach.class.closesAt")}
            hint={t("teach.class.dateHint")}
            type="datetime-local"
            value={closes}
            onChange={(e) => {
              setCloses(e.target.value);
              setBadDate(false);
            }}
            error={badDate ? t("teach.class.badDate") : undefined}
          />
          {error ? (
            <p className="err-box" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

function NewAssignment({ cls, onDone }: { cls: string; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useClassError();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [badDate, setBadDate] = useState(false);
  const [busy, setBusy] = useState(false);
  async function post() {
    const d = optionalFuture(due);
    if (d === false) return setBadDate(true);
    setBusy(true);
    try {
      await createAssignment(getBrowserClient(), cls, title.trim(), body.trim(), d);
      toast(t("teach.class.posted"), "success");
      setTitle("");
      setBody("");
      setDue("");
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="um-card">
      <summary>
        <strong>{t("teach.class.createAssignment")}</strong>
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <Input label={t("teach.class.aTitle")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        <Textarea label={t("teach.class.aBody")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
        <Input
          label={t("teach.class.due")}
          hint={t("teach.class.dateHint")}
          type="datetime-local"
          value={due}
          onChange={(e) => {
            setDue(e.target.value);
            setBadDate(false);
          }}
          error={badDate ? t("teach.class.badDate") : undefined}
        />
        <Button loading={busy} disabled={!title.trim() || busy} onClick={() => void post()}>
          {t("teach.class.createAssignment")}
        </Button>
      </div>
    </details>
  );
}
