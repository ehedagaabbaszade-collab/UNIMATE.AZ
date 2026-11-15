import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { Screen, ScreenHeader } from "../../src/components/ui";
import { CoursesScreen } from "../../src/features/semester/CoursesScreen";

export default function Route() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader title={t("semester.title")} onBack={() => router.back()} />
      <CoursesScreen />
    </Screen>
  );
}
