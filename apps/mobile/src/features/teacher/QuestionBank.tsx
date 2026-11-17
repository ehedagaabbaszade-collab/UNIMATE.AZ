import { questionBank, type Exam, type ExamQuestion } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useMemo, useState } from "react";
import { Modal, SectionList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Button, PressableScale, SearchField } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { radii, spacing } from "../../theme/tokens";

const fold = (s: string) => s.toLocaleLowerCase("az").normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i");

/** Full-screen sheet over every question in the teacher's other saved exams; tapping one copies it into the exam. */
export function QuestionBank({ open, exams, excludeId, onAdd, onClose }: { open: boolean; exams: readonly Exam[]; excludeId: string; onAdd: (q: ExamQuestion) => void; onClose: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [q, setQ] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const sections = useMemo(() => {
    const needle = fold(q.trim());
    const by = new Map<string, { title: string; data: ReturnType<typeof questionBank> }>();
    for (const b of questionBank(exams, excludeId)) {
      if (needle && !fold(`${b.question.text} ${b.question.options.join(" ")} ${b.subject}`).includes(needle)) continue;
      const s = by.get(b.examId) ?? { title: b.subject ? `${b.examTitle} · ${b.subject}` : b.examTitle, data: [] };
      s.data.push(b);
      by.set(b.examId, s);
    }
    return [...by.values()];
  }, [exams, excludeId, q]);

  return (
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: theme.bg }}>
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AppText variant="title" accessibilityRole="header">
              {t("teach.exams.bank")}
            </AppText>
            <Button small variant="secondary" title={t("common.close")} onPress={onClose} />
          </View>
          <SearchField label={t("teach.exams.bankSearch")} placeholder={t("teach.exams.bankSearch")} value={q} onChangeText={setQ} autoCorrect={false} />
        </View>
        <SectionList
          sections={sections}
          keyExtractor={(b) => `${b.examId}:${b.question.id}`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm }}
          ListEmptyComponent={<AppText muted>{t("teach.exams.bankEmpty")}</AppText>}
          renderSectionHeader={({ section }) => (
            <AppText variant="label" muted style={{ paddingTop: spacing.md, paddingBottom: spacing.xs }}>
              {section.title}
            </AppText>
          )}
          renderItem={({ item }) => {
            const key = `${item.examId}:${item.question.id}`;
            const done = added.has(key);
            return (
              <PressableScale
                onPress={() => {
                  onAdd(item.question);
                  setAdded((s) => new Set(s).add(key));
                }}
                accessibilityRole="button"
                accessibilityLabel={`${item.question.text}${done ? `, ${t("teach.exams.bankAdded")}` : ""}`}
                style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderCurve: "continuous", backgroundColor: theme.card }}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText numberOfLines={2}>{item.question.text}</AppText>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <Badge tone="neutral">{item.question.kind === "choice" ? t("teach.exams.kindChoice") : t("teach.exams.kindOpen")}</Badge>
                    <Badge tone="neutral">{`${item.question.points} ${t("teach.exams.print.points")}`}</Badge>
                  </View>
                </View>
                <Icon name={done ? "check" : "add"} color={done ? theme.success : theme.active} />
              </PressableScale>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}
