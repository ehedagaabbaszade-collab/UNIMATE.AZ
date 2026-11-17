"use client";

import { ExamStoreSchema, type Exam } from "@unimate/core";
import { useCallback, useEffect, useState } from "react";

// Device-local like on mobile (um.exams.<uid> in AsyncStorage): drafts and the question bank never leave this browser.
export const examsKey = (uid: string) => `um.exams.${uid}`;
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** `corrupt`: a stored value exists but does not parse; reads show an empty list, writes must not overwrite it. */
function load(uid: string): { exams: Exam[]; corrupt: boolean } {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(examsKey(uid));
    const p = raw ? ExamStoreSchema.safeParse(JSON.parse(raw)) : null;
    return p?.success ? { exams: p.data.exams, corrupt: false } : { exams: [], corrupt: !!raw };
  } catch {
    return { exams: [], corrupt: !!raw }; // storage unavailable (raw null) or unparsable JSON
  }
}
const read = (uid: string) => load(uid).exams;

export function useExamStore(uid: string) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [ready, setReady] = useState(false);
  const reload = useCallback(() => {
    setExams(read(uid));
    setReady(true);
  }, [uid]);
  useEffect(reload, [reload]);
  /** Applies `fn` to the stored list and saves it; false when the browser refused (private mode, quota, invalid). */
  const update = useCallback(
    (fn: (list: Exam[]) => Exam[]): boolean => {
      try {
        const cur = load(uid);
        if (cur.corrupt) return false;
        const next = ExamStoreSchema.parse({ exams: fn(cur.exams) });
        localStorage.setItem(examsKey(uid), JSON.stringify(next));
        setExams(next.exams);
        return true;
      } catch {
        return false;
      }
    },
    [uid],
  );
  return { exams, ready, reload, update };
}
