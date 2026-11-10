import { useT } from "@unimate/i18n/react";
import { NativeTabs } from "expo-router/native-tabs";
import { overflowTabModules, tabModules } from "../../../src/lib/registry";
import { useTheme } from "../../../src/theme/ThemeProvider";

/** Native tab symbols per tab route: SF Symbols on iOS, Material icons on Android. Unknown routes fall back to a dot. */
const ICONS: Record<string, { sf: string; md: string }> = {
  index: { sf: "house.fill", md: "home" },
  study: { sf: "sparkles", md: "auto_awesome" },
  notes: { sf: "doc.text.fill", md: "description" },
  campus: { sf: "building.columns.fill", md: "school" },
  career: { sf: "briefcase.fill", md: "work" },
  planner: { sf: "calendar", md: "calendar_month" },
  profile: { sf: "person.fill", md: "person" },
};
const iconFor = (route: string) => ICONS[route] ?? { sf: "circle.fill", md: "circle" };

/**
 * Bottom navigation: the system's native tab bar (UITabBarController via react-native-screens). On iOS 26 this is
 * the real Liquid Glass tab bar rendered by the OS; on Android it is the Material 3 navigation bar; on older iOS it
 * is the standard translucent tab bar. Tabs are still derived from the module registry (src/lib/registry.ts).
 */
export default function TabsLayout() {
  const t = useT();
  const { theme } = useTheme();
  const modules = tabModules();
  const hidden = overflowTabModules();
  const icon = (route: string) => {
    const i = iconFor(route);
    return <NativeTabs.Trigger.Icon sf={i.sf as never} md={i.md as never} />;
  };
  return (
    <NativeTabs tintColor={theme.active} iconColor={theme.textMuted} labelStyle={{ color: theme.textMuted }} backgroundColor={theme.mode === "dark" ? theme.bg : undefined}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>{t("nav.dashboard")}</NativeTabs.Trigger.Label>
        {icon("index")}
      </NativeTabs.Trigger>
      {modules.map((m) => (
        <NativeTabs.Trigger key={m.id} name={m.tabRoute!}>
          <NativeTabs.Trigger.Label>{t(m.labelKey)}</NativeTabs.Trigger.Label>
          {icon(m.tabRoute!)}
        </NativeTabs.Trigger>
      ))}
      {hidden.map((m) => (
        <NativeTabs.Trigger key={m.id} name={m.tabRoute!} hidden />
      ))}
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Label>{t("brand.module.profile")}</NativeTabs.Trigger.Label>
        {icon("profile")}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
