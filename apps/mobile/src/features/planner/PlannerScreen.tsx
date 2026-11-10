import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, Input, Notice, Screen, Segmented, Skeleton, useOnline, useToast } from "../../components/ui";
import { parseLocalDateTime } from "../../lib/datetime";
import type { ExamRow, TaskRow, TimetableRow } from "../../lib/db";
import { examSchema, fieldErrors, taskSchema, timetableSchema } from "../../lib/schemas";
import { groupByWeekday, hhmm, isOverdue } from "../../lib/schedule";
import { KEYS, kv } from "../../lib/storage";
import { useUser } from "../../state/session";
import { cancelReminders, ensurePermission, syncReminders } from "./reminders-native";
import { useSchedule } from "./useSchedule";

type Errors = Record<string, MessageKey>;
type Tab = "timetable" | "tasks" | "exams";
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** Placeholder only shows the format; it has no letters so it is not translatable copy. */
const DATE_FORMAT = "2026-01-31 14:30";

function useWrite(reload: () => void) {
  const { t } = useI18n();
  const { toast } = useToast();
  return async (op: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await op;
    if (error) {
      toast(t("planner.saveFailed", { reason: error.message }), "error");
      return false;
    }
    reload();
    return true;
  };
}

function TimetableTab({ rows, editable, reload }: { rows: TimetableRow[]; editable: boolean; reload: () => void }) {
  const { t } = useI18n();
  const { user, supabase: sb } = useUser();
  const write = useWrite(reload);
  const [f, setF] = useState({ title: "", weekday: "1", startTime: "09:00", endTime: "10:30", location: "" });
  const [errors, setErrors] = useState<Errors>({});
  const grouped = groupByWeekday(rows);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function add() {
    const parsed = timetableSchema.safeParse(f);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const v = parsed.data;
    if (await write(sb.from("timetable_entries").insert({ user_id: user.id, title: v.title, weekday: v.weekday, start_time: v.startTime, end_time: v.endTime, location: v.location }))) setF((s) => ({ ...s, title: "", location: "" }));
  }

  return (
    <View style={{ gap: 12 }}>
      {editable ? (
        <Card>
          <Input label={t("planner.classTitle")} value={f.title} onChangeText={set("title")} error={errors.title && t(errors.title)} />
          <Segmented label={t("planner.weekday")} value={f.weekday} onChange={set("weekday")} options={DAYS.map((d) => ({ value: String(d), label: t(`planner.weekdays.${d}` as MessageKey) }))} />
          <Input label={t("planner.start")} value={f.startTime} onChangeText={set("startTime")} placeholder="09:00" keyboardType="numbers-and-punctuation" error={errors.startTime && t(errors.startTime)} />
          <Input label={t("planner.end")} value={f.endTime} onChangeText={set("endTime")} placeholder="10:30" keyboardType="numbers-and-punctuation" error={errors.endTime && t(errors.endTime)} />
          <Input label={`${t("planner.location")} (${t("common.optional")})`} value={f.location} onChangeText={set("location")} error={errors.location && t(errors.location)} />
          <Button title={t("planner.addClass")} onPress={add} />
        </Card>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={t("planner.noClasses")} description={t("planner.noClassesBody")} />
      ) : (
        DAYS.filter((d) => grouped.has(d)).map((d) => (
          <View key={d} style={{ gap: 8 }}>
            <AppText variant="heading" accessibilityRole="header">
              {t(`planner.weekdays.${d}` as MessageKey)}
            </AppText>
            {grouped.get(d)!.map((c) => (
              <Card key={c.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <AppText style={{ fontWeight: "700" }}>{c.title}</AppText>
                  <AppText variant="caption" muted>
                    {hhmm(c.start_time)}–{hhmm(c.end_time)}
                    {c.location ? ` · ${c.location}` : ""}
                  </AppText>
                </View>
                {editable ? <Button small variant="ghost" title={t("planner.deleteItem")} onPress={() => void write(sb.from("timetable_entries").delete().eq("id", c.id))} /> : null}
              </Card>
            ))}
          </View>
        ))
      )}
    </View>
  );
}

function TasksTab({ rows, editable, reload }: { rows: TaskRow[]; editable: boolean; reload: () => void }) {
  const { t, dateTime } = useI18n();
  const { user, supabase: sb } = useUser();
  const write = useWrite(reload);
  const [f, setF] = useState({ title: "", due: "", priority: "2" });
  const [errors, setErrors] = useState<Errors>({});
  const now = new Date();

  async function add() {
    const dueIso = f.due.trim() ? parseLocalDateTime(f.due) : "";
    if (dueIso === null) return setErrors({ dueAt: "validation.date" });
    const parsed = taskSchema.safeParse({ title: f.title, dueAt: dueIso, priority: f.priority });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    if (await write(sb.from("tasks").insert({ user_id: user.id, title: parsed.data.title, due_at: parsed.data.dueAt, priority: parsed.data.priority }))) setF({ title: "", due: "", priority: f.priority });
  }
  // tasks_check: (status = 'done') = (completed_at is not null), so both change together.
  const toggle = (task: TaskRow) => write(sb.from("tasks").update(task.status === "done" ? { status: "todo", completed_at: null } : { status: "done", completed_at: new Date().toISOString() }).eq("id", task.id));

  return (
    <View style={{ gap: 12 }}>
      {editable ? (
        <Card>
          <Input label={t("planner.taskTitle")} value={f.title} onChangeText={(v) => setF((s) => ({ ...s, title: v }))} error={errors.title && t(errors.title)} />
          <Input label={`${t("planner.due")} (${t("common.optional")})`} value={f.due} onChangeText={(v) => setF((s) => ({ ...s, due: v }))} placeholder={DATE_FORMAT} keyboardType="numbers-and-punctuation" autoCapitalize="none" error={errors.dueAt && t(errors.dueAt)} />
          <Segmented label={t("planner.priority")} value={f.priority} onChange={(v) => setF((s) => ({ ...s, priority: v }))} options={[1, 2, 3].map((p) => ({ value: String(p), label: t(`planner.priorities.${p}` as MessageKey) }))} />
          <Button title={t("planner.addTask")} onPress={add} />
        </Card>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={t("planner.noTasks")} description={t("planner.noTasksBody")} />
      ) : (
        rows.map((task) => (
          <Card key={task.id}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontWeight: "700", textDecorationLine: task.status === "done" ? "line-through" : "none" }}>{task.title}</AppText>
                <AppText variant="caption" muted>
                  {task.due_at ? dateTime(task.due_at) : t("common.none")} · {t(`planner.priorities.${task.priority}` as MessageKey)}
                </AppText>
              </View>
              {isOverdue(task, now) ? <Badge tone="danger">{t("planner.overdue")}</Badge> : <Badge tone={task.status === "done" ? "success" : "neutral"}>{t(`planner.status.${task.status}`)}</Badge>}
            </View>
            {editable ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button small variant="secondary" title={task.status === "done" ? t("planner.markTodo") : t("planner.markDone")} onPress={() => void toggle(task)} />
                <Button small variant="ghost" title={t("planner.deleteItem")} onPress={() => void write(sb.from("tasks").delete().eq("id", task.id))} />
              </View>
            ) : null}
          </Card>
        ))
      )}
    </View>
  );
}

