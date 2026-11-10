import { z } from "zod";

// UNIMATE CAREER: pure, dependency-free logic shared by web, mobile, the edge functions and tests. No AI in here.

export const OPPORTUNITY_KINDS = ["internship", "junior_job", "scholarship", "exchange", "competition", "hackathon", "career_event"] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];
export const OPPORTUNITY_SORTS = ["deadline", "newest"] as const;
export type OpportunitySort = (typeof OPPORTUNITY_SORTS)[number];
export const TRACK_STATUSES = ["saved", "applied", "interview", "offer", "rejected"] as const;
export type TrackStatus = (typeof TRACK_STATUSES)[number];
export const OPPORTUNITY_PAGE_SIZE = 20;
export const CV_TEMPLATES = ["classic", "modern", "compact"] as const;
export type CvTemplate = (typeof CV_TEMPLATES)[number];
export const CV_LANGUAGES = ["az", "tr", "en", "ru"] as const;
export type CvLanguage = (typeof CV_LANGUAGES)[number];
/** Mirrors career_cv_data_valid (octet_length(data::text) <= 60000) and the 5-CVs-per-account trigger. */
export const CV_MAX_BYTES = 60_000;
export const CV_MAX_DOCUMENTS = 5;
export const CV_SECTION_ITEMS_MAX = 30;

