"use client";

import { BrandLogo, BrandMark, type BrandVariant } from "@unimate/ui";
import { useT } from "@unimate/i18n/react";

/** UNIMATE logo/brandmark with the accessible name taken from the active locale (brand.logo / brand.mark). */
export function AppLogo({ kind, height, variant = "auto", layout = "stacked" }: { kind: "logo" | "mark"; height: number; variant?: BrandVariant; layout?: "stacked" | "row" }) {
  const t = useT();
  return kind === "mark" ? (
    <BrandMark label={t("brand.mark")} variant={variant} height={height} />
  ) : (
    <BrandLogo label={t("brand.logo")} variant={variant} layout={layout} height={height} />
  );
}
