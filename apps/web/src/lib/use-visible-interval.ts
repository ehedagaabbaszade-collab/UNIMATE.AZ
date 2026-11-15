import { useEffect } from "react";

/**
 * Calls `fn` every `ms` while `active`, but only while the tab is visible (Page Visibility API): a hidden tab makes no
 * requests, and becoming visible again refreshes at once instead of waiting a full interval.
 */
export function useVisibleInterval(fn: () => void, ms: number, active: boolean) {
  useEffect(() => {
    if (!active) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined && !document.hidden) id = setInterval(fn, ms);
    };
    const stop = () => {
      clearInterval(id);
      id = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) return stop();
      fn();
      start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fn, ms, active]);
}
