import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Icon } from "../../components/Icon";
import { SlidingSegmented } from "../../components/SlidingSegmented";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, HeroTitle, Input, Notice, PressableScale, RoundAction, Screen, ScreenHeader, Segmented, Skeleton, useOnline, useToast } from "../../components/ui";
import { parseLocalDateTime } from "../../lib/datetime";
import type { ExamRow, TaskRow, TimetableRow } from "../../lib/db";
import { examSchema, fieldErrors, taskSchema, timetableSchema } from "../../lib/schemas";
import { groupByWeekday, hhmm, isOverdue } from "../../lib/schedule";
import { KEYS, kv } from "../../lib/storage";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { cancelReminders, ensurePermission, syncReminders } from "./reminders-native";
import { useSchedule } from "./useSchedule";

type Errors = Record<string, MessageKey>;
type Tab = "timetable" | "tasks" | "exams";
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;
/** Placeholder only shows the format; it has no letters so it is not translatable copy. */
const DATE_FORMAT = "2026-01-31 14:30";

const pad2 = (n: number) => String(n).padStart(2, "0");
const hmOf = (iso: string) => {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const isoWeekday = (d: Date) => d.getDay() || 7;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addDays(d, 1 - isoWeekday(d));
const onDay = (iso: string | null, day: Date) => !!iso && sameDay(new Date(iso), day);

/** Rounded item card: start time on the left (tabular, light), title and meta on the right, optional tags and actions. */
function ItemCard({ time, title, meta, tags, strike, children }: { time?: string | undefined; title: string; meta?: string; tags?: ReactNode; strike?: boolean; children?: ReactNode }) {
  return (
    <Card style={{ borderRadius: 24, gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        {time ? (
          <AppText maxFontSizeMultiplier={1.2} style={{ width: 56, fontSize: 20, fontWeight: "300", fontVariant: ["tabular-nums"] }}>
            {time}
          </AppText>
        ) : null}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText style={{ fontWeight: "600", textDecorationLine: strike ? "line-through" : "none" }}>{title}</AppText>
          {meta ? (
            <AppText variant="caption" muted>
              {meta}
            </AppText>
          ) : null}
        </View>
        {tags}
      </View>
      {children}
    </Card>
  );
}

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

function TimetableTab({ rows, day, editable, showForm, reload }: { rows: TimetableRow[]; day: Date; editable: boolean; showForm: boolean; reload: () => void }) {
  const { t } = useI18n();
  const { user, supabase: sb } = useUser();
  const write = useWrite(reload);
  const [f, setF] = useState({ title: "", weekday: "1", startTime: "09:00", endTime: "10:30", location: "" });
  const [errors, setErrors] = useState<Errors>({});
  const dayRows = groupByWeekday(rows).get(isoWeekday(day)) ?? [];
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
      {editable && showForm ? (
        <Card>
          <Input label={t("planner.classTitle")} value={f.title} onChangeText={set("title")} error={errors.title && t(errors.title)} />
          <Segmented label={t("planner.weekday")} value={f.weekday} onChange={set("weekday")} options={DAYS.map((d) => ({ value: String(d), label: t(`planner.weekdays.${d}` as MessageKey) }))} />
          <Input label={t("planner.start")} value={f.startTime} onChangeText={set("startTime")} placeholder="09:00" keyboardType="numbers-and-punctuation" error={errors.startTime && t(errors.startTime)} />
          <Input label={t("planner.end")} value={f.endTime} onChangeText={set("endTime")} placeholder="10:30" keyboardType="numbers-and-punctuation" error={errors.endTime && t(errors.endTime)} />
          <Input label={`${t("planner.location")} (${t("common.optional")})`} value={f.location} onChangeText={set("location")} error={errors.location && t(errors.location)} />
          <Button title={t("planner.addClass")} onPress={add} />
        </Card>
      ) : null}
      {dayRows.length === 0 ? (
        <EmptyState title={t("mobile.planner.noClassesDay")} description={rows.length === 0 ? t("planner.noClassesBody") : undefined} />
      ) : (
        dayRows.map((c) => (
          <ItemCard key={c.id} time={hhmm(c.start_time)} title={c.title} meta={`${hhmm(c.start_time)}–${hhmm(c.end_time)}${c.location ? ` · ${c.location}` : ""}`}>
            {editable ? <Button small variant="ghost" title={t("planner.deleteItem")} onPress={() => void write(sb.from("timetable_entries").delete().eq("id", c.id))} /> : null}
          </ItemCard>
        ))
      )}
    </View>
  );
}

function TasksTab({ rows, day, editable, showForm, reload }: { rows: TaskRow[]; day: Date; editable: boolean; showForm: boolean; reload: () => void }) {
  const { t, dateTime } = useI18n();
  const { user, supabase: sb } = useUser();
  const write = useWrite(reload);
  const [f, setF] = useState({ title: "", due: "", priority: "2" });
  const [errors, setErrors] = useState<Errors>({});
  const now = new Date();
  const dayRows = rows.filter((r) => onDay(r.due_at, day)).sort((x, y) => String(x.due_at).localeCompare(String(y.due_at)));
  const undated = rows.filter((r) => !r.due_at);

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

  const renderTask = (task: TaskRow) => (
    <ItemCard
      key={task.id}
      time={task.due_at ? hmOf(task.due_at) : undefined}
      title={task.title}
      meta={`${task.due_at ? dateTime(task.due_at) : t("common.none")} · ${t(`planner.priorities.${task.priority}` as MessageKey)}`}
      strike={task.status === "done"}
      tags={isOverdue(task, now) ? <Badge tone="danger">{t("planner.overdue")}</Badge> : <Badge tone={task.status === "done" ? "success" : "neutral"}>{t(`planner.status.${task.status}`)}</Badge>}
    >
      {editable ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button small variant="secondary" title={task.status === "done" ? t("planner.markTodo") : t("planner.markDone")} onPress={() => void toggle(task)} />
          <Button small variant="ghost" title={t("planner.deleteItem")} onPress={() => void write(sb.from("tasks").delete().eq("id", task.id))} />
        </View>
      ) : null}
    </ItemCard>
  );

  return (
    <View style={{ gap: 12 }}>
      {editable && showForm ? (
        <Card>
          <Input label={t("planner.taskTitle")} value={f.title} onChangeText={(v) => setF((s) => ({ ...s, title: v }))} error={errors.title && t(errors.title)} />
          <Input label={`${t("planner.due")} (${t("common.optional")})`} value={f.due} onChangeText={(v) => setF((s) => ({ ...s, due: v }))} placeholder={DATE_FORMAT} keyboardType="numbers-and-punctuation" autoCapitalize="none" error={errors.dueAt && t(errors.dueAt)} />
          <Segmented label={t("planner.priority")} value={f.priority} onChange={(v) => setF((s) => ({ ...s, priority: v }))} options={[1, 2, 3].map((p) => ({ value: String(p), label: t(`planner.priorities.${p}` as MessageKey) }))} />
          <Button title={t("planner.addTask")} onPress={add} />
        </Card>
      ) : null}
      {dayRows.length === 0 && undated.length === 0 ? <EmptyState title={t("mobile.planner.noTasksDay")} description={rows.length === 0 ? t("planner.noTasksBody") : undefined} /> : null}
      {dayRows.map(renderTask)}
      {undated.length > 0 ? (
        <AppText variant="label" muted accessibilityRole="header">
          {t("mobile.planner.undated")}
        </AppText>
      ) : null}
      {undated.map(renderTask)}
    </View>
  );
}

function ExamsTab({ rows, day, editable, showForm, reload }: { rows: ExamRow[]; day: Date; editable: boolean; showForm: boolean; reload: () => void }) {
  const { t, dateTime } = useI18n();
  const { user, supabase: sb } = useUser();
  const write = useWrite(reload);
  const [f, setF] = useState({ title: "", startsAt: "", duration: "", location: "", weight: "" });
  const [errors, setErrors] = useState<Errors>({});
  const dayRows = rows.filter((r) => onDay(r.starts_at, day));
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
      {editable && showForm ? (
        <Card>
          <Input label={t("planner.examTitle")} value={f.title} onChangeText={set("title")} error={errors.title && t(errors.title)} />
          <Input label={t("planner.examStarts")} value={f.startsAt} onChangeText={set("startsAt")} placeholder={DATE_FORMAT} keyboardType="numbers-and-punctuation" autoCapitalize="none" error={errors.startsAt && t(errors.startsAt)} />
          <Input label={`${t("planner.duration")} (${t("common.optional")})`} value={f.duration} onChangeText={set("duration")} keyboardType="number-pad" error={errors.durationMinutes && t(errors.durationMinutes)} />
          <Input label={`${t("planner.location")} (${t("common.optional")})`} value={f.location} onChangeText={set("location")} error={errors.location && t(errors.location)} />
          <Input label={`${t("planner.weight")} (${t("common.optional")})`} value={f.weight} onChangeText={set("weight")} keyboardType="decimal-pad" error={errors.weight && t(errors.weight)} />
          <Button title={t("planner.addExam")} onPress={add} />
        </Card>
      ) : null}
      {dayRows.length === 0 ? (
        <EmptyState title={t("mobile.planner.noExamsDay")} description={rows.length === 0 ? t("planner.noExamsBody") : undefined} />
      ) : (
        dayRows.map((e) => (
          <ItemCard key={e.id} time={hmOf(e.starts_at)} title={e.title} meta={`${dateTime(e.starts_at)}${e.location ? ` · ${e.location}` : ""}`}>
            {editable ? <Button small variant="ghost" title={t("planner.deleteItem")} onPress={() => void write(sb.from("exams").delete().eq("id", e.id))} /> : null}
          </ItemCard>
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

/** Seven day pills (Mon-Sun) for the week of `selected`; tapping selects, arrows move a week. */
function WeekStrip({ selected, onSelect }: { selected: Date; onSelect: (d: Date) => void }) {
  const { t, date } = useI18n();
  const { theme } = useTheme();
  const monday = mondayOf(selected);
  const today = new Date();
  const arrow = (label: string, glyph: string, delta: number) => (
    <PressableScale onPress={() => onSelect(addDays(selected, delta))} accessibilityRole="button" accessibilityLabel={label} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }}>
      <AppText importantForAccessibility="no" style={{ fontSize: 22, lineHeight: 26 }}>
        {glyph}
      </AppText>
    </PressableScale>
  );
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        {arrow(t("mobile.planner.prevWeek"), "‹", -7)}
        <AppText muted>{date(selected, { month: "long", year: "numeric" })}</AppText>
        {arrow(t("mobile.planner.nextWeek"), "›", 7)}
      </View>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {DAYS.map((wd) => {
          const d = addDays(monday, wd - 1);
          const on = sameDay(d, selected);
          const isToday = sameDay(d, today);
          const fg = on ? theme.onPrimary : isToday ? theme.active : theme.text;
          return (
            <PressableScale key={wd} onPress={() => onSelect(d)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={date(d, { weekday: "long", day: "numeric", month: "long" })} style={{ flex: 1, minHeight: 64, borderRadius: 22, borderCurve: "continuous", alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: on ? theme.primary : isToday ? theme.primarySoft : theme.card }}>
              <AppText importantForAccessibility="no" maxFontSizeMultiplier={1.2} style={{ color: fg, fontSize: 11, fontWeight: "500", opacity: on ? 0.85 : 0.7 }}>
                {t(`planner.weekdays.${wd}` as MessageKey).slice(0, 3)}
              </AppText>
              <AppText importantForAccessibility="no" maxFontSizeMultiplier={1.2} style={{ color: fg, fontSize: 20, fontWeight: on ? "600" : "300", fontVariant: ["tabular-nums"] }}>
                {d.getDate()}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

/** `pushed`: opened on the stack (from Home), so it adds the native header with a back button. */
export function PlannerScreen({ pushed = false }: { pushed?: boolean } = {}) {
  const { t, date } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const schedule = useSchedule();
  const [tab, setTab] = useState<Tab>("timetable");
  const [day, setDay] = useState(() => new Date());
  const [showForm, setShowForm] = useState(false);
  const editable = online && schedule.source === "live";
  const d = schedule.data;

  return (
    <Screen ambient style={{ gap: spacing.lg }}>
      {pushed ? <ScreenHeader title={t("planner.title")} /> : null}
      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <HeroTitle muted={t("mobile.planner.heroMuted")} strong={t("mobile.planner.heroStrong")} />
        </View>
        {editable ? <RoundAction tone="accent" icon={<Icon name={showForm ? "close" : "add"} />} label={showForm ? t("mobile.planner.closeForm") : t("mobile.planner.addNew")} onPress={() => setShowForm((v) => !v)} /> : null}
      </View>
      <WeekStrip selected={day} onSelect={setDay} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button small variant="secondary" title={t("nav.focus")} onPress={() => router.push("/focus")} />
        <Button small variant="secondary" title={t("nav.gpa")} onPress={() => router.push("/gpa")} />
      </View>
      {schedule.source === "cache" && schedule.savedAt ? <Notice tone="warning" text={`${t("planner.cachedNotice", { date: date(schedule.savedAt) })} ${t("planner.offlineReadOnly")}`} /> : null}
      <SlidingSegmented
        label={t("planner.tabs.label")}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setShowForm(false);
        }}
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
          {tab === "timetable" ? <TimetableTab rows={d.timetable} day={day} editable={editable} showForm={showForm} reload={schedule.reload} /> : null}
          {tab === "tasks" ? <TasksTab rows={d.tasks} day={day} editable={editable} showForm={showForm} reload={schedule.reload} /> : null}
          {tab === "exams" ? <ExamsTab rows={d.exams} day={day} editable={editable} showForm={showForm} reload={schedule.reload} /> : null}
          <Reminders tasks={d.tasks} exams={d.exams} />
        </>
      )}
    </Screen>
  );
}
