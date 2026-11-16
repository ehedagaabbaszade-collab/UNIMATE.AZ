"use client";

import { absenceStatus, examTargets, type AbsenceLevel, type GradingRules } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, EmptyState, Input } from "@unimate/ui";
import { useEffect, useState } from "react";
import { useUser } from "@/components/user";
import { newId, useLocalValue } from "@/lib/local-value";
import s from "./CoursesPage.module.css";
import { EMPTY_COURSES as EMPTY, coursesKey, coursesStoreSchema as storeSchema, type Course } from "./store";

const TONE: Record<AbsenceLevel, "success" | "warning" | "danger"> = { ok: "success", warn: "warning", over: "danger" };
const int = (v: string) => (/^\d{1,3}$/.test(v.trim()) ? Number(v.trim()) : null);

function CourseCard({ course, rules, onChange, onDelete }: { course: Course; rules: GradingRules; onChange: (c: Course) => void; onDelete: () => void }) {
  const { t, number } = useI18n();
  const st = absenceStatus(course.totalHours, course.missedHours, rules);
  const [scoreText, setScoreText] = useState(course.semesterScore === null ? "" : String(course.semesterScore));
  const score = int(scoreText);
  const scoreValid = score !== null && score <= rules.semesterMax;
  const targets = scoreValid ? examTargets(score, rules) : [];
  const step = (delta: number) => {
    const missed = Math.min(course.totalHours, Math.max(0, course.missedHours + delta));
    if (missed !== course.missedHours) onChange({ ...course, missedHours: missed });
  };
  const fill = Math.min(1, st.allowedHours > 0 ? course.missedHours / st.allowedHours : 1);

  return (
    <Card>
      <div className="stack">
        <div className="row row--between">
          <h2>{course.name}</h2>
          <Badge tone={TONE[st.level]}>{t(`semester.level.${st.level}`)}</Badge>
        </div>
        <div className="stack" role="group" aria-label={t("semester.absenceA11y", { missed: course.missedHours, allowed: st.allowedHours, total: course.totalHours })}>
          <div className="row row--between">
            <span>{t("semester.missed", { missed: course.missedHours, allowed: st.allowedHours })}</span>
            <small>{number(st.pct / 100, { style: "percent", maximumFractionDigits: 0 })}</small>
          </div>
          <div className={s.bar} aria-hidden="true">
            <div className={`${s.fill} ${s[st.level]}`} style={{ transform: `scaleX(${fill})` }} />
          </div>
          <small className="um-hint">{st.level === "over" ? t("semester.overBody") : t("semester.remaining", { n: Math.max(0, st.remainingHours) })}</small>
        </div>
        <div className="row">
          <button type="button" className={s.step} aria-label={t("semester.removeHour", { name: course.name })} onClick={() => step(-1)}>−</button>
          <small className={`um-hint ${s.hint}`}>{t("semester.logHint")}</small>
          <button type="button" className={s.step} aria-label={t("semester.addHour", { name: course.name })} onClick={() => step(1)}>+</button>
        </div>
        <Input
          label={t("semester.semesterScore", { max: rules.semesterMax })}
          value={scoreText}
          inputMode="numeric"
          maxLength={3}
          onChange={(e) => {
            const v = e.target.value;
            setScoreText(v);
            const n = int(v);
            onChange({ ...course, semesterScore: n !== null && n <= rules.semesterMax ? n : null });
          }}
          error={scoreText && !scoreValid ? t("semester.scoreInvalid", { max: rules.semesterMax }) : undefined}
          hint={t("semester.attendancePoints", { n: st.attendancePoints, max: rules.attendanceMax })}
        />
        {targets.length > 0 ? (
          <div className="stack">
            <strong>{t("semester.examNeeds")}</strong>
            <div className={s.targets}>
              {targets.map((x) => (
                <div key={x.letter} className={`${s.target} ${x.needed === null ? s.out : ""}`} aria-label={x.needed === null ? t("semester.targetOut", { letter: x.letter }) : t("semester.targetA11y", { letter: x.letter, n: x.needed })} role="group">
                  <small>{x.letter}</small>
                  <strong>{x.needed === null ? "—" : number(x.needed)}</strong>
                </div>
              ))}
            </div>
            <small className="um-hint">{t("semester.examNote", { min: rules.examMin, pass: rules.passTotal })}</small>
          </div>
        ) : null}
        <div>
          <Button variant="ghost" size="sm" onClick={onDelete}>{t("semester.delete")}</Button>
        </div>
      </div>
    </Card>
  );
}