// ---------------------------------------------------------------- skills
/** Same folding as SQL notes_normalize: az/tr/ru letters -> ASCII-ish, lowercase, collapsed whitespace. */
export function normalizeSkill(s: string): string {
  const map: Record<string, string> = { İ: "i", I: "i", ı: "i", Ə: "e", ə: "e", Ö: "o", ö: "o", Ü: "u", ü: "u", Ç: "c", ç: "c", Ş: "s", ş: "s", Ğ: "g", ğ: "g", Ё: "е", ё: "е" };
  return s
    .replace(/̇/g, "")
    .replace(/[İIıƏəÖöÜüÇçŞşĞğЁё]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface SkillMatch {
  matched: string[];
  missing: string[];
  /** matched / required, or null when the listing names no skills. */
  ratio: number | null;
}
/** Skills the CV has vs. skills a listing requires. Case/diacritic-insensitive; output keeps the listing's wording. */
export function matchSkills(have: readonly string[], required: readonly string[]): SkillMatch {
  const owned = new Set(have.map(normalizeSkill).filter(Boolean));
  const seen = new Set<string>();
  const matched: string[] = [];
  const missing: string[] = [];
  for (const r of required) {
    const n = normalizeSkill(r);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    (owned.has(n) ? matched : missing).push(r.trim());
  }
  const total = matched.length + missing.length;
  return { matched, missing, ratio: total === 0 ? null : matched.length / total };
}

export interface SkillGapEntry {
  skill: string;
  /** In how many of the given listings the skill is required and missing from the CV. */
  count: number;
}
/**
 * Skill recommendations = pure counting: which skills that the user's saved/tracked listings ask for are missing from the CV.
 * No courses or links are ever invented.
 */
export function skillGap(have: readonly string[], listings: ReadonlyArray<{ skills: readonly string[] }>, limit = 10): SkillGapEntry[] {
  const counts = new Map<string, SkillGapEntry>();
  for (const l of listings) {
    for (const skill of matchSkills(have, l.skills).missing) {
      const key = normalizeSkill(skill);
      const cur = counts.get(key);
      if (cur) cur.count++;
      else counts.set(key, { skill, count: 1 });
    }
  }
  const collator = new Intl.Collator("az");
  return [...counts.values()].sort((a, b) => b.count - a.count || collator.compare(a.skill, b.skill)).slice(0, limit);
}

// ---------------------------------------------------------------- deadlines
const DAY_MS = 86_400_000;
const ymd = (s: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};
/** Calendar date in Azerbaijan (UTC+4, no DST), matching SQL career_today(). */
export const todayInBaku = (now: Date = new Date()): string => new Date(now.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
export function daysUntil(deadline: string | null | undefined, today: string): number | null {
  if (!deadline) return null;
  const d = (ymd(deadline) - ymd(today)) / DAY_MS;
  return Number.isFinite(d) ? Math.round(d) : null;
}
export type DeadlineView = { state: "none" } | { state: "expired"; days: number } | { state: "today" } | { state: "soon" | "later"; days: number };
export function deadlineView(deadline: string | null | undefined, today: string): DeadlineView {
  const d = daysUntil(deadline, today);
  if (d === null) return { state: "none" };
  if (d < 0) return { state: "expired", days: -d };
  if (d === 0) return { state: "today" };
  return { state: d <= 7 ? "soon" : "later", days: d };
}

/** Only https links are ever opened from the app (the DB enforces it too). */
export const safeExternalUrl = (url: string | null | undefined): string | null => (url && /^https:\/\/[^\s]+$/i.test(url) ? url : null);

// ---------------------------------------------------------------- opportunity rows (RPC -> UI)
export interface OpportunityListItem {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationVerified: boolean;
  kind: OpportunityKind;
  title: string;
  location: string | null;
  remote: boolean;
  deadline: string | null;
  applyUrl: string;
  skills: string[];
  languages: string[];
  trackedStatus: TrackStatus | null;
}
type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");
const sn = (v: unknown): string | null => (typeof v === "string" ? v : null);
const sa = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const track = (v: unknown): TrackStatus | null => ((TRACK_STATUSES as readonly string[]).includes(v as string) ? (v as TrackStatus) : null);

export function mapOpportunityRow(r: Row): OpportunityListItem {
  return {
    id: s(r.id),
    organizationId: s(r.organization_id),
    organizationName: s(r.organization_name),
    organizationVerified: r.organization_verified === true,
    kind: r.kind as OpportunityKind,
    title: s(r.title),
    location: sn(r.location),
    remote: r.remote === true,
    deadline: sn(r.deadline),
    applyUrl: s(r.apply_url),
    skills: sa(r.skills),
    languages: sa(r.languages),
    trackedStatus: track(r.tracked_status),
  };
}

export interface OpportunityDetail {
  id: string;
  kind: OpportunityKind;
  title: string;
  description: string | null;
  requirements: string | null;
  location: string | null;
  remote: boolean;
  deadline: string | null;
  applyUrl: string;
  skills: string[];
  languages: string[];
  sourceNote: string | null;
  trackedStatus: TrackStatus | null;
  organization: { id: string; name: string; description: string | null; website: string | null; verified: boolean };
}
export function mapOpportunityDetail(j: unknown): OpportunityDetail | null {
  if (!j || typeof j !== "object") return null;
  const r = j as Row;
  const o = (r.organization ?? {}) as Row;
  return {
    id: s(r.id),
    kind: r.kind as OpportunityKind,
    title: s(r.title),
    description: sn(r.description),
    requirements: sn(r.requirements),
    location: sn(r.location),
    remote: r.remote === true,
    deadline: sn(r.deadline),
    applyUrl: s(r.apply_url),
    skills: sa(r.skills),
    languages: sa(r.languages),
    sourceNote: sn(r.source_note),
    trackedStatus: track(r.tracked_status),
    organization: { id: s(o.id), name: s(o.name), description: sn(o.description), website: sn(o.website), verified: o.verified === true },
  };
}

export interface TrackedItem {
  id: string;
  opportunityId: string | null;
  status: TrackStatus;
  notes: string;
  title: string;
  organization: string;
  kind: OpportunityKind;
  deadline: string | null;
  applyUrl: string | null;
  skills: string[];
  /** published = live; unavailable = archived/draft; removed = deleted by an admin (only the saved snapshot remains). */
  listingState: "published" | "unavailable" | "removed";
  updatedAt: string;
}
export function mapTrackingRow(r: Row): TrackedItem {
  return {
    id: s(r.id),
    opportunityId: sn(r.opportunity_id),
    status: track(r.status) ?? "saved",
    notes: s(r.notes),
    title: s(r.title),
    organization: s(r.organization),
    kind: r.kind as OpportunityKind,
    deadline: sn(r.deadline),
    applyUrl: sn(r.apply_url),
    skills: sa(r.skills),
    listingState: r.listing_state === "published" || r.listing_state === "unavailable" ? r.listing_state : "removed",
    updatedAt: s(r.updated_at),
  };
}
/** Board columns in order, each with its items. */
export function groupByStatus(items: readonly TrackedItem[]): Array<{ status: TrackStatus; items: TrackedItem[] }> {
  return TRACK_STATUSES.map((status) => ({ status, items: items.filter((i) => i.status === status) }));
}

// ---------------------------------------------------------------- CV
const str = (max: number) => z.string().max(max).default("");
const httpsOrEmpty = z
  .string()
  .max(200)
  .default("")
  .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "must be an https link");
const list = <T extends z.ZodType>(item: T) => z.array(item).max(CV_SECTION_ITEMS_MAX).default([]);

export const CvPersonalSchema = z.object({
  fullName: str(120),
  headline: str(120),
  email: str(160),
  phone: str(40),
  city: str(100),
  linkedin: httpsOrEmpty,
  website: httpsOrEmpty,
});
export const CvEducationSchema = z.object({ institution: str(160), degree: str(160), field: str(160), start: str(20), end: str(20), gpa: str(20), description: str(600) });
export const CvExperienceSchema = z.object({
  company: str(160),
  role: str(160),
  location: str(100),
  start: str(20),
  end: str(20),
  current: z.boolean().default(false),
  bullets: z.array(z.string().max(300)).max(8).default([]),
});
export const CvLanguageSchema = z.object({ name: str(40), level: str(40) });
export const CvProjectSchema = z.object({ name: str(160), link: httpsOrEmpty, description: str(600), tech: z.array(z.string().max(40)).max(10).default([]) });
export const CvCertificateSchema = z.object({ name: str(160), issuer: str(160), year: str(10), link: httpsOrEmpty });

export const CvDataSchema = z.object({
  personal: CvPersonalSchema.default(() => CvPersonalSchema.parse({})),
  summary: str(1500),
  education: list(CvEducationSchema),
  experience: list(CvExperienceSchema),
  skills: list(z.string().min(1).max(50)),
  languages: list(CvLanguageSchema),
  projects: list(CvProjectSchema),
  certificates: list(CvCertificateSchema),
});
export type CvData = z.infer<typeof CvDataSchema>;
export type CvSectionKey = keyof CvData;
export const CV_SECTIONS = ["personal", "summary", "education", "experience", "skills", "languages", "projects", "certificates"] as const satisfies readonly CvSectionKey[];

export const emptyCv = (): CvData => CvDataSchema.parse({});

export const CvDocumentInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  language: z.enum(CV_LANGUAGES),
  template: z.enum(CV_TEMPLATES),
  data: CvDataSchema,
});
export type CvDocumentInput = z.infer<typeof CvDocumentInputSchema>;

