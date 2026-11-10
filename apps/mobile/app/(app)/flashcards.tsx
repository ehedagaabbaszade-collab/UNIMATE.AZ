import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { Screen, ScreenHeader } from "../../src/components/ui";
import { CardsView } from "../../src/features/study/Flashcards";

/** Review across all documents (due cards first). Scheduling and XP are server-side (review_flashcard). */
export default function FlashcardsRoute() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader title={t("nav.flashcards")} onBack={() => router.back()} />
      <CardsView />
    </Screen>
  );
}
