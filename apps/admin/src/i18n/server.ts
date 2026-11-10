import { cookies } from "next/headers";
import { createTranslator, LOCALE_COOKIE, toLocale, type Locale } from "@unimate/i18n";

export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return toLocale(store.get(LOCALE_COOKIE)?.value);
}
export async function getT() {
  const locale = await getLocale();
  return { locale, t: createTranslator(locale) };
}