export function CoursesPage() {
  const { t } = useI18n();
  const user = useUser();
  const store = useLocalValue(coursesKey(user.id), storeSchema, EMPTY);
  const { courses, rules } = store.value;
  const [name, setName] = useState("");
  const [hours, setHours] = useState("60");
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Course | null>(null);
  const [ruleText, setRuleText] = useState({ limit: String(rules.absenceLimitPct), examMin: String(rules.examMin), pass: String(rules.passTotal) });
  useEffect(() => setRuleText({ limit: String(rules.absenceLimitPct), examMin: String(rules.examMin), pass: String(rules.passTotal) }), [rules.absenceLimitPct, rules.examMin, rules.passTotal]);
  const [rulesError, setRulesError] = useState(false);

  const atRisk = courses.filter((c) => absenceStatus(c.totalHours, c.missedHours, rules).level !== "ok").length;

  function add() {
    const h = int(hours);
    if (!name.trim()) return setFormError(t("semester.nameRequired"));
    if (h === null || h < 1 || h > 600) return setFormError(t("semester.hoursInvalid"));
    if (courses.length >= 40) return setFormError(t("semester.tooMany"));
    if (!store.update((st) => ({ ...st, courses: [...st.courses, { id: newId(), name: name.trim().slice(0, 120), totalHours: h, missedHours: 0, semesterScore: null }] }))) return setFormError(t("common.genericError"));
    setFormError(null);
    setName("");
  }

  function saveRules() {
    const limit = int(ruleText.limit);
    const examMin = int(ruleText.examMin);
    const pass = int(ruleText.pass);
    const ok = limit !== null && limit >= 1 && limit <= 100 && examMin !== null && examMin <= rules.examMax && pass !== null && pass >= 1 && pass <= 100;
    setRulesError(!ok);
    if (!ok) return;
    store.update((st) => ({ ...st, rules: { ...st.rules, absenceLimitPct: limit, examMin, passTotal: pass } }));
  }

  if (!store.ready) return null;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("semester.title")}</h1>
        <p>{t("semester.subtitle")}</p>
      </div>
      {courses.length > 0 ? (
        <div className="grid-2">
          <Card>
            <strong>{courses.length}</strong>
            <p className="um-hint">{t("semester.courseCount", { n: courses.length })}</p>
          </Card>
          <Card>
            <strong>{atRisk}</strong>
            <p className="um-hint">{t("semester.atRisk", { n: atRisk })}</p>
          </Card>
        </div>
      ) : (
        <EmptyState title={t("semester.emptyTitle")} description={t("semester.emptyBody")} />
      )}
      {courses.map((c) => (
        <CourseCard key={c.id} course={c} rules={rules} onChange={(next) => store.update((st) => ({ ...st, courses: st.courses.map((x) => (x.id === next.id ? next : x)) }))} onDelete={() => setPendingDelete(c)} />
      ))}

      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <h2>{t("semester.addTitle")}</h2>
          <Input label={t("semester.name")} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          <Input label={t("semester.totalHours")} value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" maxLength={3} hint={t("semester.totalHoursHint")} />
          {formError ? <p className="err-box" role="alert">{formError}</p> : null}
          <div>
            <Button type="submit">{t("semester.add")}</Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="stack">
          <h2>{t("semester.rulesTitle")}</h2>
          <p className="um-hint">{t("semester.rulesBody")}</p>
          <Input label={t("semester.ruleLimit")} value={ruleText.limit} onChange={(e) => setRuleText((r) => ({ ...r, limit: e.target.value }))} inputMode="numeric" maxLength={3} />
          <Input label={t("semester.ruleExamMin")} value={ruleText.examMin} onChange={(e) => setRuleText((r) => ({ ...r, examMin: e.target.value }))} inputMode="numeric" maxLength={3} />
          <Input label={t("semester.rulePass")} value={ruleText.pass} onChange={(e) => setRuleText((r) => ({ ...r, pass: e.target.value }))} inputMode="numeric" maxLength={3} error={rulesError ? t("semester.rulesInvalid") : undefined} />
          <div>
            <Button variant="secondary" size="sm" onClick={saveRules}>{t("common.save")}</Button>
          </div>
        </div>
      </Card>

      <p className="um-hint">{t("semester.privacy")}</p>

      <Dialog
        open={pendingDelete !== null}
        title={t("semester.deleteTitle")}
        onClose={() => setPendingDelete(null)}
        actions={
          <>
            <Button variant="danger" onClick={() => {
              const id = pendingDelete?.id;
              setPendingDelete(null);
              if (id) store.update((st) => ({ ...st, courses: st.courses.filter((x) => x.id !== id) }));
            }}>{t("semester.delete")}</Button>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>{t("common.cancel")}</Button>
          </>
        }
      >
        <p>{t("semester.deleteBody", { name: pendingDelete?.name ?? "" })}</p>
      </Dialog>
    </div>
  );
}
