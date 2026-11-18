import { checkBirthDate, todayInBaku } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useMemo, useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PickerField } from "../../components/PickerField";
import { AppText, Button, PressableScale } from "../../components/ui";
import { legal, type LegalSlug } from "../../lib/legal";
import { useTheme } from "../../theme/ThemeProvider";
import { MIN_TOUCH, spacing } from "../../theme/tokens";

export type ConsentType = "terms" | "privacy_notice" | "ai_disclaimer" | "marketing";
export type Checked = Partial<Record<ConsentType, boolean>>;

const META: Record<ConsentType, { key: MessageKey; slug?: LegalSlug }> = {
  terms: { key: "consent.terms", slug: "terms" },
  privacy_notice: { key: "consent.privacy", slug: "privacy" },
  ai_disclaimer: { key: "consent.ai", slug: "ai-disclaimer" },
  marketing: { key: "consent.marketing" },
};

export function birthIssue(birth: string): MessageKey | null {
  if (!birth) return "consent.errBirthRequired";
  const r = checkBirthDate(birth, todayInBaku());
  return r === "ok" ? null : r === "underage" ? "consent.errUnderage" : r === "future" ? "consent.errFuture" : "consent.errInvalid";
}

const two = (n: number) => String(n).padStart(2, "0");
const opts = (from: number, to: number) => {
  const out: Array<{ id: string; label: string }> = [];
  for (let n = from; from <= to ? n <= to : n >= to; n += from <= to ? 1 : -1) out.push({ id: String(n), label: String(n) });
  return out;
};

/** Day / month / year pickers (works in Expo Go, no native date module). Reports "YYYY-MM-DD" once all three are set, else "". */
export function BirthDateField({ onChange, error }: { onChange: (iso: string) => void; error?: string | undefined }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [p, setP] = useState({ d: "", m: "", y: "" });
  const days = useMemo(() => [{ data: opts(1, 31) }], []);
  const months = useMemo(() => [{ data: opts(1, 12) }], []);
  const years = useMemo(() => [{ data: opts(Number(todayInBaku().slice(0, 4)), 1900) }], []);
  const set = (k: "d" | "m" | "y") => (v: string) => {
    const n = { ...p, [k]: v };
    setP(n);
    onChange(n.d && n.m && n.y ? `${n.y}-${two(Number(n.m))}-${two(Number(n.d))}` : "");
  };
  return (
    <View style={{ gap: 6 }}>
      <AppText variant="label" accessibilityRole="header">
        {t("consent.birthDate")}
      </AppText>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <PickerField label={t("consent.day")} sections={days} value={p.d} onChange={set("d")} />
        </View>
        <View style={{ flex: 1 }}>
          <PickerField label={t("consent.month")} sections={months} value={p.m} onChange={set("m")} />
        </View>
        <View style={{ flex: 1.2 }}>
          <PickerField label={t("consent.year")} sections={years} value={p.y} onChange={set("y")} searchable />
        </View>
      </View>
      {error ? (
        <AppText variant="caption" style={{ color: theme.danger }}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/** Required consent checkboxes (document names open the text in a modal) plus the optional marketing one. */
export function ConsentChecks({ types, checked, onCheck, marketing }: { types: ConsentType[]; checked: Checked; onCheck: (t: ConsentType, v: boolean) => void; marketing?: boolean }) {
  const { t, locale } = useI18n();
  const { theme } = useTheme();
  const [doc, setDoc] = useState<LegalSlug | null>(null);
  const d = doc ? legal[locale][doc] : null;
  const row = (type: ConsentType) => {
    const { key, slug } = META[type];
    const on = !!checked[type];
    const m = /^([\s\S]*?)\[([\s\S]+?)\]([\s\S]*)$/.exec(t(key));
    return (
      <PressableScale key={type} scaleTo={0.99} onPress={() => onCheck(type, !on)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={t(key).replace(/[[\]]/g, "")} style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start", minHeight: MIN_TOUCH }}>
        <View style={{ width: 24, height: 24, marginTop: 2, borderRadius: 7, borderWidth: 1.5, borderColor: on ? theme.active : theme.border, backgroundColor: on ? theme.active : "transparent", alignItems: "center", justifyContent: "center" }}>
          {on ? <AppText importantForAccessibility="no" style={{ color: theme.onPrimary, fontSize: 15, lineHeight: 18, fontWeight: "700" }}>✓</AppText> : null}
        </View>
        <AppText style={{ flex: 1 }}>
          {m && slug ? (
            <>
              {m[1]}
              <AppText accessibilityRole="link" onPress={() => setDoc(slug)} style={{ textDecorationLine: "underline", color: theme.active }}>
                {m[2]}
              </AppText>
              {m[3]}
            </>
          ) : (
            t(key)
          )}
        </AppText>
      </PressableScale>
    );
  };
  return (
    <View style={{ gap: spacing.md }}>
      {types.map(row)}
      {marketing ? (
        <View style={{ gap: spacing.sm, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: spacing.md }}>
          <AppText variant="caption" muted>
            {t("consent.optionalLabel")}
          </AppText>
          {row("marketing")}
        </View>
      ) : null}
      <Modal visible={!!d} animationType="slide" onRequestClose={() => setDoc(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
            <AppText variant="title" accessibilityRole="header">
              {d?.title}
            </AppText>
            {d?.sections.map((s) => (
              <View key={s.h} style={{ gap: spacing.sm }}>
                <AppText variant="label">{s.h}</AppText>
                {s.p?.map((p, i) => <AppText key={i}>{p}</AppText>)}
                {s.ul?.map((li, i) => <AppText key={i}>{`• ${li}`}</AppText>)}
              </View>
            ))}
          </ScrollView>
          <View style={{ padding: spacing.lg }}>
            <Button title={t("common.close")} variant="secondary" onPress={() => setDoc(null)} />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
