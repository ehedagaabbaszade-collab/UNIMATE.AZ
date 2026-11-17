import { absenceStatus, examTargets, type AbsenceLevel, type GradingRules } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, View } from "react-native";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ExpandCard, Input, Reveal, SkeletonCard } from "../../components/ui";
import { newId, useLocalValue } from "../../lib/local-store";
import { haptic, useReducedMotion } from "../../lib/motion";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { MIN_TOUCH, radii, spacing } from "../../theme/tokens";

import { EMPTY_COURSES as EMPTY, coursesKey, coursesStoreSchema as storeSchema, type Course } from "./store";

const TONE: Record<AbsenceLevel, "success" | "warning" | "danger"> = { ok: "success", warn: "warning", over: "danger" };
const int = (s: string) => (/^\d{1,3}$/.test(s.trim()) ? Number(s.trim()) : null);

function AbsenceMeter({ missed, allowed, level }: { missed: number; allowed: number; level: AbsenceLevel }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const fill = Math.min(1, allowed > 0 ? missed / allowed : 1);
  const anim = useRef(new Animated.Value(fill)).current;
  useEffect(() => {
    if (reduced) anim.setValue(fill);
    else Animated.spring(anim, { toValue: fill, useNativeDriver: true, speed: 14, bounciness: 4 }).start();
  }, [fill, reduced, anim]);
  const color = level === "over" ? theme.danger : level === "warn" ? theme.warning : theme.success;
  return (
    <View style={{ height: 8, borderRadius: radii.pill, backgroundColor: theme.cardStrong, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* GPU-only: scaleX from the left edge (no width/layout animation on low-end Android) */}
      <Animated.View style={{ height: 8, width: "100%", borderRadius: radii.pill, backgroundColor: color, transformOrigin: "left", transform: [{ scaleX: anim }] }} />
    </View>
  );
}

function Stepper({ label, onPress, symbol }: { label: string; onPress: () => void; symbol: string }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({ width: MIN_TOUCH + 4, height: MIN_TOUCH + 4, borderRadius: (MIN_TOUCH + 4) / 2, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? theme.primarySoft : theme.cardStrong, borderWidth: 1, borderColor: theme.border })}
    >
      <AppText variant="title" style={{ lineHeight: 28 }}>
        {symbol}
      </AppText>
    </Pressable>
  );
}

function CourseCard({ course, rules, onChange, onDelete }: { course: Course; rules: GradingRules; onChange: (c: Course) => void; onDelete: () => void }) {
  const { t, number } = useI18n();
  const { theme } = useTheme();
  const s = absenceStatus(course.totalHours, course.missedHours, rules);
  const [scoreText, setScoreText] = useState(course.semesterScore === null ? "" : String(course.semesterScore));
  const score = int(scoreText);
  const scoreValid = score !== null && score <= rules.semesterMax;
  const targets = scoreValid ? examTargets(score, rules) : [];

  const step = (delta: number) => {
    const missed = Math.min(course.totalHours, Math.max(0, course.missedHours + delta));
    if (missed === course.missedHours) return;
    const next = absenceStatus(course.totalHours, missed, rules).level;
    if (delta > 0 && next !== s.level) (next === "over" ? haptic.error : haptic.warning)();
    else haptic.select();
    onChange({ ...course, missedHours: missed });
  };

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <AppText variant="heading" style={{ flex: 1 }}>
          {course.name}
        </AppText>
        <Badge tone={TONE[s.level]}>{t(`semester.level.${s.level}`)}</Badge>
      </View>

      <View style={{ gap: spacing.sm }} accessible accessibilityLabel={t("semester.absenceA11y", { missed: course.missedHours, allowed: s.allowedHours, total: course.totalHours })}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <AppText variant="label">{t("semester.missed", { missed: course.missedHours, allowed: s.allowedHours })}</AppText>
          <AppText variant="caption" muted>
            {number(s.pct / 100, { style: "percent", maximumFractionDigits: 0 })}
          </AppText>
        </View>
        <AbsenceMeter missed={course.missedHours} allowed={s.allowedHours} level={s.level} />
        <AppText variant="caption" style={{ color: s.level === "over" ? theme.danger : s.level === "warn" ? theme.warning : theme.textMuted }}>
          {s.level === "over" ? t("semester.overBody") : t("semester.remaining", { n: Math.max(0, s.remainingHours) })}
        </AppText>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
        <Stepper symbol="−" label={t("semester.removeHour", { name: course.name })} onPress={() => step(-1)} />
        <AppText variant="caption" muted style={{ flex: 1, textAlign: "center" }}>
          {t("semester.logHint")}
        </AppText>
        <Stepper symbol="+" label={t("semester.addHour", { name: course.name })} onPress={() => step(1)} />
      </View>

      <View style={{ gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: theme.border }}>
        <Input
          label={t("semester.semesterScore", { max: rules.semesterMax })}
          value={scoreText}
          keyboardType="number-pad"
          maxLength={3}
          onChangeText={(v) => {
            setScoreText(v);
            const n = int(v);
            onChange({ ...course, semesterScore: n !== null && n <= rules.semesterMax ? n : null });
          }}
          error={scoreText && !scoreValid ? t("semester.scoreInvalid", { max: rules.semesterMax }) : undefined}
          hint={t("semester.attendancePoints", { n: s.attendancePoints, max: rules.attendanceMax })}
        />
        {targets.length > 0 ? (
          <View style={{ gap: spacing.xs }}>
            <AppText variant="label">{t("semester.examNeeds")}</AppText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {targets.map((x) => (
                <View
                  key={x.letter}
                  accessible
                  accessibilityLabel={x.needed === null ? t("semester.targetOut", { letter: x.letter }) : t("semester.targetA11y", { letter: x.letter, n: x.needed })}
                  style={{ minWidth: 56, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: x.needed === null ? theme.cardStrong : theme.primarySoft, alignItems: "center", opacity: x.needed === null ? 0.5 : 1 }}
                >
                  <AppText variant="caption" muted>
                    {x.letter}
                  </AppText>
                  <AppText variant="heading">{x.needed === null ? "—" : number(x.needed)}</AppText>
                </View>
              ))}
            </View>
            <AppText variant="caption" muted>
              {t("semester.examNote", { min: rules.examMin, pass: rules.passTotal })}
            </AppText>
          </View>
        ) : null}
      </View>
      <Button small variant="ghost" title={t("semester.delete")} onPress={onDelete} />
    </Card>
  );
}

