import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KvStore } from "./offline-cache";

/** Non-sensitive local data (theme, locale, schedule cache). Tokens never go here: they use SecureStore. */
export const kv: KvStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

export const KEYS = { theme: "um.theme", locale: "um.locale", reminders: "um.reminders", focus: "um.focus" } as const;

export const careerPrefsKey = (uid: string) => `um.careerPrefs.${uid}`;

export const onboardingSkipKey = (uid: string) => `um.onboardingSkipped.${uid}`;

export const modeKey = (uid: string) => `um.mode.${uid}`;
export const tourKey = (uid: string) => `um.tour.${uid}`;
export const pinsKey = (uid: string) => `um.pins.${uid}`;
export const examsKey = (uid: string) => `um.exams.${uid}`;
