import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Easing, Platform } from "react-native";
import { Easing as REasing, cubicBezier } from "react-native-reanimated";

/** Spring presets (native driver friendly: only transform/opacity are animated with them). */
export const springs = {
  press: { damping: 14, stiffness: 320, mass: 0.6 },
  soft: { damping: 18, stiffness: 180, mass: 0.9 },
  bouncy: { damping: 9, stiffness: 220, mass: 0.7 },
} as const;

/** Strong ease-out for UI, ease-in-out for on-screen moves (never ease-in on UI). */
/** Reanimated curves (expo-animation tables): CSS transitions take cubicBezier, layout/timing animations take Easing.bezier. */
export const CSS_EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
export const CSS_EASE_IN_OUT = cubicBezier(0.77, 0, 0.175, 1);
export const EASE_OUT = REasing.bezier(0.23, 1, 0.32, 1);

export const easings = { out: Easing.bezier(0.23, 1, 0.32, 1), inOut: Easing.bezier(0.77, 0, 0.175, 1) } as const;

/** Tracks the OS "reduce motion" setting. Animations collapse to instant/opacity-only when true. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduced(v)).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/** Haptics never throw and are skipped where unsupported (web). */
const safe = (fn: () => Promise<void>) => {
  if (Platform.OS === "web") return;
  void fn().catch(() => undefined);
};
export const haptic = {
  tap: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  select: () => safe(() => Haptics.selectionAsync()),
  medium: () => safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};


