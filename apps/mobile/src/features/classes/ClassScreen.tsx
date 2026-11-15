import { ExamStoreSchema, examTotalPoints, type Exam } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Modal, ScrollView, Share, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, ExpandCard, HeroTitle, Input, ListGroup, ListRow, PillRow, PressableScale, Screen, ScreenHeader, Skeleton, useToast } from "../../components/ui";
import { parseLocalDateTime } from "../../lib/datetime";
import { useLocalValue } from "../../lib/local-store";
import { examsKey } from "../../lib/storage";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { getCommunity } from "../campus/api";
import { classInviteCode, createAssignment, listAssignments, listClassExams, publishExam, type ClassAssignment, type ClassExam } from "./api";
import { useClassError } from "./ClassesScreen";

type Section = "exams" | "assignments";

/** "" = no limit; otherwise a future local date-time -> ISO, or false when it is not valid. */
function optionalFuture(text: string): string | null | false {
  if (!text.trim()) return null;
  const iso = parseLocalDateTime(text);
  return iso && Date.parse(iso) > Date.now() ? iso : false;
}

/** One class. The teacher manages exams and assignments; a student sees and does them. */
export function ClassScreen({ id }: { id: string }) {
  const { t, dateTime } = useI18n();
  const router = useRouter();
  const { supabase: sb } = useUser();
  const [section, setSection] = useState<Section>("exams");
  const info = useAsync(() => getCommunity(sb, id), [sb, id]);
  const teaching = info.data?.my_role === "owner" || info.data?.my_role === "moderator";
  const exams = useAsync(() => listClassExams(sb, id), [sb, id]);
  const tasks = useAsync(() => listAssignments(sb, id), [sb, id]);
  const reloadAll = useCallback(() => {
    exams.reload();
    tasks.reload();
  }, [exams.reload, tasks.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reloadAll(); // back from taking an exam, grading or handing in
    }, [reloadAll]),
  );

  if (info.loading && !info.data) return <Screen><ScreenHeader title={t("teach.class.title")} /><Skeleton height={120} /></Screen>;
  if (!info.data)
    return (
      <Screen>
        <ScreenHeader title={t("teach.class.title")} />
        <ErrorState title={t("teach.class.errors.notFound")} action={<Button title={t("common.retry")} onPress={info.reload} />} />
      </Screen>
    );
  return (
    <Screen ambient>
      <ScreenHeader title={info.data.name} />
      <HeroTitle muted={teaching ? t("teach.class.teaching") : t("teach.class.title")} strong={info.data.name} />
      {teaching ? <InviteCard id={id} name={info.data.name} /> : null}
      <PillRow label={t("teach.class.title")} value={section} onChange={setSection} options={[{ value: "exams", label: t("teach.class.exams") }, { value: "assignments", label: t("teach.class.assignments") }]} />
      {section === "exams" ? (
        <>
          {teaching ? <PublishExam cls={id} onDone={exams.reload} /> : null}
          {exams.loading && !exams.data ? (
            <Skeleton height={90} />
          ) : exams.error && !exams.data ? (
            <ErrorState title={t("teach.class.errors.generic")} action={<Button title={t("common.retry")} onPress={exams.reload} />} />
          ) : (exams.data ?? []).length === 0 ? (
            <EmptyState title={t("teach.class.exams")} description={teaching ? t("teach.class.noLocalExams") : undefined} />
          ) : (
            (exams.data ?? []).map((e) => <ExamRow key={e.id} e={e} teaching={teaching} onOpen={() => router.push({ pathname: teaching ? "/class/results/[id]" : "/class/exam/[id]", params: { id: e.id } } as Href)} />)
          )}
        </>
      ) : (
        <>
          {teaching ? <NewAssignment cls={id} onDone={tasks.reload} /> : null}
          {tasks.loading && !tasks.data ? (
            <Skeleton height={90} />
          ) : tasks.error && !tasks.data ? (
            <ErrorState title={t("teach.class.errors.generic")} action={<Button title={t("common.retry")} onPress={tasks.reload} />} />
          ) : (tasks.data ?? []).length === 0 ? (
            <EmptyState title={t("teach.class.assignments")} description={t("teach.class.noSubmissions")} />
          ) : (
            (tasks.data ?? []).map((a) => <AssignmentRow key={a.id} a={a} teaching={teaching} dateTime={dateTime} onOpen={() => router.push({ pathname: "/class/assignment/[id]", params: { id: a.id, cls: id } } as Href)} />)
          )}
        </>
      )}
    </Screen>
  );
}

function InviteCard({ id, name }: { id: string; name: string }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const code = useAsync(() => classInviteCode(sb, id), [sb, id]);
  return (
    <Card style={{ gap: spacing.sm }}>
      <AppText variant="label" muted>
        {t("teach.class.code")}
      </AppText>
      <AppText selectable style={{ fontSize: 30, fontWeight: "300", letterSpacing: 4, color: theme.text, fontVariant: ["tabular-nums"] }}>
        {code.data ?? "··········"}
      </AppText>
      <AppText variant="caption" muted>
        {t("teach.class.inviteHint")}
      </AppText>
      <Button small variant="secondary" title={t("teach.class.shareCode")} disabled={!code.data} onPress={() => void Share.share({ message: t("teach.class.shareText", { name, code: code.data ?? "" }) })} />
    </Card>
  );
}

