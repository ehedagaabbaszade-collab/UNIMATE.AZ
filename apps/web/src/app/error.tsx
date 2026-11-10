"use client";

import { Button, ErrorState } from "@unimate/ui";
import { useT } from "@unimate/i18n/react";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const t = useT();
  return (
    <main className="center-page" id="main">
      <ErrorState title={t("errorPage.title")} description={t("errorPage.body")} action={<Button onClick={reset}>{t("common.retry")}</Button>} />
    </main>
  );
}
