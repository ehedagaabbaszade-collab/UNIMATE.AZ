import { CAMPUS_PAGE_SIZE, nextPostCursor, type PostCard } from "@unimate/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Cursor } from "./api";

/** Cursor-paginated post list that keeps the last result visible on error/offline. `fetchPage` must be stable per `key`. */
export function usePagedPosts(fetchPage: (cursor: Cursor | null) => Promise<PostCard[]>, key: string) {
  const [items, setItems] = useState<PostCard[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const load = useCallback(
    async (cursor: Cursor | null) => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const rows = await fetchRef.current(cursor);
        if (my !== seq.current) return;
        setItems((prev) => (cursor ? [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))] : rows));
        setHasMore(rows.length >= CAMPUS_PAGE_SIZE);
        setError(null);
      } catch (e) {
        if (my === seq.current) setError(e instanceof Error ? e.message : "error");
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(null), [key]);
  return {
    items,
    hasMore,
    loading,
    error,
    reload: () => void load(null),
    more: () => {
      const c = nextPostCursor(items);
      if (c) void load(c);
    },
    patch: (id: string, change: Partial<PostCard>) => setItems((prev) => prev.map((p) => (p.id === id ? { ...p, ...change } : p))),
  };
}