function ExamRow({ e, teaching, onOpen }: { e: ClassExam; teaching: boolean; onOpen: () => void }) {
  const { t, dateTime } = useI18n();
  const closed = e.closes_at !== null && Date.parse(e.closes_at) <= Date.now();
  const status = teaching ? (
    <Badge tone="info">{t("teach.class.attempts", { n: e.attempt_count ?? 0 })}</Badge>
  ) : e.my_status === "submitted" ? (
    <Badge tone={e.my_pending_open ? "warning" : "success"}>{e.my_score === null ? t("teach.class.submitted") : t("teach.class.scoreLine", { s: e.my_score, m: e.max_score })}</Badge>
  ) : closed ? (
    <Badge tone="neutral">{t("teach.class.closed")}</Badge>
  ) : (
    <Badge tone="primary">{e.my_status === "in_progress" ? t("teach.class.resume") : t("teach.class.start")}</Badge>
  );
  const canOpen = teaching || (e.my_status !== "submitted" && !closed);
  return (
    <PressableScale disabled={!canOpen} onPress={onOpen} accessibilityRole="button" accessibilityLabel={e.title} accessibilityState={{ disabled: !canOpen }}>
      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm }}>
          <AppText variant="heading" style={{ flex: 1 }}>
            {e.title}
          </AppText>
          {status}
        </View>
        <AppText variant="caption" muted>
          {t("teach.class.examMeta", { q: e.question_count, p: e.max_score, m: e.minutes })}
        </AppText>
        {e.closes_at ? (
          <AppText variant="caption" muted>
            {t("teach.class.closesOn", { date: dateTime(e.closes_at) })}
          </AppText>
        ) : null}
        {!teaching && e.my_status === "submitted" && e.my_pending_open ? (
          <AppText variant="caption" muted>
            {t("teach.class.pendingOpen")}
          </AppText>
        ) : null}
      </Card>
    </PressableScale>
  );
}

function AssignmentRow({ a, teaching, dateTime, onOpen }: { a: ClassAssignment; teaching: boolean; dateTime: (d: string) => string; onOpen: () => void }) {
  const { t } = useI18n();
  const badge = teaching ? (
    <Badge tone="info">{t("teach.class.submissions", { n: a.submission_count ?? 0 })}</Badge>
  ) : a.my_grade !== null ? (
    <Badge tone="success">{t("teach.class.gradeLine", { g: a.my_grade })}</Badge>
  ) : a.my_submitted_at ? (
    <Badge tone="primary">{t("teach.class.submitted")}</Badge>
  ) : null;
  return (
    <PressableScale onPress={onOpen} accessibilityRole="button" accessibilityLabel={a.title}>
      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm }}>
          <AppText variant="heading" style={{ flex: 1 }}>
            {a.title}
          </AppText>
          {badge}
        </View>
        {a.due_at ? (
          <AppText variant="caption" muted>
            {t("teach.class.dueOn", { date: dateTime(a.due_at) })}
          </AppText>
        ) : null}
      </Card>
    </PressableScale>
  );
}

/** Teacher: pick one of the exams saved on this device and publish it to the class (the server keeps the key). */
function PublishExam({ cls, onDone }: { cls: string; onDone: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { toast } = useToast();
  const onError = useClassError();
  const { user, supabase: sb } = useUser();
  const store = useLocalValue(examsKey(user.id), ExamStoreSchema, { exams: [] });
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
    try {
      await publishExam(sb, cls, picked, c);
      toast(t("teach.class.published"), "success");
      setOpen(false);
      setPicked(null);
      setCloses("");
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        title={t("teach.class.publish")}
        onPress={() => {
          store.reload();
          setOpen(true);
        }}
      />
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.bg }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <AppText variant="title" accessibilityRole="header" style={{ flex: 1 }}>
                {t("teach.class.publishPick")}
              </AppText>
              <Button small variant="secondary" title={t("common.close")} onPress={() => setOpen(false)} />
            </View>
            {store.value.exams.length === 0 ? (
              <AppText muted>{t("teach.class.noLocalExams")}</AppText>
            ) : (
              <ListGroup>
                {store.value.exams.map((e) => (
                  <ListRow key={e.id} icon={picked?.id === e.id ? "check" : "exams"} iconColor={picked?.id === e.id ? theme.success : theme.active} title={e.title} subtitle={t("teach.class.examMeta", { q: e.questions.length, p: examTotalPoints(e), m: e.minutes })} onPress={() => setPicked(e)} />
                ))}
              </ListGroup>
            )}
            <Input
              label={t("teach.class.closesAt")}
              hint={t("teach.class.dateHint")}
              value={closes}
              onChangeText={(v) => {
                setCloses(v);
                setBadDate(false);
              }}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              error={badDate ? t("teach.class.badDate") : undefined}
            />
            <Button title={t("teach.class.publish")} loading={busy} disabled={!picked || busy} onPress={() => void publish()} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function NewAssignment({ cls, onDone }: { cls: string; onDone: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useClassError();
  const { supabase: sb } = useUser();
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
      await createAssignment(sb, cls, title.trim(), body.trim(), d);
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
    <ExpandCard label={t("teach.class.createAssignment")} header={<AppText variant="heading">{t("teach.class.createAssignment")}</AppText>}>
      <Input label={t("teach.class.aTitle")} value={title} onChangeText={setTitle} maxLength={200} />
      <Input label={t("teach.class.aBody")} value={body} onChangeText={setBody} multiline maxLength={4000} style={{ minHeight: 100, textAlignVertical: "top" }} />
      <Input
        label={t("teach.class.due")}
        hint={t("teach.class.dateHint")}
        value={due}
        onChangeText={(v) => {
          setDue(v);
          setBadDate(false);
        }}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
        error={badDate ? t("teach.class.badDate") : undefined}
      />
      <Button title={t("teach.class.createAssignment")} loading={busy} disabled={!title.trim() || busy} onPress={() => void post()} />
    </ExpandCard>
  );
}
