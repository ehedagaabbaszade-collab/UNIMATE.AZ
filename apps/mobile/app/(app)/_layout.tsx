import { Redirect, Stack, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { kv, onboardingSkipKey } from "../../src/lib/storage";
import { useSession } from "../../src/state/session";
import { useTheme } from "../../src/theme/ThemeProvider";

export const unstable_settings = { initialRouteName: "(tabs)" };

/** Signed-in area. A new account without an institution is sent to onboarding once (it can be skipped). */
export default function AppLayout() {
  const { state } = useSession();
  const { theme } = useTheme();
  const pathname = usePathname();
  const uid = state.status === "signed-in" ? state.user.id : null;
  const [skipped, setSkipped] = useState<boolean | null>(null);

  useEffect(() => {
    if (!uid) return;
    void kv.getItem(onboardingSkipKey(uid)).then((v) => setSkipped(v === "1"));
  }, [uid, pathname]);

  if (state.status !== "signed-in") return null; // sign-out transition: the root guard is about to swap the navigator
  const needsOnboarding = !!state.profile && !state.profile.university_id && skipped === false;
  if (needsOnboarding && pathname !== "/onboarding") return <Redirect href="/onboarding" />;

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />;
}
