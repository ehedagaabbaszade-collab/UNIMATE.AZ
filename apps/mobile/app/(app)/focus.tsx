import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { Screen, ScreenHeader } from "../../src/components/ui";
import { Pomodoro } from "../../src/features/planner/Pomodoro";

export default function FocusRoute() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader title={t("focus.title")} onBack={() => router.back()} />
      <Pomodoro />
    </Screen>
  );
}
