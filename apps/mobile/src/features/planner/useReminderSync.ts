import { useI18n } from "@unimate/i18n/react";
import { useEffect } from "react";
import { AppState } from "react-native";
import type { ExamRow, TaskRow } from "../../lib/db";
import { KEYS, kv } from "../../lib/storage";
import { useSession } from "../../state/session";
import { ensurePermission, syncReminders } from "./reminders-native";

/**
 * App-wide: keeps the "1 hour before" planner reminders scheduled without the Planner screen being open.
 * Reminders are on by default (kv value unset): the first run asks for permission once and remembers the answer;
 * "0" means the user switched them off in the Planner. Runs at start and whenever the app returns to the foreground.
 */
export function useReminderSync(enabled: boolean) {
  const { locale } = useI18n();
  const { supabase: sb } = useSession(); // not useUser: this runs in the layout, also during sign-out
  useEffect(() => {
    if (!enabled || !sb) return;
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true;
      try {
        let pref = await kv.getItem(KEYS.reminders);
        if (pref === null) {
          pref = (await ensurePermission(locale).catch(() => "denied")) === "granted" ? "1" : "0";
          await kv.setItem(KEYS.reminders, pref);
        }
        if (pref !== "1") return;
        const [tasks, exams] = await Promise.all([sb.from("tasks").select("id,title,due_at,status,priority,completed_at"), sb.from("exams").select("id,title,starts_at,duration_minutes,location,weight")]);
        if (tasks.error || exams.error) return; // offline: keep what is already scheduled
        await syncReminders(locale, tasks.data as TaskRow[], exams.data as ExamRow[]);
      } catch {
        // best effort: never block the app on notifications
      } finally {
        busy = false;
      }
    };
    void run();
    const sub = AppState.addEventListener("change", (s) => s === "active" && void run());
    return () => sub.remove();
  }, [enabled, locale, sb]);
}
