import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KvStore } from "./offline-cache";

/** Non-sensitive local data (theme, locale, schedule cache). Tokens never go here: they use SecureStore. */
export const kv: KvStore = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

export const KEYS = { theme: "um.theme", locale: "um.locale", reminders: "um.reminders" } as const;

export const onboardingSkipKey = (uid: string) => `um.onboardingSkipped.${uid}`;
