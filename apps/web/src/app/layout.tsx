import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ToastProvider } from "@unimate/ui";
import "@unimate/ui/styles.css";
import "./globals.css";
import { createTranslator, LOCALE_COOKIE, toLocale } from "@/i18n";
import { I18nProvider } from "@/i18n/provider";
import { THEME_COOKIE, toTheme } from "@/lib/theme";

export const metadata: Metadata = {
  title: { default: "UNIMATE", template: "%s · UNIMATE" },
  description: "Study platform for students in Azerbaijan.",
};
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = toLocale(store.get(LOCALE_COOKIE)?.value);
  const theme = toTheme(store.get(THEME_COOKIE)?.value);
  const t = createTranslator(locale);
  return (
    <html lang={locale} {...(theme !== "system" ? { "data-theme": theme } : {})} suppressHydrationWarning>
      <body>
        <I18nProvider locale={locale}>
          <ToastProvider dismissLabel={t("common.dismiss")}>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
