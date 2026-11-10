import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "../../components/AdminShell";
import { BackendNotConfigured } from "../../components/BackendNotConfigured";
import { StaffProvider } from "../../components/staff";
import { LocaleSync } from "../../i18n/LocaleSync";
import { getStaffSession } from "../../lib/session";
import { THEME_COOKIE, toTheme } from "../../lib/theme";

/** Server-side guard for every console page: the session user must have profiles.role in (moderator, admin, super_admin). */
export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const s = await getStaffSession();
  if (s.state === "unconfigured") return <BackendNotConfigured />;
  if (s.state === "anonymous") redirect("/sign-in");
  if (s.state === "denied") redirect("/access-denied");
  const theme = toTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <StaffProvider user={{ id: s.userId, role: s.role, displayName: s.displayName, email: s.email }}>
      <LocaleSync userId={s.userId} />
      <AdminShell theme={theme}>{children}</AdminShell>
    </StaffProvider>
  );
}
