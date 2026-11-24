/** Brand presets (Unimate palette) plus neutrals; any 6-digit hex is accepted through the custom field. */
export const CV_COLOR_PRESETS = ["#4F46E5", "#7C3AED", "#3B82F6", "#06B6DA", "#111827", "#1F3A5F", "#0F766E", "#B45309"] as const;
export const BACKGROUND_PRESETS = ["#FFFFFF", "#F1F5FF", "#FAF7F0"] as const;
export const isHex6 = (v: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(v.trim());
/** Normalises "4f46e5" or "#4f46e5" to "#4F46E5", or null when it is not a 6-digit hex colour. */
export function normalizeHex(v: string): string | null {
  const t = v.trim();
  const h = t.startsWith("#") ? t : `#${t}`;
  return isHex6(h) ? h.toUpperCase() : null;
}
