import { z } from "zod";
import { CV_DEFAULT_TEMPLATE, CV_SECTIONS, type CvLegacyTemplate, type CvTemplate } from "./career";

// CV presentation (cv_documents.design, migration 005800). Content stays in `data`; everything visual lives here and is
// validated twice: CvDesignSchema (clients) and career_cv_design_valid (DB). Keep the two allow-lists in sync.

/** Sections a user can reorder or hide (personal details are the header and always render). */
export const CV_DESIGN_SECTIONS = CV_SECTIONS.filter((s): s is Exclude<(typeof CV_SECTIONS)[number], "personal"> => s !== "personal");
export type CvDesignSection = (typeof CV_DESIGN_SECTIONS)[number];
/** OFL families bundled with full az/tr/ru coverage (see cv-fonts.manifest.ts). */
export const CV_FONTS = ["inter", "noto-sans", "noto-serif"] as const;
export type CvFont = (typeof CV_FONTS)[number];
export const CV_FONT_STACKS: Record<CvFont, string> = {
  inter: "'CV Inter','Inter','Segoe UI',Roboto,Arial,sans-serif",
  "noto-sans": "'CV Noto Sans','Noto Sans','Segoe UI',Roboto,Arial,sans-serif",
  "noto-serif": "'CV Noto Serif','Noto Serif',Georgia,'Times New Roman',serif",
};
export const CV_FONT_SIZES = ["sm", "md", "lg"] as const;
export const CV_SPACINGS = ["compact", "normal", "relaxed"] as const;
export const CV_MARGINS = ["narrow", "normal", "wide"] as const;
export const CV_COLUMNS = ["one", "two"] as const;
export const CV_PHOTO_SHAPES = ["circle", "rounded", "square"] as const;
export const CV_MODES = ["designed", "ats"] as const;
export const CV_HEADING_SCALE = { min: 0.8, max: 1.5 } as const;
export const CV_DESIGN_MAX_BYTES = 4000;
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const CvDesignSchema = z.object({
  sectionOrder: z.array(z.enum(CV_DESIGN_SECTIONS)).max(CV_DESIGN_SECTIONS.length).optional(),
  hidden: z.array(z.enum(CV_DESIGN_SECTIONS)).max(CV_DESIGN_SECTIONS.length).optional(),
  font: z.enum(CV_FONTS).optional(),
  fontSize: z.enum(CV_FONT_SIZES).optional(),
  headingScale: z.number().min(CV_HEADING_SCALE.min).max(CV_HEADING_SCALE.max).optional(),
  primary: hex.optional(),
  accent: hex.optional(),
  background: hex.optional(),
  spacing: z.enum(CV_SPACINGS).optional(),
  margins: z.enum(CV_MARGINS).optional(),
  columns: z.enum(CV_COLUMNS).optional(),
  showPhoto: z.boolean().optional(),
  photoShape: z.enum(CV_PHOTO_SHAPES).optional(),
  mode: z.enum(CV_MODES).optional(),
});
/** Stored design: every key optional; missing keys take the template's defaults. */
export type CvDesign = z.infer<typeof CvDesignSchema>;
export type CvResolvedDesign = Required<CvDesign>;

/**
 * Lenient read of a stored/untrusted design for rendering: keeps each valid key, drops each invalid one (so a value from a
 * newer client never breaks the render). Use CvDesignSchema.safeParse to validate before saving.
 */
export function parseCvDesign(input: unknown): CvDesign {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, schema] of Object.entries(CvDesignSchema.shape)) {
    const r = (schema as z.ZodType).safeParse((input as Record<string, unknown>)[k]);
    if (r.success && r.data !== undefined) out[k] = r.data;
  }
  return out as CvDesign;
}

export const CV_TEMPLATE_CATEGORIES = ["modern", "minimal", "corporate", "creative", "executive", "academic", "graduate", "ats"] as const;
export type CvTemplateCategory = (typeof CV_TEMPLATE_CATEGORIES)[number];
export interface CvTemplateMeta {
  id: CvTemplate;
  /** i18n keys: career.cv.templates.<id> / career.cv.templateDesc.<id>. */
  nameKey: `career.cv.templates.${CvTemplate}`;
  descriptionKey: `career.cv.templateDesc.${CvTemplate}`;
  categories: readonly CvTemplateCategory[];
  /** "Optimised for ATS" (simple structure, linear text). Never a guarantee. */
  atsFriendly: boolean;
  supportsPhoto: boolean;
  columns: 1 | 2;
  /** Typical length for a student/junior CV. */
  pages: "1" | "1-2" | "2+";
  defaults: CvResolvedDesign;
}

