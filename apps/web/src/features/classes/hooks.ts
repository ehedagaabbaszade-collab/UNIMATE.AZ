"use client";

import { useI18n } from "@unimate/i18n/react";
import { useToast } from "@unimate/ui";
import { parseLocalDateTime } from "@/lib/datetime";
import { ClassApiError } from "./api";

/** Toast for any class RPC failure, with a specific message where the server gave a known reason. */
export function useClassError() {
  const { t } = useI18n();
  const { toast } = useToast();
  return (e: unknown) => toast(t(`teach.class.errors.${e instanceof ClassApiError ? e.key : "generic"}`), "error");
}

export { useAppMode } from "@/components/user";

/** "" = no limit; otherwise a future datetime-local value -> ISO, or false when it is not valid. */
export function optionalFuture(text: string): string | null | false {
  if (!text.trim()) return null;
  const iso = parseLocalDateTime(text);
  return iso && new Date(iso).getTime() > Date.now() ? iso : false;
}
