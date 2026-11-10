import { useT } from "@unimate/i18n/react";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";
import { AppText, Card, Screen } from "../../src/components/ui";
import { useSession } from "../../src/state/session";
import { useTheme } from "../../src/theme/ThemeProvider";

/**
 * Deep link target: unimate://auth/callback?code=...&next=reset-password
 * PKCE: the one-time `code` is exchanged for a session (stored in SecureStore). The Supabase project must list this
 * redirect URL in Authentication > URL Configuration (see apps/mobile/README.md).
 */
export default function AuthCallback() {
  const t = useT();
  const { theme } = useTheme();
  const router = useRouter();
  const { supabase } = useSession();
  const params = useLocalSearchParams<{ code?: string; next?: string; error_description?: string }>();
  const [failed, setFailed] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    if (params.error_description) return setFailed(true);
    if (!supabase) return;
    if (!params.code) return setFailed(true);
    done.current = true;
    void supabase.auth.exchangeCodeForSession(String(params.code)).then(({ error }) => {
      if (error) return setFailed(true);
      router.replace(params.next === "reset-password" ? "/reset-password" : "/");
    });
  }, [supabase, params.code, params.next, params.error_description, router]);

  return (
    <Screen scroll={false}>
      {failed ? (
        <Card>
          <AppText accessibilityRole="alert">{t("auth.callbackError")}</AppText>
          <Link href="/sign-in" accessibilityRole="link">
            <AppText variant="label" style={{ textDecorationLine: "underline" }}>
              {t("auth.signInCta")}
            </AppText>
          </Link>
        </Card>
      ) : (
        <ActivityIndicator color={theme.active} />
      )}
    </Screen>
  );
}
