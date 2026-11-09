"use client";

import { edgeErrorMessageKey, type EdgeError } from "@/lib/edge";
import { useT } from "@/i18n/provider";

/** Clear, honest message for a failed server-function call (provider not configured, quota, network...). */
export function EdgeNotice({ error }: { error: EdgeError }) {
  const t = useT();
  const tone = error.kind === "provider_not_configured" || error.kind === "quota_exceeded" ? "warn-box" : "err-box";
  return (
    <p className={tone} role="alert">
      {t(edgeErrorMessageKey(error), { message: error.message ?? "" })}
    </p>
  );
}
