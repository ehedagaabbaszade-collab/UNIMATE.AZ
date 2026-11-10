import type { Locale } from "@unimate/i18n";
import { legalAz } from "./az";
import { legalEn } from "./en";
import { legalRu } from "./ru";
import { legalTr } from "./tr";
import type { LegalDoc, LegalSlug } from "./types";

/** Typed so a missing locale or page fails the typecheck. All four are DRAFTS for legal review (see each file). */
export const legal: Record<Locale, Record<LegalSlug, LegalDoc>> = { az: legalAz, tr: legalTr, en: legalEn, ru: legalRu };
export { LEGAL_SLUGS, type LegalDoc, type LegalSlug } from "./types";
