import { Redirect, Stack, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { kv, onboardingSkipKey } from "../../src/lib/storage";
import { useReminderSync } from "../../src/features/planner/useReminderSync";
import { LegalGate } from "../../src/features/legal/LegalGate";
import { useAppMode } from "../../src/state/mode";
import { useSession } from "../../src/state/session";
import { NATIVE_GLASS } from "../../src/components/Glass";
import { useTheme } from "../../src/theme/ThemeProvider";

export const unstable_settings = { anchor: "(tabs)" };

/** Student tab routes (app/(app)/(tabs)): teacher mode never lands on them. */
const TAB_PATHS = new Set(["/", "/study", "/campus", "/career", "/more"]);
const isTabPath = (p: string) => TAB_PATHS.has(p) || p.startsWith("/pin-");

/** Signed-in area. A new account without an institution is sent to onboarding once (it can be skipped). */
export default function AppLayout() {
  const { state } = useSession();
  const { theme } = useTheme();
  const pathname = usePathname();
  const uid = state.status === "signed-in" ? state.user.id : null;
  const [skipped, setSkipped] = useState<boolean | null>(null);
  const { mode } = useAppMode(uid);
  useReminderSync(state.status === "signed-in" && mode === "student");

  useEffect(() => {
    if (!uid) return;
    void kv.getItem(onboardingSkipKey(uid)).then((v) => setSkipped(v === "1"));
  }, [uid, pathname]);

  if (state.status !== "signed-in") return null; // sign-out transition: the root guard is about to swap the navigator
  if (mode === undefined || skipped === null) return null; // loading: never flash student tabs before the mode is known
  if (mode === null && pathname !== "/welcome") return <Redirect href="/welcome" />;
  if (mode === "teacher" && isTabPath(pathname)) return <Redirect href="/teacher" />;
  if (mode === "student" && pathname.startsWith("/teacher")) return <Redirect href="/" />;
  const needsOnboarding = !!state.profile && !state.profile.university_id && skipped === false;
  if (mode === "student" && needsOnboarding && pathname !== "/onboarding") return <Redirect href="/onboarding" />;

  return (
    <>
      <LegalGate />
      {/* Native transitions only (iOS push + edge/full swipe back, Android default). Screens opt into the header via ScreenHeader. */}
    <Stack
      screenOptions={{
        headerShown: false,
        fullScreenGestureEnabled: true,
        contentStyle: { backgroundColor: theme.bg },
        // Transparent so the Screen gradient shows through; Screen offsets content by the header height.
        headerTransparent: true,
        headerStyle: { backgroundColor: "transparent" },
        headerShadowVisible: false,
        // iOS 26 blurs content under a transparent header by itself (scroll edge effect); iOS 16.4-25 does not, so
        // scrolled content would run straight under the title. Give older iOS the system chrome material instead.
        ...(NATIVE_GLASS ? {} : { headerBlurEffect: theme.mode === "dark" ? ("systemChromeMaterialDark" as const) : ("systemChromeMaterialLight" as const) }),
        headerTintColor: theme.active,
        headerTitleStyle: { color: theme.text, fontSize: 17, fontWeight: "600" },
        headerBackButtonDisplayMode: "minimal",
      }}
    >
      {/* Modals declare their header up front: toggling header visibility inside a modal remounts it and drops state. */}
      <Stack.Screen name="notifications" options={{ presentation: "modal", headerShown: true }} />
    </Stack>
    </>
  );
}
