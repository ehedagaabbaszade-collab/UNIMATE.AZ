import { useI18n } from "@unimate/i18n/react";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import type { ComponentType } from "react";
import { TabInsetContext } from "../../../src/components/Glass";
import { CampusScreen } from "../../../src/features/campus/CampusScreen";
import { CareerScreen } from "../../../src/features/career/CareerScreen";
import { DocumentsScreen } from "../../../src/features/documents/DocumentsScreen";
import { MODULES } from "../../../src/lib/registry";

/** Tab modules opened while not pinned: their tab is hidden, so they get a normal stack page with a back button. */
const SCREENS: Record<string, ComponentType> = { career: CareerScreen, campus: CampusScreen, aiStudy: DocumentsScreen };

export default function ModuleRoute() {
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const m = MODULES.find((x) => x.id === id);
  const Screen = id ? SCREENS[id] : undefined;
  if (!m || !Screen) return <Redirect href="/" />;
  return (
    <TabInsetContext.Provider value={0}>
      <Stack.Screen options={{ headerShown: true, title: t(m.labelKey) }} />
      <Screen />
    </TabInsetContext.Provider>
  );
}
