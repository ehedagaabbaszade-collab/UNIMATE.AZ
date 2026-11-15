import { useT } from "@unimate/i18n/react";
import { usePathname } from "expo-router";
import { Platform, useWindowDimensions } from "react-native";
import { NativeTabs } from "expo-router/native-tabs";
import { NATIVE_GLASS, TabInsetContext, useTabBarClearance } from "../../../src/components/Glass";
import { MODULES, pinnedModules, tabRouteOf } from "../../../src/lib/registry";
import { usePins } from "../../../src/state/pins";
import { useUser } from "../../../src/state/session";
import { useTheme } from "../../../src/theme/ThemeProvider";

/** Native tab symbols per module id (+ home/more): SF Symbols on iOS, Material icons on Android. Unknown ids fall back to a dot. */
const ICONS: Record<string, { sf: string; md: string }> = {
  home: { sf: "house.fill", md: "home" },
  more: { sf: "square.grid.2x2.fill", md: "apps" },
  aiStudy: { sf: "sparkles", md: "auto_awesome" },
  notes: { sf: "doc.text.fill", md: "description" },
  campus: { sf: "building.columns.fill", md: "school" },
  career: { sf: "briefcase.fill", md: "work" },
  planner: { sf: "calendar", md: "calendar_month" },
  quiz: { sf: "checklist", md: "quiz" },
  flashcards: { sf: "rectangle.stack.fill", md: "style" },
  courses: { sf: "list.bullet.rectangle.fill", md: "view_timeline" },
  budget: { sf: "creditcard.fill", md: "account_balance_wallet" },
  gamification: { sf: "trophy.fill", md: "emoji_events" },
  focus: { sf: "timer", md: "timer" },
  gpa: { sf: "graduationcap.fill", md: "school" },
};
const icon = (id: string) => {
  const i = ICONS[id] ?? { sf: "circle.fill", md: "circle" };
  return <NativeTabs.Trigger.Icon sf={i.sf as never} md={i.md as never} />;
};

/**
 * Bottom navigation: the system's native tab bar (Liquid Glass on iOS 26, Material 3 on Android).
 * Home + the user's pinned modules (default AI Study, Career, Campus) + More. Every module has a tab file, so pinning
 * from More only flips `hidden`; unpinned modules stay declared hidden so Expo Router does not auto-add them.
 */
export default function TabsLayout() {
  const t = useT();
  const clearance = useTabBarClearance();
  const { theme } = useTheme();
  const { user } = useUser();
  const { ids } = usePins(user.id);
  const pinned = pinnedModules(ids);
  const pinnedIds = new Set(pinned.map((m) => m.id));
  // AI Study replaces the tab bar with its own Safari-style composer, so the system bar is hidden there.
  const onStudy = usePathname() === "/study";
  const dark = theme.mode === "dark";
  const narrow = useWindowDimensions().width < 360; // iPhone SE 1st gen / small Android: 5 labels must still fit
  // Constant on purpose: changing it on /study re-rendered every mounted tab exactly when the bar hides (the visible hitch).
  // AI Study provides its own inset (app/(app)/(tabs)/study.tsx).
  return (
    <TabInsetContext.Provider value={clearance}>
      {/* iOS 26 draws Liquid Glass itself and ignores the background props. iOS 16.4-25 and Android need them: by default
          the iOS bar turns fully transparent at the scroll edge (labels over content) and follows the *system* light/dark,
          and the Android M3 bar ignores the app theme. */}
      <NativeTabs
        hidden={onStudy}
        tintColor={theme.active}
        minimizeBehavior="onScrollDown"
        disableTransparentOnScrollEdge
        blurEffect={dark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
        shadowColor={theme.cardBorder}
        {...(NATIVE_GLASS ? {} : { iconColor: { default: theme.textMuted, selected: theme.active } })}
        labelStyle={{ default: { ...(NATIVE_GLASS ? {} : { color: theme.textMuted }), ...(narrow ? { fontSize: 10 } : {}) }, selected: NATIVE_GLASS ? {} : { color: theme.active } }}
        {...(Platform.OS === "android" ? { backgroundColor: theme.bg, indicatorColor: theme.primarySoft, rippleColor: theme.primarySoft, labelVisibilityMode: "labeled" as const } : {})}
      >
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>{t("nav.dashboard")}</NativeTabs.Trigger.Label>
          {icon("home")}
        </NativeTabs.Trigger>
        {pinned.map((m) => (
          <NativeTabs.Trigger key={m.id} name={tabRouteOf(m)}>
            <NativeTabs.Trigger.Label>{t(m.labelKey)}</NativeTabs.Trigger.Label>
            {icon(m.id)}
          </NativeTabs.Trigger>
        ))}
        <NativeTabs.Trigger name="more">
          <NativeTabs.Trigger.Label>{t("nav.more")}</NativeTabs.Trigger.Label>
          {icon("more")}
        </NativeTabs.Trigger>
        {MODULES.filter((m) => !pinnedIds.has(m.id)).map((m) => (
          <NativeTabs.Trigger key={m.id} name={tabRouteOf(m)} hidden />
        ))}
      </NativeTabs>
    </TabInsetContext.Provider>
  );
}
