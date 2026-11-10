import { useI18n } from "@unimate/i18n/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen, ScreenHeader } from "../../../src/components/ui";
import { QuizTaker } from "../../../src/features/study/QuizTaker";

export default function QuizRoute() {
  const { t } = useI18n();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen>
      <ScreenHeader title={t("documents.tabs.quiz")} onBack={() => router.back()} />
      <QuizTaker quizId={String(id)} onExit={() => router.back()} />
    </Screen>
  );
}
