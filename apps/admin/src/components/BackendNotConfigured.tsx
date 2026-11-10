import { ErrorState } from "@unimate/ui";
import { getT } from "../i18n/server";
import { AppLogo } from "./brand";

export async function BackendNotConfigured() {
  const { t } = await getT();
  return (
    <main className="center-page" id="main">
      <div className="brand-screen" style={{ maxWidth: 560 }}>
        <AppLogo kind="logo" height={104} />
        <ErrorState title={t("backend.title")} description={t("backend.body")} />
      </div>
    </main>
  );
}
