export type Locale = "az" | "tr" | "en" | "ru" | (string & {});

function isTurkic(locale?: string): boolean {
  const l = (locale ?? "").toLowerCase();
  return l === "az" || l === "tr" || l.startsWith("az-") || l.startsWith("tr-");
}

export function lowerCase(s: string, locale?: Locale): string {
  if (isTurkic(locale)) {
    // I -> ı, İ -> i (explicit, so results do not depend on ICU data)
    return s
      .replace(/İ/g, "i")
      .replace(/İ/g, "i")
      .replace(/I/g, "ı")
      .toLowerCase();
  }
  return s.toLowerCase();
}

export function upperCase(s: string, locale?: Locale): string {
  if (isTurkic(locale)) {
    return s.replace(/i/g, "İ").replace(/ı/g, "I").toUpperCase();
  }
  return s.toUpperCase();
}

/** Case-insensitive comparison form. Locale-aware for az/tr. */
export function caseFold(s: string, locale?: Locale): string {
  const lowered = lowerCase(s.normalize("NFC"), locale);
  // ß -> ss, final sigma -> sigma (approximates full case folding)
  return lowered.replace(/ß/g, "ss").replace(/ς/g, "σ").normalize("NFC");
}

const AZ_LETTERS = new Set(["ə", "ğ", "ı", "ö", "ü", "ç", "ş"]);

export interface NormalizeOptions {
  locale?: Locale;
  /** Strip diacritics (default true). */
  stripDiacritics?: boolean;
  /** When stripping, keep Azerbaijani/Turkish letters ə ğ ı ö ü ç ş distinct (default true). */
  keepAzLetters?: boolean;
}

export function normalizeForSearch(s: string, opts: NormalizeOptions = {}): string {
  const { locale, stripDiacritics = true, keepAzLetters = true } = opts;
  let out = caseFold(s, locale);
  if (stripDiacritics) {
    out = Array.from(out)
      .map((ch) => {
        if (keepAzLetters && AZ_LETTERS.has(ch)) return ch;
        return ch.normalize("NFD").replace(/\p{M}+/gu, "");
      })
      .join("");
  }
  return out.normalize("NFC").replace(/\s+/g, " ").trim();
}
