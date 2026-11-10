import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useT } from "@unimate/i18n/react";
import { BrandLogo } from "../src/components/Brand";
import { Screen, AppText, Card, ToastProvider } from "../src/components/ui";
import { LanguageSelector } from "../src/components/LanguageSelector";
import { LocaleProvider } from "../src/state/locale";
import { SessionProvider, useSession } from "../src/state/session";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function BackendNotConfigured() {
  const t = useT();
  return (
    <Screen>
      <View style={{ alignItems: "center", paddingTop: 24 }}>
        <BrandLogo height={120} />
      </View>
      <Card>
        <AppText variant="title" accessibilityRole="header">
          {t("backend.title")}
        </AppText>
        <AppText>{t("mobile.backend.body")}</AppText>
        <AppText muted>{t("mobile.backend.hint")}</AppText>
      </Card>
      <LanguageSelector />
    </Screen>
  );
}

function Gate() {
  const { state } = useSession();
  const { theme } = useTheme();
  const loading = state.status === "loading";
  useEffect(() => {
    if (!loading) void SplashScreen.hideAsync().catch(() => undefined);
  }, [loading]);

  if (state.status === "no-backend") return <BackendNotConfigured />;
  if (loading)
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.active} />
      </View>
    );
  const signedIn = state.status === "signed-in";
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Screen name="auth/callback" />
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <LocaleProvider>
            <ToastProvider>
              <Gate />
            </ToastProvider>
          </LocaleProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