export function CoursesScreen() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { user } = useUser();
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
    if (!store.update((s) => ({ ...s, courses: [...s.courses, { id: newId(), name: name.trim().slice(0, 120), totalHours: h, missedHours: 0, semesterScore: null }] }))) {
      haptic.error();
      return setFormError(t("common.genericError"));
    }
    setFormError(null);
    haptic.success();
    setName("");
  }

  function saveRules() {
    const limit = int(ruleText.limit);
    const examMin = int(ruleText.examMin);
    const pass = int(ruleText.pass);
    const ok = limit !== null && limit >= 1 && limit <= 100 && examMin !== null && examMin <= rules.examMax && pass !== null && pass >= 1 && pass <= 100;
    setRulesError(!ok);
    if (!ok) return haptic.error();
    haptic.success();
    store.update((s) => ({ ...s, rules: { ...s.rules, absenceLimitPct: limit, examMin, passTotal: pass } }));
  }

  if (!store.ready) return <SkeletonCard lines={3} />;

  return (
    <View style={{ gap: spacing.lg }}>
      <AppText muted>{t("semester.subtitle")}</AppText>
      {courses.length > 0 ? (
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <Card style={{ flex: 1 }}>
            <AppText variant="display">{courses.length}</AppText>
            <AppText variant="caption" muted>
              {t("semester.courseCount", { n: courses.length })}
            </AppText>
          </Card>
          <Card style={{ flex: 1 }}>
            <AppText variant="display" style={atRisk > 0 ? { color: theme.warning } : undefined}>
              {atRisk}
            </AppText>
            <AppText variant="caption" muted>
              {t("semester.atRisk", { n: atRisk })}
            </AppText>
          </Card>
        </View>
      ) : null}

      {courses.length === 0 ? <EmptyState title={t("semester.emptyTitle")} description={t("semester.emptyBody")} /> : null}
      {courses.map((c, i) => (
        <Reveal key={c.id} index={i}>
          <CourseCard course={c} rules={rules} onChange={(next) => store.update((s) => ({ ...s, courses: s.courses.map((x) => (x.id === next.id ? next : x)) }))} onDelete={() => setPendingDelete(c)} />
        </Reveal>
      ))}

      <Card>
        <AppText variant="heading">{t("semester.addTitle")}</AppText>
        <Input label={t("semester.name")} value={name} onChangeText={setName} maxLength={120} returnKeyType="next" />
        <Input label={t("semester.totalHours")} value={hours} onChangeText={setHours} keyboardType="number-pad" maxLength={3} hint={t("semester.totalHoursHint")} />
        {formError ? (
          <AppText variant="caption" style={{ color: theme.danger }} accessibilityRole="alert">
            {formError}
          </AppText>
        ) : null}
        <Button title={t("semester.add")} onPress={add} />
      </Card>

      <ExpandCard label={t("semester.rulesTitle")} header={<AppText variant="heading">{t("semester.rulesTitle")}</AppText>}>
        <AppText variant="caption" muted>
          {t("semester.rulesBody")}
        </AppText>
        <Input label={t("semester.ruleLimit")} value={ruleText.limit} onChangeText={(v) => setRuleText((r) => ({ ...r, limit: v }))} keyboardType="number-pad" maxLength={3} />
        <Input label={t("semester.ruleExamMin")} value={ruleText.examMin} onChangeText={(v) => setRuleText((r) => ({ ...r, examMin: v }))} keyboardType="number-pad" maxLength={3} />
        <Input label={t("semester.rulePass")} value={ruleText.pass} onChangeText={(v) => setRuleText((r) => ({ ...r, pass: v }))} keyboardType="number-pad" maxLength={3} error={rulesError ? t("semester.rulesInvalid") : undefined} />
        <Button small variant="secondary" title={t("common.save")} onPress={saveRules} />
      </ExpandCard>

      <AppText variant="caption" muted>
        {t("semester.privacy")}
      </AppText>

      <Dialog
        open={pendingDelete !== null}
        title={t("semester.deleteTitle")}
        onClose={() => setPendingDelete(null)}
        actions={
          <>
            <Button
              variant="danger"
              title={t("semester.delete")}
              onPress={() => {
                const id = pendingDelete?.id;
                setPendingDelete(null);
                if (id) store.update((s) => ({ ...s, courses: s.courses.filter((x) => x.id !== id) }));
              }}
            />
            <Button variant="ghost" title={t("common.cancel")} onPress={() => setPendingDelete(null)} />
          </>
        }
      >
        <AppText muted>{t("semester.deleteBody", { name: pendingDelete?.name ?? "" })}</AppText>
      </Dialog>
    </View>
  );
}
