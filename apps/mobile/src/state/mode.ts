import { useCallback, useEffect, useState } from "react";
import { kv, modeKey } from "../lib/storage";

/** Device-local UI preference (student or teacher). It never touches profiles.role: a real teacher role needs a server migration. */
export type AppMode = "student" | "teacher";
type Listener = (uid: string, mode: AppMode) => void;
const listeners = new Set<Listener>();

/** `mode` is undefined while loading and null when the user has not chosen yet. */
export function useAppMode(uid: string | null) {
  const [mode, setLocal] = useState<AppMode | null | undefined>(undefined);
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    void kv.getItem(modeKey(uid)).then((v) => alive && setLocal(v === "student" || v === "teacher" ? v : null));
    const l: Listener = (u, m) => u === uid && setLocal(m);
    listeners.add(l);
    return () => {
      alive = false;
      listeners.delete(l);
    };
  }, [uid]);
  const setMode = useCallback(
    async (m: AppMode) => {
      if (!uid) return;
      await kv.setItem(modeKey(uid), m);
      listeners.forEach((l) => l(uid, m));
    },
    [uid],
  );
  return { mode, setMode };
}