function ExamsTab({ rows, editable, reload }: { rows: ExamRow[]; editable: boolean; reload: () => void }) {
  const { t, dateTime } = useI18n();
  const { user, supabase: sb } = useUser();
  const write = useWrite(reload);
  const [f, setF] = useState({ title: "", startsAt: "", duration: "", location: "", weight: "" });
  const [errors, setErrors] = useState<Errors>({});
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function add() {
    const startsIso = parseLocalDateTime(f.startsAt);
    if (!startsIso) return setErrors({ startsAt: "validation.date" });
    const parsed = examSchema.safeParse({ title: f.title, startsAt: startsIso, durationMinutes: f.duration, location: f.location, weight: f.weight });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const v = parsed.data;
    if (await write(sb.from("exams").insert({ user_id: user.id, title: v.title, starts_at: v.startsAt, duration_minutes: v.durationMinutes, location: v.location, weight: v.weight }))) setF({ title: "", startsAt: "", duration: "", location: "", weight: "" });
  }

  return (
    <View style={{ gap: 12 }}>
      {editable ? (
        <Card>
          <Input label={t("planner.examTitle")} value={f.title} onChangeText={set("title")} error={errors.title && t(errors.title)} />
          <Input label={t("planner.examStarts")} value={f.startsAt} onChangeText={set("startsAt")} placeholder={DATE_FORMAT} keyboardType="numbers-and-punctuation" autoCapitalize="none" error={errors.startsAt && t(errors.startsAt)} />
          <Input label={`${t("planner.duration")} (${t("common.optional")})`} value={f.duration} onChangeText={set("duration")} keyboardType="number-pad" error={errors.durationMinutes && t(errors.durationMinutes)} />
          <Input label={`${t("planner.location")} (${t("common.optional")})`} value={f.location} onChangeText={set("location")} error={errors.location && t(errors.location)} />
          <Input label={`${t("planner.weight")} (${t("common.optional")})`} value={f.weight} onChangeText={set("weight")} keyboardType="decimal-pad" error={errors.weight && t(errors.weight)} />
          <Button title={t("planner.addExam")} onPress={add} />
        </Card>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={t("planner.noExams")} description={t("planner.noExamsBody")} />
      ) : (
        rows.map((e) => (
          <Card key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <AppText style={{ fontWeight: "700" }}>{e.title}</AppText>
              <AppText variant="caption" muted>
                {dateTime(e.starts_at)}
                {e.location ? ` · ${e.location}` : ""}
              </AppText>
            </View>
            {editable ? <Button small variant="ghost" title={t("planner.deleteItem")} onPress={() => void write(sb.from("exams").delete().eq("id", e.id))} /> : null}
          </Card>
        ))
      )}
    </View>
  );
}

