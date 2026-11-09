import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ExamRow, TaskRow, TimetableRow } from "@/lib/db";

/**
 * Offline support for the essential schedule: the last successfully fetched timetable/tasks/exams are kept in
 * IndexedDB (per user) and shown, read-only, when the network is down. Not a service worker: the app shell itself
 * still needs a connection to load.
 */
export interface ScheduleSnapshot {
  userId: string;
  savedAt: string;
  timetable: TimetableRow[];
  tasks: TaskRow[];
  exams: ExamRow[];
}

interface Schema extends DBSchema {
  schedule: { key: string; value: ScheduleSnapshot };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;
const db = () => (dbPromise ??= openDB<Schema>("unimate-offline", 1, { upgrade: (d) => void d.createObjectStore("schedule") }));

export async function saveSchedule(snapshot: ScheduleSnapshot): Promise<boolean> {
  try {
    await (await db()).put("schedule", snapshot, snapshot.userId);
    return true;
  } catch {
    return false;
  }
}

export async function loadSchedule(userId: string): Promise<ScheduleSnapshot | null> {
  try {
    const snap = await (await db()).get("schedule", userId);
    return snap && snap.userId === userId ? snap : null;
  } catch {
    return null;
  }
}

export async function clearSchedule(userId: string): Promise<void> {
  try {
    await (await db()).delete("schedule", userId);
  } catch {
    /* ignore */
  }
}