const ORDER = (...first: CvDesignSection[]): CvDesignSection[] => [...first, ...CV_DESIGN_SECTIONS.filter((s) => !first.includes(s))];
const base: CvResolvedDesign = {
  sectionOrder: ORDER("summary", "experience", "education", "projects", "skills", "languages", "certificates", "courses", "volunteer", "publications", "honours", "activities", "hobbies", "references"),
  hidden: [],
  font: "inter",
  fontSize: "md",
  headingScale: 1,
  primary: "#111827",
  accent: "#2563EB",
  background: "#FFFFFF",
  spacing: "normal",
  margins: "normal",
  columns: "one",
  showPhoto: false,
  photoShape: "circle",
  mode: "designed",
};
const meta = (id: CvTemplate, m: Omit<CvTemplateMeta, "id" | "nameKey" | "descriptionKey" | "defaults">, d: Partial<CvResolvedDesign>): CvTemplateMeta => ({
  id,
  nameKey: `career.cv.templates.${id}`,
  descriptionKey: `career.cv.templateDesc.${id}`,
  ...m,
  defaults: { ...base, ...d },
});

export const CV_TEMPLATE_CATALOG: readonly CvTemplateMeta[] = [
  meta("modern-minimal", { categories: ["modern", "minimal"], atsFriendly: true, supportsPhoto: true, columns: 1, pages: "1-2" }, { spacing: "relaxed", accent: "#2563EB" }),
  meta("corporate", { categories: ["corporate"], atsFriendly: true, supportsPhoto: true, columns: 1, pages: "1-2" }, { font: "noto-sans", primary: "#1F3A5F", accent: "#2B6CB0" }),
  meta(
    "executive",
    { categories: ["executive", "corporate"], atsFriendly: true, supportsPhoto: false, columns: 1, pages: "2+" },
    { font: "noto-serif", primary: "#1C2833", accent: "#8C7853", sectionOrder: ORDER("summary", "skills", "experience", "education") },
  ),
  meta(
    "creative",
    { categories: ["creative", "modern"], atsFriendly: false, supportsPhoto: true, columns: 2, pages: "1-2" },
    { primary: "#3B2667", accent: "#F59E0B", columns: "two", showPhoto: true },
  ),
  meta(
    "academic",
    { categories: ["academic"], atsFriendly: true, supportsPhoto: false, columns: 1, pages: "2+" },
    { font: "noto-serif", primary: "#000000", accent: "#000000", margins: "wide", sectionOrder: ORDER("summary", "education", "publications", "experience", "courses", "honours") },
  ),
  meta(
    "graduate",
    { categories: ["graduate", "modern"], atsFriendly: true, supportsPhoto: true, columns: 1, pages: "1" },
    { font: "noto-sans", primary: "#0F3D5E", accent: "#0EA5A4", spacing: "compact", sectionOrder: ORDER("summary", "education", "projects", "experience", "skills", "languages") },
  ),
  meta("two-column", { categories: ["modern", "corporate"], atsFriendly: false, supportsPhoto: true, columns: 2, pages: "1-2" }, { font: "noto-sans", primary: "#1E3A8A", accent: "#3B82F6", columns: "two" }),
  meta("ats-classic", { categories: ["ats", "minimal"], atsFriendly: true, supportsPhoto: false, columns: 1, pages: "1-2" }, { primary: "#000000", accent: "#000000", mode: "ats" }),
  meta(
    "modern-european",
    { categories: ["modern", "corporate"], atsFriendly: false, supportsPhoto: true, columns: 2, pages: "1-2" },
    { font: "noto-sans", primary: "#1F4E79", accent: "#2E75B6", columns: "two", showPhoto: true },
  ),
  meta("clean-international", { categories: ["minimal", "modern"], atsFriendly: true, supportsPhoto: true, columns: 1, pages: "1-2" }, { primary: "#222222", accent: "#6B7280", showPhoto: true, photoShape: "rounded" }),
];
const BY_ID = new Map(CV_TEMPLATE_CATALOG.map((t) => [t.id, t]));

/** Legacy template id -> closest builder template (europass keeps its own renderer, see cv-html.ts). */
export const CV_LEGACY_ALIASES: Record<CvLegacyTemplate, CvTemplate> = {
  europass: "modern-european",
  sidebar: "creative",
  headline: "corporate",
  timeline: "graduate",
  elegant: "executive",
  photocard: "clean-international",
  split: "two-column",
  classic: "clean-international",
  modern: "modern-minimal",
  compact: "graduate",
  minimal: "modern-minimal",
  executive: "executive",
  corporate: "corporate",
  creative: "creative",
  ats: "ats-classic",
};
/** Any stored id (new, legacy, or unknown) -> template metadata. Unknown ids fall back to the default template. */
export function cvTemplateMeta(id: string): CvTemplateMeta {
  const t = BY_ID.get(id as CvTemplate) ?? BY_ID.get((CV_LEGACY_ALIASES as Record<string, CvTemplate>)[id] ?? ("" as CvTemplate));
  return t ?? BY_ID.get(CV_DEFAULT_TEMPLATE)!;
}
/** Template defaults overlaid with the user's (validated) choices; order is completed with any section the user did not list. */
export function resolveCvDesign(templateId: string, design: unknown): CvResolvedDesign {
  const t = cvTemplateMeta(templateId);
  const d = { ...t.defaults, ...parseCvDesign(design) };
  const order = [...new Set(d.sectionOrder)];
  return { ...d, sectionOrder: [...order, ...t.defaults.sectionOrder.filter((s) => !order.includes(s))] };
}
