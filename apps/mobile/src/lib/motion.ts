import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform } from "react-native";

/** Spring presets (native driver friendly: only transform/opacity are animated with them). */
export const springs = {
  press: { damping: 14, stiffness: 320, mass: 0.6 },
  soft: { damping: 18, stiffness: 180, mass: 0.9 },
  bouncy: { damping: 9, stiffness: 220, mass: 0.7 },
} as const;

export const easings = { out: Easing.out(Easing.cubic), inOut: Easing.inOut(Easing.cubic) } as const;

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

/** Press scale spring: returns the animated value and press handlers. */
export function usePressScale(to = 0.96) {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const run = (v: number) => {
    if (reduced) return scale.setValue(1);
    Animated.spring(scale, { toValue: v, ...springs.press, useNativeDriver: true }).start();
  };
  return { scale, onPressIn: () => run(to), onPressOut: () => run(1) };
}

/** Fade + rise on mount; instant when reduced motion is on. `delay` staggers siblings. */
export function useEnter(delay = 0, distance = 14) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return v.setValue(1);
    const a = Animated.timing(v, { toValue: 1, duration: 380, delay, easing: easings.out, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reduced, delay, v]);
  return {
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
  };
}
