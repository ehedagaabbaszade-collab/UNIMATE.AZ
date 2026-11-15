import { ExamStoreSchema, examTotalPoints } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef } from "react";
import { View } from "react-native";
import { AppText, Button, Card, EmptyState, HeroTitle, PressableScale, Screen } from "../../components/ui";
import { useLocalValue } from "../../lib/local-store";
import { examsKey } from "../../lib/storage";
import { useUser } from "../../state/session";
import { spacing } from "../../theme/tokens";

/** Teacher home: the exams saved on this device. */
export function ExamsScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useUser();
  const store = useLocalValue(examsKey(user.id), ExamStoreSchema, { exams: [] });
  const reload = store.reload;
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reload(); // the editor may have saved or deleted an exam
    }, [reload]),
  );
  const open = (id: string) => router.push({ pathname: "/exam-edit", params: { id } } as Href);
  const exams = store.value.exams;
  return (
    <Screen ambient>
      <HeroTitle muted={t("teach.exams.heroMuted")} strong={t("teach.exams.heroStrong")} />
      {exams.length === 0 && store.ready ? (
        <EmptyState title={t("teach.exams.emptyTitle")} description={t("teach.exams.emptyBody")} action={<Button title={t("teach.exams.new")} onPress={() => open("new")} />} />
      ) : (
        <>
          {exams.map((e) => (
            <PressableScale key={e.id} onPress={() => open(e.id)} accessibilityRole="button" accessibilityLabel={e.title}>
              <Card style={{ gap: 4 }}>
                <AppText variant="heading">{e.title}</AppText>
                {e.subject || e.group ? <AppText muted>{[e.subject, e.group].filter(Boolean).join(" · ")}</AppText> : null}
                <AppText variant="caption" muted>
                  {t("teach.exams.meta", { q: e.questions.length, p: examTotalPoints(e), m: e.minutes })}
                </AppText>
              </Card>
            </PressableScale>
          ))}
          {store.ready ? (
            <View style={{ paddingTop: spacing.sm }}>
              <Button title={t("teach.exams.new")} onPress={() => open("new")} />
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