/** Reminders switch: local scheduled notifications only. Re-synced whenever the schedule changes. */
function Reminders({ tasks, exams }: { tasks: TaskRow[]; exams: ExamRow[] }) {
  const { t, locale } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [denied, setDenied] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    void kv.getItem(KEYS.reminders).then((v) => setEnabled(v === "1"));
  }, []);

  const sync = useCallback(async () => setCount(await syncReminders(locale, tasks, exams).catch(() => 0)), [locale, tasks, exams]);
  useEffect(() => {
    if (enabled) void sync();
  }, [enabled, sync]);

  async function toggle() {
    if (enabled) {
      await cancelReminders().catch(() => undefined);
      await kv.setItem(KEYS.reminders, "0");
      setEnabled(false);
      return setCount(null);
    }
    const p = await ensurePermission(locale).catch(() => "denied" as const);
    setDenied(p === "denied");
    if (p === "granted") {
      await kv.setItem(KEYS.reminders, "1");
      setEnabled(true);
    }
  }

  return (
    <Card>
      <AppText variant="heading">{t("mobile.planner.remindersTitle")}</AppText>
      <AppText muted variant="caption">
        {t("mobile.planner.remindersBody")}
      </AppText>
      {denied ? <Notice tone="warning" text={t("mobile.planner.remindersDenied")} /> : null}
      {enabled && count !== null ? <AppText variant="caption">{t("mobile.planner.remindersCount", { n: count })}</AppText> : null}
      <Button title={enabled ? t("mobile.planner.remindersOff") : t("mobile.planner.remindersEnable")} variant={enabled ? "secondary" : "primary"} onPress={() => void toggle()} />
    </Card>
  );
}

export function PlannerScreen() {
  const { t, date } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const schedule = useSchedule();
  const [tab, setTab] = useState<Tab>("timetable");
  const editable = online && schedule.source === "live";
  const d = schedule.data;

  return (
    <Screen>
      <AppText variant="display" accessibilityRole="header">
        {t("planner.title")}
      </AppText>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button small variant="secondary" title={t("nav.focus")} onPress={() => router.push("/focus")} />
        <Button small variant="secondary" title={t("nav.gpa")} onPress={() => router.push("/gpa")} />
      </View>
      {schedule.source === "cache" && schedule.savedAt ? <Notice tone="warning" text={`${t("planner.cachedNotice", { date: date(schedule.savedAt) })} ${t("planner.offlineReadOnly")}`} /> : null}
      <Segmented
        label={t("planner.tabs.label")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "timetable", label: t("planner.tabs.timetable") },
          { value: "tasks", label: t("planner.tabs.tasks") },
          { value: "exams", label: t("planner.tabs.exams") },
        ]}
      />
      {schedule.loading && !d ? (
        <Skeleton height={120} />
      ) : !d ? (
        <ErrorState title={t("planner.loadFailed")} description={schedule.error ?? undefined} action={<Button title={t("common.retry")} onPress={schedule.reload} />} />
      ) : (
        <>
          {tab === "timetable" ? <TimetableTab rows={d.timetable} editable={editable} reload={schedule.reload} /> : null}
          {tab === "tasks" ? <TasksTab rows={d.tasks} editable={editable} reload={schedule.reload} /> : null}
          {tab === "exams" ? <ExamsTab rows={d.exams} editable={editable} reload={schedule.reload} /> : null}
          <Reminders tasks={d.tasks} exams={d.exams} />
        </>
      )}
    </Screen>
  );
}


