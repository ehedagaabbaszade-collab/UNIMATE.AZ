import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { createTranslator, type Locale } from "@unimate/i18n";
import type { ExamRow, TaskRow } from "../../lib/db";
import { isReminderId, planReminders } from "../../lib/reminders";

/** Local scheduled notifications only (no push server, no tokens). */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export type PermissionState = "granted" | "denied";

export async function ensurePermission(locale: Locale): Promise<PermissionState> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("reminders", { name: createTranslator(locale)("mobile.planner.remindersTitle"), importance: Notifications.AndroidImportance.DEFAULT }).catch(() => undefined);
  }
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return "granted";
  if (!cur.canAskAgain) return "denied";
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted ? "granted" : "denied";
}

export async function cancelReminders(): Promise<void> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(pending.filter((p) => isReminderId(p.identifier)).map((p) => Notifications.cancelScheduledNotificationAsync(p.identifier)));
}

/** Replaces all UNIMATE reminders with the plan for the current schedule. Returns how many were scheduled. */
export async function syncReminders(locale: Locale, tasks: readonly TaskRow[], exams: readonly ExamRow[]): Promise<number> {
  const t = createTranslator(locale);
  await cancelReminders();
  const plan = planReminders(tasks, exams, new Date());
  for (const r of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: t(r.kind === "exam" ? "mobile.planner.reminderExam" : "mobile.planner.reminderTask") },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, ...(Platform.OS === "android" ? { channelId: "reminders" } : {}) },
    });
  }
  return plan.length;
}
