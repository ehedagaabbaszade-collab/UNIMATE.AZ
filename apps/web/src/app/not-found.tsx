import { EmptyState } from "@unimate/ui";
import Link from "next/link";
import { getT } from "@/i18n/server";

export default async function NotFound() {
  const { t } = await getT();
  return (
    <main className="center-page" id="main">
      <EmptyState
        title={t("errorPage.notFoundTitle")}
        description={t("errorPage.notFoundBody")}
        action={
          <Link className="um-btn" href="/">
            {t("errorPage.home")}
          </Link>
        }
      />
    </main>
  );
}
