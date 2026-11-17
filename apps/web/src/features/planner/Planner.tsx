"use client";

import { Badge, Button, EmptyState, ErrorState, Input, Select, Skeleton, Tabs, useOnlineStatus, useToast } from "@unimate/ui";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/user";
import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import type { ExamRow, TaskRow, TimetableRow } from "@/lib/db";
import { examSchema, fieldErrors, taskSchema, timetableSchema } from "@/lib/schemas";
import { getBrowserClient } from "@/lib/supabase/browser";
import { groupByWeekday, hhmm, isOverdue, localInputToIso } from "./schedule";
import { useSchedule } from "./useSchedule";

type Errors = Record<string, MessageKey>;

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
  const user = useUser();
  const write = useWrite(reload);
  const [errors, setErrors] = useState<Errors>({});
  const [formKey, setFormKey] = useState(0);
  const grouped = groupByWeekday(rows);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const parsed = timetableSchema.safeParse({ title: fd.get("title"), weekday: fd.get("weekday"), startTime: fd.get("startTime"), endTime: fd.get("endTime"), location: fd.get("location") ?? "" });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const v = parsed.data;
    const ok = await write(getBrowserClient().from("timetable_entries").insert({ user_id: user.id, title: v.title, weekday: v.weekday, start_time: v.startTime, end_time: v.endTime, location: v.location }));
    if (ok) setFormKey((k) => k + 1);
  }

  return (
    <div className="stack-lg">
      {editable ? (
        <form key={formKey} onSubmit={onSubmit} noValidate className="form-grid">
          <div className="span-all"><Input name="title" label={t("planner.classTitle")} error={errors.title && t(errors.title)} /></div>
          <Select name="weekday" label={t("planner.weekday")} defaultValue="1">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <option key={d} value={d}>{t(`planner.weekdays.${d}` as MessageKey)}</option>
            ))}
          </Select>
          <Input name="startTime" type="time" label={t("planner.start")} defaultValue="09:00" error={errors.startTime && t(errors.startTime)} />
          <Input name="endTime" type="time" label={t("planner.end")} defaultValue="10:30" error={errors.endTime && t(errors.endTime)} />
          <Input name="location" label={`${t("planner.location")} (${t("common.optional")})`} error={errors.location && t(errors.location)} />
          <Button type="submit">{t("planner.addClass")}</Button>
        </form>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={t("planner.noClasses")} description={t("planner.noClassesBody")} />
      ) : (
        <div className="week">
          {[1, 2, 3, 4, 5, 6, 7].filter((d) => grouped.has(d)).map((d) => (
            <section key={d} className="day" aria-labelledby={`day-${d}`}>
              <h3 id={`day-${d}`}>{t(`planner.weekdays.${d}` as MessageKey)}</h3>
              <ul className="list">
                {grouped.get(d)!.map((c) => (
                  <li key={c.id} className="list-item">
                    <div className="list-item__main">
                      <span className="list-item__title">{c.title}</span>
                      <span className="list-item__meta">{hhmm(c.start_time)}–{hhmm(c.end_time)}{c.location ? ` · ${c.location}` : ""}</span>
                    </div>
                    {editable ? <Button size="sm" variant="ghost" onClick={() => void write(getBrowserClient().from("timetable_entries").delete().eq("id", c.id))}>{t("planner.deleteItem")}</Button> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TasksTab({ rows, editable, reload }: { rows: TaskRow[]; editable: boolean; reload: () => void }) {
  const { t, dateTime } = useI18n();
  const user = useUser();
  const write = useWrite(reload);
  const [errors, setErrors] = useState<Errors>({});
  const [formKey, setFormKey] = useState(0);
  const now = new Date();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const due = String(fd.get("dueAt") ?? "");
    const parsed = taskSchema.safeParse({ title: fd.get("title"), dueAt: due ? localInputToIso(due) : "", priority: fd.get("priority") });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const ok = await write(getBrowserClient().from("tasks").insert({ user_id: user.id, title: parsed.data.title, due_at: parsed.data.dueAt, priority: parsed.data.priority }));
    if (ok) setFormKey((k) => k + 1);
  }

  // tasks_check: (status = 'done') = (completed_at is not null), so both must change together.
  const toggle = (task: TaskRow) =>
    write(getBrowserClient().from("tasks").update(task.status === "done" ? { status: "todo", completed_at: null } : { status: "done", completed_at: new Date().toISOString() }).eq("id", task.id));

  return (
    <div className="stack-lg">
      {editable ? (
        <form key={formKey} onSubmit={onSubmit} noValidate className="form-grid">
          <div className="span-all"><Input name="title" label={t("planner.taskTitle")} error={errors.title && t(errors.title)} /></div>
          <Input name="dueAt" type="datetime-local" label={`${t("planner.due")} (${t("common.optional")})`} error={errors.dueAt && t(errors.dueAt)} />
          <Select name="priority" label={t("planner.priority")} defaultValue="2">
            {[1, 2, 3].map((p) => (
              <option key={p} value={p}>{t(`planner.priorities.${p}` as MessageKey)}</option>
            ))}
          </Select>
          <Button type="submit">{t("planner.addTask")}</Button>
        </form>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={t("planner.noTasks")} description={t("planner.noTasksBody")} />
      ) : (
        <ul className="list">
          {rows.map((task) => (
            <li key={task.id} className="list-item">
              <div className="list-item__main">
                <span className="list-item__title" style={task.status === "done" ? { textDecoration: "line-through", opacity: 0.7 } : undefined}>{task.title}</span>
                <span className="list-item__meta">
                  {task.due_at ? dateTime(task.due_at) : t("common.none")} · {t(`planner.priorities.${task.priority}` as MessageKey)}
                </span>
              </div>
              <div className="row">
                {isOverdue(task, now) ? <Badge tone="danger">{t("planner.overdue")}</Badge> : <Badge tone={task.status === "done" ? "success" : "neutral"}>{t(`planner.status.${task.status}`)}</Badge>}
                {editable ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => void toggle(task)}>{task.status === "done" ? t("planner.markTodo") : t("planner.markDone")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void write(getBrowserClient().from("tasks").delete().eq("id", task.id))}>{t("planner.deleteItem")}</Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamsTab({ rows, editable, reload }: { rows: ExamRow[]; editable: boolean; reload: () => void }) {
  const { t, dateTime } = useI18n();
  const user = useUser();
  const write = useWrite(reload);
  const [errors, setErrors] = useState<Errors>({});
  const [formKey, setFormKey] = useState(0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const starts = String(fd.get("startsAt") ?? "");
    const parsed = examSchema.safeParse({ title: fd.get("title"), startsAt: starts ? localInputToIso(starts) : "", durationMinutes: fd.get("durationMinutes"), location: fd.get("location") ?? "", weight: fd.get("weight") });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const v = parsed.data;
    const ok = await write(getBrowserClient().from("exams").insert({ user_id: user.id, title: v.title, starts_at: v.startsAt, duration_minutes: v.durationMinutes, location: v.location, weight: v.weight }));
    if (ok) setFormKey((k) => k + 1);
  }

  return (
    <div className="stack-lg">
      {editable ? (
        <form key={formKey} onSubmit={onSubmit} noValidate className="form-grid">
          <div className="span-all"><Input name="title" label={t("planner.examTitle")} error={errors.title && t(errors.title)} /></div>
          <Input name="startsAt" type="datetime-local" label={t("planner.examStarts")} error={errors.startsAt && t(errors.startsAt)} />
          <Input name="durationMinutes" type="number" inputMode="numeric" min={1} max={720} label={`${t("planner.duration")} (${t("common.optional")})`} error={errors.durationMinutes && t(errors.durationMinutes)} />
          <Input name="location" label={`${t("planner.location")} (${t("common.optional")})`} />
          <Input name="weight" type="number" inputMode="decimal" min={0} max={100} step="any" label={`${t("planner.weight")} (${t("common.optional")})`} error={errors.weight && t(errors.weight)} />
          <Button type="submit">{t("planner.addExam")}</Button>
        </form>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={t("planner.noExams")} description={t("planner.noExamsBody")} />
      ) : (
        <ul className="list">
          {rows.map((x) => (
            <li key={x.id} className="list-item">
              <div className="list-item__main">
                <span className="list-item__title">{x.title}</span>
                <span className="list-item__meta">{[dateTime(x.starts_at), x.duration_minutes ? t("dashboard.minutes", { n: x.duration_minutes }) : null, x.location, x.weight != null ? `${x.weight}%` : null].filter(Boolean).join(" · ")}</span>
              </div>
              {editable ? <Button size="sm" variant="ghost" onClick={() => void write(getBrowserClient().from("exams").delete().eq("id", x.id))}>{t("planner.deleteItem")}</Button> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Planner() {
  const { t, dateTime } = useI18n();
  const online = useOnlineStatus();
  const s = useSchedule();
  const editable = online && s.source === "live";
  const tab = useSearchParams().get("tab"); // deep links from the dashboard and command palette

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("planner.title")}</h1>
      </div>
      {s.source === "cache" && s.savedAt ? <p className="warn-box" role="status">{t("planner.cachedNotice", { date: dateTime(s.savedAt) })} {t("planner.offlineReadOnly")}</p> : null}
      {s.loading && !s.data ? (
        <Skeleton height={220} />
      ) : s.error || !s.data ? (
        <ErrorState title={t("planner.loadFailed")} description={s.error ?? undefined} action={<Button onClick={s.reload}>{t("common.retry")}</Button>} />
      ) : (
        <Tabs
          key={tab ?? "timetable"}
          defaultId={tab === "tasks" || tab === "exams" ? tab : "timetable"}
          label={t("planner.tabs.label")}
          items={[
            { id: "timetable", label: t("planner.tabs.timetable"), content: <TimetableTab rows={s.data.timetable} editable={editable} reload={s.reload} /> },
            { id: "tasks", label: t("planner.tabs.tasks"), content: <TasksTab rows={s.data.tasks} editable={editable} reload={s.reload} /> },
            { id: "exams", label: t("planner.tabs.exams"), content: <ExamsTab rows={s.data.exams} editable={editable} reload={s.reload} /> },
          ]}
        />
      )}
    </div>
  );
}
