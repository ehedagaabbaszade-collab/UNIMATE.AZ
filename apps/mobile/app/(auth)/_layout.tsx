import { Stack } from "expo-router";
import { useTheme } from "../../src/theme/ThemeProvider";

export const unstable_settings = { anchor: "sign-in" };

export default function AuthLayout() {
  const { theme } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />;
}
