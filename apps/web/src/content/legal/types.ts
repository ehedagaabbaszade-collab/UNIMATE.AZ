export interface LegalSection {
  h: string;
  p?: string[];
  ul?: string[];
}
export interface LegalDoc {
  title: string;
  sections: LegalSection[];
}
export const LEGAL_SLUGS = ["privacy", "terms", "ai-disclaimer", "community-guidelines", "data-retention"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];
