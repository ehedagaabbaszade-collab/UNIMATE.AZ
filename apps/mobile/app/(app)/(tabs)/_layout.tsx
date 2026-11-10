import { useT } from "@unimate/i18n/react";
import { Tabs } from "expo-router";
import { Icon } from "../../../src/components/Icon";
import { overflowTabModules, tabModules } from "../../../src/lib/registry";
import { useTheme } from "../../../src/theme/ThemeProvider";

/**
 * Bottom tab bar, derived from the module registry (src/lib/registry.ts): Home first, Profile last, registered
 * modules in between. A module without a registry entry has no tab. Each registered `tabRoute` needs a matching
 * file in this folder.
 */
export default function TabsLayout() {
  const t = useT();
  const { theme } = useTheme();
  const modules = tabModules();
  const hidden = overflowTabModules();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.active,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        tabBarAllowFontScaling: true,
        tabBarStyle: { backgroundColor: theme.tabBar, borderTopColor: theme.border, borderTopWidth: 1, paddingTop: 6 },
        sceneStyle: { backgroundColor: theme.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("nav.dashboard"), tabBarIcon: ({ color }) => <Icon name="home" color={String(color)} />, tabBarAccessibilityLabel: t("nav.dashboard") }} />
      {modules.map((m) => (
        <Tabs.Screen key={m.id} name={m.tabRoute!} options={{ title: t(m.labelKey), tabBarIcon: ({ color }) => <Icon name={m.icon} color={String(color)} />, tabBarAccessibilityLabel: t(m.labelKey) }} />
      ))}
      {hidden.map((m) => (
        <Tabs.Screen key={m.id} name={m.tabRoute!} options={{ href: null }} />
      ))}
      <Tabs.Screen name="profile" options={{ title: t("brand.module.profile"), tabBarIcon: ({ color }) => <Icon name="profile" color={String(color)} />, tabBarAccessibilityLabel: t("brand.module.profile") }} />
    </Tabs>
  );
}
