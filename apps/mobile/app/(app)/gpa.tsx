import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { Screen, ScreenHeader } from "../../src/components/ui";
import { GpaCalculator } from "../../src/features/planner/GpaCalculator";

export default function GpaRoute() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader title={t("gpa.title")} onBack={() => router.back()} />
      <GpaCalculator />
    </Screen>
  );
}
