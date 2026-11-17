import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PINS, MAX_PINS, MODULES } from "../lib/registry";
import { kv, pinsKey } from "../lib/storage";

/** Device-local list of module ids pinned to the tab bar (between Home and More). Shared live between the bar and the More screen. */
let cache: { uid: string; ids: string[] } | null = null;
const listeners = new Set<(ids: string[]) => void>();

const parse = (v: string | null): string[] => {
  try {
    const ids = JSON.parse(v ?? "null");
    if (Array.isArray(ids)) return ids.filter((id): id is string => MODULES.some((m) => m.id === id)).slice(0, MAX_PINS);
  } catch {
    // corrupt value: fall back to the defaults
  }
  return [...DEFAULT_PINS];
};

export function usePins(uid: string) {
  const [ids, setIds] = useState<string[]>(cache?.uid === uid ? cache.ids : [...DEFAULT_PINS]);
  useEffect(() => {
    let alive = true;
    if (cache?.uid !== uid) {
      void kv
        .getItem(pinsKey(uid))
        .catch(() => null)
        .then((v) => {
          cache = { uid, ids: parse(v) };
          if (alive) setIds(cache.ids);
        });
    }
    listeners.add(setIds);
    return () => {
      alive = false;
      listeners.delete(setIds);
    };
  }, [uid]);
  const save = useCallback(
    (next: string[]) => {
      cache = { uid, ids: next };
      listeners.forEach((l) => l(next));
      void kv.setItem(pinsKey(uid), JSON.stringify(next)).catch(() => undefined);
    },
    [uid],
  );
  /** Returns false when the bar is already full. */
  const pin = useCallback((id: string) => {
    if (ids.includes(id)) return true;
    if (ids.length >= MAX_PINS) return false;
    save([...ids, id]);
    return true;
  }, [ids, save]);
  const unpin = useCallback((id: string) => save(ids.filter((x) => x !== id)), [ids, save]);
  return { ids, pin, unpin };
}
