import type { ExamRow, TaskRow, TimetableRow } from "./db";

/** Last successfully fetched schedule, stored per user in a key/value store (AsyncStorage in the app). */
export interface ScheduleSnapshot {
  userId: string;
  savedAt: string;
  timetable: TimetableRow[];
  tasks: TaskRow[];
  exams: ExamRow[];
}

export interface KvStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const key = (userId: string) => `um.schedule.${userId}`;

/** Validates the stored JSON shape; anything else (corrupt, another user, old format) is dropped. */
export function parseSnapshot(raw: string | null, userId: string): ScheduleSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ScheduleSnapshot> | null;
    if (!v || v.userId !== userId || typeof v.savedAt !== "string" || !Array.isArray(v.timetable) || !Array.isArray(v.tasks) || !Array.isArray(v.exams)) return null;
    return v as ScheduleSnapshot;
  } catch {
    return null;
  }
}

export async function saveSchedule(store: KvStore, snapshot: ScheduleSnapshot): Promise<boolean> {
  try {
    await store.setItem(key(snapshot.userId), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

export async function loadSchedule(store: KvStore, userId: string): Promise<ScheduleSnapshot | null> {
  try {
    return parseSnapshot(await store.getItem(key(userId)), userId);
  } catch {
    return null;
  }
}

export async function clearSchedule(store: KvStore, userId: string): Promise<void> {
  try {
    await store.removeItem(key(userId));
  } catch {
    /* ignore */
  }
}
