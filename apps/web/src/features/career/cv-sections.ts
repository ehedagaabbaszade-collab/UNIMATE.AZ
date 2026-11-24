import { CV_DESIGN_SECTIONS, type CvDesign, type CvDesignSection } from "@unimate/core";

/** Moves arr[from] to index `to` (clamped). Returns a copy; nothing moves when the index is out of range. */
export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const t = Math.max(0, Math.min(arr.length - 1, to));
  if (from < 0 || from >= arr.length || from === t) return [...arr];
  const out = [...arr];
  out.splice(t, 0, ...out.splice(from, 1));
  return out;
}
/** Section order completed with any section the list misses (stored designs may list only some). */
export const completeOrder = (order: readonly CvDesignSection[]): CvDesignSection[] => [...new Set([...order, ...CV_DESIGN_SECTIONS])];
export const moveSectionBy = (order: readonly CvDesignSection[], section: CvDesignSection, delta: -1 | 1): CvDesignSection[] => {
  const full = completeOrder(order);
  return moveItem(full, full.indexOf(section), full.indexOf(section) + delta);
};
/** Drag and drop: put `section` where `target` is. */
export const dropSection = (order: readonly CvDesignSection[], section: CvDesignSection, target: CvDesignSection): CvDesignSection[] => {
  const full = completeOrder(order);
  return moveItem(full, full.indexOf(section), full.indexOf(target));
};
export const toggleHidden = (hidden: readonly CvDesignSection[], section: CvDesignSection): CvDesignSection[] =>
  hidden.includes(section) ? hidden.filter((s) => s !== section) : [...hidden, section];
/** Design with the patch applied and undefined keys removed (a cleared option falls back to the template default). */
export const patchDesign = (design: CvDesign, patch: Partial<Record<keyof CvDesign, unknown>>): CvDesign => {
  const out: Record<string, unknown> = { ...design, ...patch };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as CvDesign;
};
