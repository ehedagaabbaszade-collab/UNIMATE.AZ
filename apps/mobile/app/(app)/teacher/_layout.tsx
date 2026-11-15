import { useT } from "@unimate/i18n/react";
import { NativeTabs } from "expo-router/native-tabs";
import { TabInsetContext, useNativeTabsLook, useTabBarClearance } from "../../../src/components/Glass";

/** Teacher mode tab bar: same native tab pattern as the student tabs. */
export default function TeacherLayout() {
  const t = useT();
  const look = useNativeTabsLook();
  const clearance = useTabBarClearance();
  return (
    <TabInsetContext.Provider value={clearance}>
    <NativeTabs {...look}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t("teach.exams.tab")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={"checklist" as never} md={"quiz" as never} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="planner">
        <NativeTabs.Trigger.Label>{t("teach.exams.scheduleTab")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={"calendar" as never} md={"calendar_month" as never} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>{t("brand.module.profile")}</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={"person.fill" as never} md={"person" as never} />
      </NativeTabs.Trigger>
    </NativeTabs>
    </TabInsetContext.Provider>
  );
}
