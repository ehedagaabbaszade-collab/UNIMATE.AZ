const YEAR = 60 * 60 * 24 * 365;
/** Client-side preference cookie (locale, theme, onboarding flag). Not for secrets. */
export const writeCookie = (name: string, value: string) => {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
};
export const readCookie = (name: string): string | null => {
  const m = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
};
