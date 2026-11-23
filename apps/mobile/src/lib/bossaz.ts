/**
 * Boss.az integration, by permitted deep links only.
 * Boss.az has no public API (every probed endpoint answers 403), its terms (section 8) forbid access with automated
 * programs, and its search ignores keyword parameters; only category filters work. So UNIMATE never reads, copies or
 * caches vacancies. It ranks Boss.az job categories from the student's own profile and opens Boss.az's own category
 * page (https://boss.az/search/vacancies?categoryIds=<id>) in the system browser, where the real listings are shown.
 * Category ids come from Boss.az's public sitemap page (https://boss.az/pages/sitemap) and were checked to return results.
 */
export interface InterestDef {
  id: string;
  /** Boss.az category ids (leaf categories from its sitemap) */
  categoryIds: readonly number[];
  /** Folded substrings of a specialty / faculty / skill that indicate this field. */
  keywords: readonly string[];
}

export const INTERESTS: readonly InterestDef[] = [
  { id: "management", categoryIds: [108, 110, 143], keywords: ["idare", "menecment", "management", "menecer", "biznes", "business", "administr", "rehber"] },
  { id: "finance", categoryIds: [52, 51, 155, 57, 256], keywords: ["maliyye", "muhasib", "ucot", "iqtisad", "audit", "finance", "accounting", "vergi", "economic"] },
  { id: "banking", categoryIds: [48, 154], keywords: ["bank", "kredit", "sigorta", "investisiya"] },
  { id: "hr", categoryIds: [143], keywords: ["insan resurs", "kadr", "psixolog", "sosial is", "human resource"] },
  { id: "admin", categoryIds: [105, 110, 112], keywords: ["ofis", "katib", "sekret", "inzibati", "kargüzar", "office"] },
  { id: "procurement", categoryIds: [260, 259, 263, 264], keywords: ["satinalma", "techizat", "tedaruk", "procurement", "supply"] },
  { id: "logistics", categoryIds: [240, 158], keywords: ["logistik", "neqliyyat", "gomruk", "logistic", "transport"] },
  { id: "sales", categoryIds: [86, 268, 271], keywords: ["satis", "ticaret", "commerce", "sales"] },
  { id: "marketing", categoryIds: [64, 249, 250, 248], keywords: ["marketinq", "marketing", "reklam", "jurnalist", "media", "ictimaiyyetle"] },
  { id: "it", categoryIds: [69, 68, 66, 70], keywords: ["informatika", "komputer", "proqram", "software", "computer", "data", "sistem", "telekom", "elektronika"] },
  { id: "engineering", categoryIds: [93, 91, 92], keywords: ["muhendis", "engineer", "texnik", "neft", "energet", "insaat", "memar", "mexanik", "kimya"] },
  { id: "medicine", categoryIds: [139, 140, 275], keywords: ["tibb", "tebabet", "stomatolog", "pediatr", "eczaci", "medic", "hemsire", "laborator", "massaj"] },
  { id: "education", categoryIds: [119, 120, 121, 122], keywords: ["muellim", "pedaqo", "ibtidai", "tehsil", "teacher", "education", "filolog"] },
  { id: "law", categoryIds: [79, 73], keywords: ["huquq", "law", "hakim", "vekil"] },
  { id: "design", categoryIds: [159, 97], keywords: ["dizayn", "design", "resm", "incesenet", "foto", "video"] },
  { id: "tourism", categoryIds: [142, 195, 134], keywords: ["turizm", "mehmanxana", "otel", "tourism", "hotel", "restoran", "qida"] },
  { id: "customer", categoryIds: [270, 239], keywords: ["musteri", "operator", "cagri", "call"] },
];

/** Boss.az's own "Tələbələr üçün" (for students) category: the entry-level suggestion for students without experience. */
export const STUDENT_CATEGORY_ID = 160;

/** Same folding as the catalog search: diacritics and i/ı/İ differences must not hide a match. */
export const fold = (s: string): string =>
  s
    .toLocaleLowerCase("az")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/ə/g, "e");

export const categoryUrl = (ids: readonly number[]): string => `https://boss.az/search/vacancies?${ids.map((i) => `categoryIds=${i}`).join("&")}`;

export interface CareerPrefs {
  interests: string[];
}
export const EMPTY_PREFS: CareerPrefs = { interests: [] };

/** What we know about the signed-in student (all optional: a brand-new student with no CV still gets a useful entry point). */
export interface ProfileSignals {
  major?: string | null;
  faculty?: string | null;
  institution?: string | null;
  skills: readonly string[];
}

export type Reason = { kind: "major"; text: string } | { kind: "interest"; interestId: string } | { kind: "skill"; text: string } | { kind: "entry" };

export interface Recommendation {
  id: string;
  /** null = the generic student category */
  interestId: string | null;
  url: string;
  reasons: Reason[];
  /** true when it matches the profile (specialty, skills or chosen interests) */
  matched: boolean;
  score: number;
}

export function recommend(signals: ProfileSignals, prefs: CareerPrefs): Recommendation[] {
  const major = signals.major ? fold(signals.major) : "";
  const faculty = signals.faculty ? fold(signals.faculty) : "";
  const skills = signals.skills.map((s) => ({ raw: s, folded: fold(s) }));
  const out: Recommendation[] = [];

  for (const def of INTERESTS) {
    const reasons: Reason[] = [];
    let score = 0;
    const hit = (hay: string) => def.keywords.some((k) => hay.includes(fold(k)));
    if (major && hit(major)) {
      reasons.push({ kind: "major", text: signals.major! });
      score += 4;
    } else if (faculty && hit(faculty)) {
      reasons.push({ kind: "major", text: signals.faculty! });
      score += 2;
    }
    if (prefs.interests.includes(def.id)) {
      reasons.push({ kind: "interest", interestId: def.id });
      score += 3;
    }
    for (const s of skills) {
      if (hit(s.folded) && reasons.filter((r) => r.kind === "skill").length < 2) {
        reasons.push({ kind: "skill", text: s.raw });
        score += 1;
      }
    }
    if (score === 0) continue;
    out.push({ id: `interest-${def.id}`, interestId: def.id, url: categoryUrl(def.categoryIds), reasons, matched: true, score });
  }
  out.sort((a, b) => b.score - a.score || INTERESTS.findIndex((i) => i.id === a.interestId) - INTERESTS.findIndex((i) => i.id === b.interestId));
  // Always offer Boss.az's student category last: useful for students with little or no experience.
  out.push({ id: "students", interestId: null, url: categoryUrl([STUDENT_CATEGORY_ID]), reasons: [{ kind: "entry" }], matched: false, score: 0 });
  return out;
}
