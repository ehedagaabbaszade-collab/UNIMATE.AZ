import { cookies } from "next/headers";
import { THEME_COOKIE, toTheme } from "@/lib/theme";
import { Settings } from "@/features/settings/Settings";

export default async function SettingsPage() {
  const theme = toTheme((await cookies()).get(THEME_COOKIE)?.value);
  return <Settings theme={theme} />;
}
