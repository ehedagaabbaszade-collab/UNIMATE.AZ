import { useI18n } from "@unimate/i18n/react";
import { Screen, ScreenHeader } from "../../src/components/ui";
import { WritingScreen } from "../../src/features/writing/WritingScreen";

export default function WritingRoute() {
  const { t } = useI18n();
  return (
    <Screen>
      <ScreenHeader title={t("writing.title")} />
      <WritingScreen />
    </Screen>
  );
}