const utf8Length = (str: string): number => {
  let n = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
};

export type CvParseResult = { ok: true; data: CvData } | { ok: false; error: "invalid" | "too_large" };
/** Validates untrusted CV JSON (from the DB or a client) and enforces the byte budget. */
export function parseCvData(input: unknown): CvParseResult {
  const r = CvDataSchema.safeParse(input ?? {});
  if (!r.success) return { ok: false, error: "invalid" };
  if (utf8Length(JSON.stringify(r.data)) > CV_MAX_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, data: r.data };
}

export interface CvCompleteness {
  /** 0-100. */
  score: number;
  sections: Array<{ key: CvSectionKey; weight: number; earned: number }>;
  /** Sections not yet fully earned, largest remaining gain first (UI maps them to tips). */
  missing: CvSectionKey[];
}
const filled = (v: string) => v.trim().length > 0;
/** Deterministic completeness score. Weights sum to 100. */
export function cvCompleteness(cv: CvData): CvCompleteness {
  const p = cv.personal;
  const personalParts = [filled(p.fullName), filled(p.email), filled(p.phone) || filled(p.city)];
  const parts: Record<CvSectionKey, [number, number]> = {
    personal: [15, personalParts.filter(Boolean).length / 3],
    summary: [15, Math.min(cv.summary.trim().length, 120) / 120],
    education: [15, cv.education.some((e) => filled(e.institution)) ? 1 : 0],
    experience: [15, cv.experience.some((e) => filled(e.company) && filled(e.role)) ? 1 : 0],
    skills: [20, Math.min(cv.skills.filter(filled).length, 5) / 5],
    languages: [5, cv.languages.some((l) => filled(l.name)) ? 1 : 0],
    projects: [10, cv.projects.some((x) => filled(x.name)) ? 1 : 0],
    certificates: [5, cv.certificates.some((c) => filled(c.name)) ? 1 : 0],
  };
  const sections = CV_SECTIONS.map((key) => ({ key, weight: parts[key][0], earned: Math.round(parts[key][0] * parts[key][1] * 100) / 100 }));
  const score = Math.round(sections.reduce((n, x) => n + x.earned, 0));
  const missing = sections
    .filter((x) => x.earned < x.weight)
    .sort((a, b) => b.weight - b.earned - (a.weight - a.earned))
    .map((x) => x.key);
  return { score, sections, missing };
}

