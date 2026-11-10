import { EmptyState } from "@unimate/ui";
import Link from "next/link";
import { AppLogo } from "../components/brand";
import { getT } from "../i18n/server";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="center-page" id="main">
      <div className="brand-screen">
        <AppLogo kind="mark" height={64} />
        <EmptyState
          title={t("errorPage.notFoundTitle")}
          description={t("errorPage.notFoundBody")}
          action={
            <Link className="um-btn" href="/">
              {t("errorPage.home")}
            </Link>
          }
        />
      </div>
    </main>
  );
}
