import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { createTranslator, type Locale } from "@unimate/i18n";
import type { ExamRow, TaskRow } from "../../lib/db";
import { isClassReminderId, isReminderId, planReminders, type ClassDeadline, type PlannedReminder } from "../../lib/reminders";

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

export async function cancelReminders(keep: (id: string) => boolean = () => false): Promise<void> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(pending.filter((p) => isReminderId(p.identifier) && !keep(p.identifier)).map((p) => Notifications.cancelScheduledNotificationAsync(p.identifier)));
}

const BODY = {
  task: "mobile.planner.reminderTask",
  exam: "mobile.planner.reminderExam",
  assignment: "mobile.planner.reminderAssignment",
  classExam: "mobile.planner.reminderClassExam",
} as const satisfies Record<PlannedReminder["kind"], string>;

/**
 * Replaces the UNIMATE reminders with the plan. Without `classWork` (the Planner screen, which knows only tasks and
 * exams) the class reminders scheduled by the app-wide sync are kept as they are.
 */
export async function syncReminders(locale: Locale, tasks: readonly TaskRow[], exams: readonly ExamRow[], classWork?: readonly ClassDeadline[]): Promise<number> {
  const t = createTranslator(locale);
  await cancelReminders(classWork ? undefined : isClassReminderId);
  const plan = planReminders(tasks, exams, new Date(), undefined, classWork ?? []);
  for (const r of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: t(BODY[r.kind]) },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, ...(Platform.OS === "android" ? { channelId: "reminders" } : {}) },
    });
  }
  return plan.length;
}
