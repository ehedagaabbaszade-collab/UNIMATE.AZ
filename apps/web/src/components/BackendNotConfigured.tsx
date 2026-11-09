import { ErrorState } from "@unimate/ui";
import { getT } from "@/i18n/server";

export async function BackendNotConfigured() {
  const { t } = await getT();
  return (
    <main className="center-page" id="main">
      <div style={{ maxWidth: 560 }}>
        <ErrorState title={t("backend.title")} description={t("backend.body")} />
        <p className="um-muted" style={{ marginTop: "var(--space-4)", fontSize: "var(--text-sm)", textAlign: "center" }}>
          <code>{t("backend.hint")}</code>
        </p>
      </div>
    </main>
  );
}
