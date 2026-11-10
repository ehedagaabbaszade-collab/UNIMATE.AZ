import { useT } from "@unimate/i18n/react";
import { edgeErrorMessageKey, type EdgeError } from "../lib/edge";
import { Notice } from "./ui";

const SOFT = new Set<EdgeError["kind"]>(["provider_not_configured", "quota_exceeded", "budget_exceeded", "rate_limited"]);

/** Clear, honest message for a failed server-function call (provider not configured, quota, budget, rate limit, network...). */
export function EdgeNotice({ error }: { error: EdgeError }) {
  const t = useT();
  return <Notice tone={SOFT.has(error.kind) ? "warning" : "danger"} text={t(edgeErrorMessageKey(error), { message: error.message ?? "" })} />;
}
