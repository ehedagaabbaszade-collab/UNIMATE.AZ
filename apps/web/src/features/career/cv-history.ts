/** Undo/redo over immutable snapshots. Pure; the editor decides when a change coalesces into the previous snapshot. */
export const HISTORY_LIMIT = 100;
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}
export const initHistory = <T>(present: T): History<T> => ({ past: [], present, future: [] });
/** coalesce: replace the present instead of recording a new step (fast typing = one undo step). The first edit always records. */
export function pushHistory<T>(h: History<T>, next: T, coalesce = false): History<T> {
  if (Object.is(next, h.present)) return h;
  if (coalesce && h.past.length > 0) return { past: h.past, present: next, future: [] };
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}
export function undo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  return h.past.length === 0 || prev === undefined ? h : { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}
export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  return h.future.length === 0 || next === undefined ? h : { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: h.future.slice(1) };
}
