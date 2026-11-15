import type { IconName } from "@unimate/ui/icons";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import RA, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { EASE_OUT, haptic, useReducedMotion } from "../lib/motion";
import { MIN_TOUCH } from "../theme/tokens";
import { useTheme } from "../theme/ThemeProvider";
import { Icon } from "./Icon";
import { AppText } from "./ui";

export interface SlidingOption<T extends string> {
  value: T;
  label: string;
  /** Spoken name when the visible label is only a code. */
  a11y?: string;
  icon?: IconName;
}

/** Equal-width segmented control; the indicator slides with a Reanimated transform (instant under reduced motion). */
export function SlidingSegmented<T extends string>({ options, value, onChange, label, stacked, height = MIN_TOUCH }: { options: readonly SlidingOption<T>[]; value: T; onChange: (v: T) => void; label: string; /** Icon above the label. */ stacked?: boolean; height?: number }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const seg = width > 0 ? (width - 8) / options.length : 0;
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = reduced ? idx * seg : withTiming(idx * seg, { duration: 220, easing: EASE_OUT });
  }, [idx, seg, reduced, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const dark = theme.mode === "dark";
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: "row", padding: 4, borderRadius: 18, borderCurve: "continuous", backgroundColor: theme.cardStrong }}>
      {seg > 0 ? <RA.View pointerEvents="none" style={[{ position: "absolute", top: 4, bottom: 4, left: 4, width: seg, borderRadius: 14, borderCurve: "continuous", backgroundColor: dark ? theme.border : theme.card, boxShadow: dark ? undefined : "0 1px 4px rgba(16,24,43,0.16)" }, slide]} /> : null}
      {options.map((o) => {
        const on = o.value === value;
        const tint = on ? theme.active : theme.textMuted;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              if (!on) haptic.select();
              onChange(o.value);
            }}
            accessibilityRole="tab"
            accessibilityLabel={o.a11y ?? o.label}
            accessibilityState={{ selected: on }}
            style={{ flex: 1, minHeight: height, alignItems: "center", justifyContent: "center", flexDirection: stacked ? "column" : "row", gap: stacked ? 2 : 6 }}
          >
            {o.icon ? <Icon name={o.icon} size={stacked ? 20 : 18} color={tint} /> : null}
            <AppText importantForAccessibility="no" maxFontSizeMultiplier={1.3} numberOfLines={1} style={{ color: on ? theme.text : theme.textMuted, fontWeight: on ? "600" : "500", fontSize: stacked ? 12 : 14 }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
