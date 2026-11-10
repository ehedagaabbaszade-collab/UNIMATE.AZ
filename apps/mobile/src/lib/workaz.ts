/**
 * Work.az integration, by permitted deep links only.
 * Work.az has no public API (api.work.az answers 401) and its user agreement forbids collecting data with bots, so UNIMATE
 * never copies or caches vacancies. It ranks search topics from the student's own profile and opens Work.az's own search
 * page (https://www.work.az/vakansiyalar?search=<term>, verified to filter results) in the system browser.
 */
export type EmploymentKind = "full_time" | "part_time" | "internship" | "remote";
export const EMPLOYMENT_KINDS: readonly EmploymentKind[] = ["full_time", "part_time", "internship", "remote"];

export interface InterestDef {
  id: string;
  /** Search words sent to Work.az (Azerbaijani, as vacancies are titled). First one is the primary search. */
  terms: readonly string[];
  /** Folded substrings of a specialty / faculty / skill that indicate this field. */
  keywords: readonly string[];
}

export const INTERESTS: readonly InterestDef[] = [
  { id: "management", terms: ["menecer", "rəhbər köməkçisi"], keywords: ["idare", "menecment", "management", "menecer", "biznes", "business", "administr", "rehber"] },
  { id: "finance", terms: ["mühasib", "maliyyə"], keywords: ["maliyye", "muhasib", "ucot", "iqtisad", "audit", "finance", "accounting", "vergi", "economic"] },
  { id: "banking", terms: ["bank əməkdaşı", "kredit mütəxəssisi"], keywords: ["bank", "kredit", "sigorta", "investisiya"] },
  { id: "hr", terms: ["kadr", "insan resursları"], keywords: ["insan resurs", "kadr", "psixolog", "sosial is", "human resource"] },
  { id: "admin", terms: ["ofis meneceri", "katib"], keywords: ["ofis", "katib", "sekret", "inzibati", "kargüzar", "office"] },
  { id: "procurement", terms: ["satınalma", "təchizat"], keywords: ["satinalma", "techizat", "tedaruk", "procurement", "supply"] },
  { id: "logistics", terms: ["logistika", "anbar"], keywords: ["logistik", "neqliyyat", "gomruk", "logistic", "transport"] },
  { id: "sales", terms: ["satış məsləhətçisi", "satış meneceri"], keywords: ["satis", "ticaret", "commerce", "sales"] },
  { id: "marketing", terms: ["marketinq", "SMM"], keywords: ["marketinq", "marketing", "reklam", "jurnalist", "media", "ictimaiyyetle"] },
  { id: "it", terms: ["proqramçı", "IT mütəxəssisi"], keywords: ["informatika", "komputer", "proqram", "software", "computer", "data", "sistem", "telekom", "elektronika"] },
  { id: "engineering", terms: ["mühəndis", "texnik"], keywords: ["muhendis", "engineer", "texnik", "neft", "energet", "insaat", "memar", "mexanik", "kimya"] },
  { id: "medicine", terms: ["tibb bacısı", "həkim köməkçisi"], keywords: ["tibb", "tebabet", "stomatolog", "pediatr", "eczaci", "medic", "hemsire", "laborator", "massaj"] },
  { id: "education", terms: ["müəllim", "tərbiyəçi"], keywords: ["muellim", "pedaqo", "ibtidai", "tehsil", "teacher", "education", "filolog"] },
  { id: "law", terms: ["hüquqşünas"], keywords: ["huquq", "law", "hakim", "vekil"] },
  { id: "design", terms: ["dizayner", "qrafik dizayn"], keywords: ["dizayn", "design", "resm", "incesenet", "foto", "video"] },
  { id: "tourism", terms: ["turizm", "otel resepşn"], keywords: ["turizm", "mehmanxana", "otel", "tourism", "hotel", "restoran", "qida"] },
  { id: "customer", terms: ["müştəri xidmətləri", "operator"], keywords: ["musteri", "operator", "cagri", "call"] },
];

const KIND_SEARCH: Record<EmploymentKind, { id: string; term: string }> = {
  full_time: { id: "kind-full_time", term: "tam ştat" },
  part_time: { id: "kind-part_time", term: "part time" },
  internship: { id: "kind-internship", term: "təcrübəçi" },
  remote: { id: "kind-remote", term: "uzaqdan" },
};

/** Same folding as the catalog search: diacritics and i/ı/İ differences must not hide a match. */
export const fold = (s: string): string =>
  s
    .toLocaleLowerCase("az")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/ə/g, "e");

export const searchUrl = (term: string): string => `https://www.work.az/vakansiyalar?search=${encodeURIComponent(term.trim())}`;

export interface CareerPrefs {
  interests: string[];
  kinds: EmploymentKind[];
}
export const EMPTY_PREFS: CareerPrefs = { interests: [], kinds: [] };

/** What we know about the signed-in student (all optional: a brand-new student with no CV still gets useful topics). */
export interface ProfileSignals {
  major?: string | null;
  faculty?: string | null;
  institution?: string | null;
  skills: readonly string[];
}

export type Reason = { kind: "major"; text: string } | { kind: "interest"; interestId: string } | { kind: "skill"; text: string } | { kind: "entry" } | { kind: "type"; type: EmploymentKind };

export interface Recommendation {
  id: string;
  interestId: string | null;
  kind: EmploymentKind | null;
  term: string;
  url: string;
  reasons: Reason[];
  /** true when it matches the profile (specialty, skills or chosen interests), false for generic entry-level suggestions */
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
    out.push({ id: `interest-${def.id}`, interestId: def.id, kind: null, term: def.terms[0]!, url: searchUrl(def.terms[0]!), reasons, matched: true, score });
  }
  out.sort((a, b) => b.score - a.score || INTERESTS.findIndex((i) => i.id === a.interestId) - INTERESTS.findIndex((i) => i.id === b.interestId));

  // Employment types the student asked for; with no experience, internships and part-time are always useful entry points.
  const wanted = new Set<EmploymentKind>(prefs.kinds);
  if (wanted.size === 0 || out.length === 0) {
    wanted.add("internship");
    wanted.add("part_time");
  }
  for (const k of EMPLOYMENT_KINDS) {
    if (!wanted.has(k)) continue;
    const chosen = prefs.kinds.includes(k);
    const ks = KIND_SEARCH[k];
    out.push({ id: ks.id, interestId: null, kind: k, term: ks.term, url: searchUrl(ks.term), reasons: chosen ? [{ kind: "type", type: k }] : [{ kind: "entry" }], matched: chosen, score: chosen ? 2 : 0 });
  }
  return out;
}
