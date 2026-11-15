import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { Screen, ScreenHeader } from "../../src/components/ui";
import { BudgetScreen } from "../../src/features/budget/BudgetScreen";

export default function Route() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader title={t("budget.title")} onBack={() => router.back()} />
      <BudgetScreen />
    </Screen>
  );
}
