/** Pure card helpers for the DEMO checkout. Nothing here stores or logs card data. */
export type CardBrand = "visa" | "mastercard";

/** The only numbers the demo accepts, and what they simulate. */
export const TEST_CARDS: Readonly<Record<string, "succeeded" | "failed">> = {
  "4242424242424242": "succeeded",
  "5555555555554444": "succeeded",
  "4000000000000002": "failed",
};

export const digitsOf = (s: string): string => s.replace(/\D/g, "");

export function formatCardNumber(s: string): string {
  return (digitsOf(s).slice(0, 16).match(/.{1,4}/g) ?? []).join(" ");
}

export function detectBrand(s: string): CardBrand | null {
  const d = digitsOf(s);
  if (d.startsWith("4")) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(d)) return "mastercard";
  return null;
}

export function luhn(s: string): boolean {
  const d = digitsOf(s);
  if (d.length < 12) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

export function formatExpiry(s: string): string {
  let d = digitsOf(s).slice(0, 4);
  if (d.length === 1 && Number(d) > 1) d = `0${d}`;
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

/** MM/YY, month 1-12, valid through the end of the expiry month. */
export function expiryValid(s: string, now: Date = new Date()): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(s);
  if (!m) return false;
  const mm = Number(m[1]);
  const yy = 2000 + Number(m[2]);
  return mm >= 1 && mm <= 12 && yy * 12 + mm >= now.getFullYear() * 12 + now.getMonth() + 1;
}

export const cvvValid = (s: string): boolean => /^\d{3,4}$/.test(s);

export const isTestCard = (s: string): boolean => digitsOf(s) in TEST_CARDS;

export const last4 = (s: string): string => digitsOf(s).slice(-4);

/** Preview text: untyped slots are dots, the middle groups stay hidden. */
export function maskCard(s: string): string {
  const d = digitsOf(s).slice(0, 16).padEnd(16, "•");
  return [0, 4, 8, 12].map((i) => (i === 4 || i === 8 ? d.slice(i, i + 4).replace(/\d/g, "•") : d.slice(i, i + 4))).join(" ");
}
