import Link from "next/link";
import { AppLogo } from "@/components/brand";
import { LocaleSwitcher } from "@/components/prefs";
import { getT } from "@/i18n/server";
import { LicenseList } from "./LicenseList";

export default async function LicensesPage() {
  const { t } = await getT();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="auth__brand">
          <AppLogo kind="mark" height={36} />
        </Link>
        <LocaleSwitcher compact />
      </header>
      <main id="main" className="page">
        <div className="prose">
          <h1>{t("legal.licenses.title")}</h1>
          <p>{t("legal.licenses.intro")}</p>
          <p>
            <a href="/licenses/THIRD_PARTY_NOTICES.txt">{t("legal.licenses.fullText")}</a>
          </p>
          <LicenseList />
        </div>
      </main>
    </>
  );
}
