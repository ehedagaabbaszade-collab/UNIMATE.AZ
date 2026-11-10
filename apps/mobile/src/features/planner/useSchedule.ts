import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useState } from "react";
import type { ExamRow, TaskRow, TimetableRow } from "../../lib/db";
import { loadSchedule, saveSchedule, type ScheduleSnapshot } from "../../lib/offline-cache";
import { kv } from "../../lib/storage";
import { useUser } from "../../state/session";

export interface ScheduleState {
  data: Pick<ScheduleSnapshot, "timetable" | "tasks" | "exams"> | null;
  /** "cache" = last snapshot saved on this device (network unavailable). */
  source: "live" | "cache" | null;
  savedAt: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Timetable + tasks + exams from the real tables; falls back to the last saved snapshot when offline. */
export function useSchedule(): ScheduleState {
  const { user, supabase: sb } = useUser();
  const [state, setState] = useState<Omit<ScheduleState, "reload">>({ data: null, source: null, savedAt: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromCache = async (error: string | null) => {
        const snap = await loadSchedule(kv, user.id);
        if (cancelled) return;
        if (snap) setState({ data: snap, source: "cache", savedAt: snap.savedAt, loading: false, error: null });
        else setState({ data: null, source: null, savedAt: null, loading: false, error: error ?? "offline" });
      };
      const net = await NetInfo.fetch().catch(() => null);
      if (net && net.isConnected === false) return fromCache(null);
      try {
        const [tt, tasks, exams] = await Promise.all([
          sb.from("timetable_entries").select("id,title,weekday,start_time,end_time,location").order("weekday").order("start_time"),
          sb.from("tasks").select("id,title,due_at,status,priority,completed_at").order("due_at", { ascending: true, nullsFirst: false }),
          sb.from("exams").select("id,title,starts_at,duration_minutes,location,weight").order("starts_at"),
        ]);
        const err = tt.error ?? tasks.error ?? exams.error;
        if (err) throw new Error(err.message);
        const snapshot: ScheduleSnapshot = { userId: user.id, savedAt: new Date().toISOString(), timetable: tt.data as TimetableRow[], tasks: tasks.data as TaskRow[], exams: exams.data as ExamRow[] };
        void saveSchedule(kv, snapshot);
        if (!cancelled) setState({ data: snapshot, source: "live", savedAt: snapshot.savedAt, loading: false, error: null });
      } catch (e) {
        // Network failure while "online" (flaky connection): fall back to the saved snapshot if there is one.
        await fromCache(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user.id, sb, tick]);

  // Refetch when connectivity returns.
  useEffect(() => {
    let was = true;
    return NetInfo.addEventListener((s) => {
      const on = s.isConnected !== false;
      if (on && !was) setTick((n) => n + 1);
      was = on;
    });
  }, []);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