/**
 * Compact plain-text rendering of a CV for the AI (CV feedback). Text only, section headings in English so the model sees
 * a stable structure; the caller fences the result with wrapUntrusted. Name, e-mail, phone and links are left out on purpose.
 */
export function cvToPlainText(cv: CvData): string {
  const out: string[] = [];
  const p = cv.personal;
  const head = [p.headline, p.city].filter(filled).join(" | ");
  if (head) out.push(`PERSONAL: ${head}`);
  if (filled(cv.summary)) out.push(`SUMMARY: ${cv.summary.trim()}`);
  if (cv.education.length)
    out.push("EDUCATION:\n" + cv.education.map((e) => `- ${[e.degree, e.field, e.institution].filter(filled).join(", ")} (${[e.start, e.end].filter(filled).join(" - ")})${filled(e.gpa) ? ` GPA ${e.gpa}` : ""}${filled(e.description) ? `: ${e.description}` : ""}`).join("\n"));
  if (cv.experience.length)
    out.push("EXPERIENCE:\n" + cv.experience.map((e) => `- ${[e.role, e.company, e.location].filter(filled).join(", ")} (${[e.start, e.current ? "present" : e.end].filter(filled).join(" - ")})${e.bullets.map((b) => `\n  * ${b}`).join("")}`).join("\n"));
  if (cv.projects.length)
    out.push("PROJECTS:\n" + cv.projects.map((x) => `- ${x.name}${x.tech.length ? ` [${x.tech.join(", ")}]` : ""}${filled(x.description) ? `: ${x.description}` : ""}`).join("\n"));
  if (cv.skills.length) out.push(`SKILLS: ${cv.skills.join(", ")}`);
  if (cv.languages.length) out.push(`LANGUAGES: ${cv.languages.map((l) => `${l.name}${filled(l.level) ? ` (${l.level})` : ""}`).join(", ")}`);
  if (cv.certificates.length) out.push("CERTIFICATES:\n" + cv.certificates.map((c) => `- ${[c.name, c.issuer, c.year].filter(filled).join(", ")}`).join("\n"));
  return out.join("\n\n");
}
