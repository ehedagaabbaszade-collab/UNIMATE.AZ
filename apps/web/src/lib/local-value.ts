"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";

/**
 * Browser-local JSON value (same keys/schemas as the mobile app), validated on read: a bad or old shape falls back to `initial`.
 * shortcut: device-only, not synced across devices; move to a Supabase table + RLS when cross-device sync is wanted.
 */
export function useLocalValue<T>(key: string, schema: z.ZodType<T>, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const latest = useRef(value);
  latest.current = value;
  const corrupt = useRef(false); // a stored value exists but did not load: never overwrite it

  useEffect(() => {
    let next = initial;
    corrupt.current = false;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        corrupt.current = true;
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          next = parsed.data;
          corrupt.current = false;
        }
      }
    } catch {
      // unavailable storage or corrupt JSON: show the default
    }
    latest.current = next;
    setValue(next);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (fn: (prev: T) => T): boolean => {
      if (corrupt.current) return false;
      const next = fn(latest.current);
      if (!schema.safeParse(next).success) return false; // never persist a shape that would not load back
      latest.current = next;
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // storage full or blocked: keep in-memory value
      }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return { value, ready, update };
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
