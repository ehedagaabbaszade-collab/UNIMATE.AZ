import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { kv } from "./storage";
import { validatedUpdate } from "./validated-update";

/**
 * Device-local JSON value, validated on read (storage is outside our control: a bad or old shape falls back to
 * `initial` instead of crashing). Used for private, per-student tools (courses, budget) that need no server.
 * shortcut: device-only, not synced across devices; move to a Supabase table + RLS when cross-device sync is wanted.
 */
export function useLocalValue<T>(key: string | null, schema: z.ZodType<T>, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(value);
  latest.current = value;

  useEffect(() => {
    let alive = true;
    if (!key) return;
    void kv.getItem(key).then((raw) => {
      if (!alive) return;
      let next = initial;
      if (raw) {
        try {
          const parsed = schema.safeParse(JSON.parse(raw));
          if (parsed.success) next = parsed.data;
        } catch {
          // corrupt JSON: start fresh
        }
      }
      setValue(next);
      setReady(true);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const update = useCallback(
    (fn: (prev: T) => T): boolean => {
      const { value: next, ok } = validatedUpdate(schema, latest.current, fn);
      if (!ok) return false; // never persist a shape that would not load back
      latest.current = next;
      setValue(next);
      if (key) void kv.setItem(key, JSON.stringify(next));
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  /** Re-read from storage (another screen may have written it). */
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { value, ready, update, reload };
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
