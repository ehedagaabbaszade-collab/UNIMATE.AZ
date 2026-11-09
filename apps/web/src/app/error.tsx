"use client";

import { Button, ErrorState } from "@unimate/ui";
import { useT } from "@/i18n/provider";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const t = useT();
  return (
    <main className="center-page" id="main">
      <ErrorState title={t("errorPage.title")} description={t("errorPage.body")} action={<Button onClick={reset}>{t("common.retry")}</Button>} />
    </main>
  );
}
