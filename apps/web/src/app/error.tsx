"use client";

import { Button, ErrorState } from "@unimate/ui";
import { useT } from "@unimate/i18n/react";
import { AppLogo } from "@/components/brand";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const t = useT();
  return (
    <main className="center-page" id="main">
      <div className="brand-screen">
        <AppLogo kind="mark" height={64} />
        <ErrorState title={t("errorPage.title")} description={t("errorPage.body")} action={<Button onClick={reset}>{t("common.retry")}</Button>} />
      </div>
    </main>
  );
}
