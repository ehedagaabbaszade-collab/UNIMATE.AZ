// Legal copy lives with the web app (apps/web/src/content/legal/*): pure typed data (4 locales x 5 pages, DRAFTS for
// legal review). Reused as-is so web and mobile can never show different text. Metro resolves it through watchFolders.
export { legal, LEGAL_SLUGS, type LegalDoc, type LegalSlug } from "../../../web/src/content/legal";

import type { LegalSlug } from "../../../web/src/content/legal";

/** Settings label key per legal page (existing web catalog keys). */
export const LEGAL_LABEL: Record<LegalSlug, "privacy" | "terms" | "aiDisclaimer" | "community" | "retention"> = {
  privacy: "privacy",
  terms: "terms",
  "ai-disclaimer": "aiDisclaimer",
  "community-guidelines": "community",
  "data-retention": "retention",
};
