import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { ToastProvider } from "@unimate/ui";
import "@unimate/ui/styles.css";
import "./globals.css";
import "./select.css";
import { catalogs, createTranslator, LOCALE_COOKIE, toLocale, type Messages } from "@unimate/i18n";
import { I18nProvider } from "@unimate/i18n/react";
import { getT } from "@/i18n/server";
import { THEME_COOKIE, toTheme } from "@/lib/theme";

const OG_LOCALE = { az: "az_AZ", tr: "tr_TR", en: "en_GB", ru: "ru_RU" } as const;

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getT();
  const description = t("meta.description");
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: { default: "UNIMATE.AZ", template: "%s · UNIMATE" },
    description,
    applicationName: "UNIMATE.AZ",
    // og:image / twitter:image come from app/opengraph-image.png and app/twitter-image.png (file conventions).
    openGraph: { type: "website", siteName: "UNIMATE.AZ", title: "UNIMATE.AZ", description, locale: OG_LOCALE[locale] },
    twitter: { card: "summary_large_image", title: "UNIMATE.AZ", description },
  };
}
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f5ff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const locale = toLocale(store.get(LOCALE_COOKIE)?.value);
  const theme = toTheme(store.get(THEME_COOKIE)?.value);
  const t = createTranslator(locale);
  // Only the active language goes to the client, and never the admin console's strings (web does not use them).
  const { admin: _admin, ...webMessages } = catalogs[locale];
  return (
    <html lang={locale} {...(theme !== "system" ? { "data-theme": theme } : {})} suppressHydrationWarning>
      <body>
        <I18nProvider locale={locale} messages={webMessages as Messages}>
          <ToastProvider dismissLabel={t("common.dismiss")}>{children}</ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
