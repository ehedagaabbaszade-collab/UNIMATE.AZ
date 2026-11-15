import { useI18n } from "@unimate/i18n/react";
import type { IconName } from "@unimate/ui/icons";
import { useCallback, useMemo, useState } from "react";
import { PanResponder, Text, View, useWindowDimensions } from "react-native";
import RA, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { Icon } from "../../components/Icon";
import { PressableScale } from "../../components/ui";
import { haptic, useReducedMotion } from "../../lib/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { contentWidth, radii, spacing } from "../../theme/tokens";

export interface DeckItem {
  id: string;
  icon: IconName;
  title: string;
  blurb: string;
  onPress: () => void;
}

const HEIGHT = 220;
const STEP = 14; // vertical offset of each peeking layer
const EXIT = HEIGHT * 1.1; // finger travel (and exit distance) for one full swipe
const pad2 = (n: number) => String(n).padStart(2, "0");
// Called inside useAnimatedStyle (UI runtime): without the directive Reanimated aborts the app natively.
const mod = (a: number, n: number) => {
  "worklet";
  return ((a % n) + n) % n;
};
const spring = (velocity: number) => ({ duration: 400, dampingRatio: 0.8, velocity });

function Card({ item, index, total, width, pos, pull, front, reduced, onNext, onPrev }: { item: DeckItem; index: number; total: number; width: number; pos: SharedValue<number>; pull: SharedValue<number>; front: boolean; reduced: boolean; onNext: () => void; onPrev: () => void }) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const style = useAnimatedStyle(() => {
    // d: slot distance from the front, wrapped to [-1, total-1). d<0 is the card leaving upward / arriving from above.
    const d = mod(index - pos.value + 1, total) - 1;
    // Painting order follows the slot, not the array: the front card must sit on top of the peeking ones.
    const zIndex = Math.round(100 - d * 10);
    if (d < 0) {
      const u = Math.min(-d, 1);
      return reduced
        ? { zIndex, opacity: 1 - u, transform: [{ translateY: 0 }, { scale: 1 }, { rotateZ: "0deg" }] }
        : { zIndex, opacity: 1 - u, transform: [{ translateY: -EXIT * u }, { scale: 1 - 0.1 * u }, { rotateZ: `${-5 * u}deg` }] };
    }
    // Back cards stay opaque surfaces (only their bottom edge peeks out); a fourth one fades away.
    const opacity = interpolate(d, [0, 2, 3], [1, 1, 0], Extrapolation.CLAMP);
    const p = pull.value * interpolate(d, [0, 1], [1, 0], Extrapolation.CLAMP);
    return reduced
      ? { zIndex, opacity, transform: [{ translateY: Math.min(d, 3) * STEP }, { scale: 1 }, { rotateZ: "0deg" }] }
      : { zIndex, opacity, transform: [{ translateY: Math.min(d, 3) * STEP + p }, { scale: 1 - 0.05 * Math.min(d, 3) - p / 2400 }, { rotateZ: `${p * 0.03}deg` }] };
  });
  // Content shows only on the card at (or moving into) the front, so the stack never shows overlapping text.
  const contentStyle = useAnimatedStyle(() => {
    const d = mod(index - pos.value + 1, total) - 1;
    return { opacity: interpolate(Math.abs(d), [0, 0.7], [1, 0], Extrapolation.CLAMP) };
  });
  return (
    <RA.View pointerEvents={front ? "auto" : "none"} style={[{ position: "absolute", top: 0, width, height: HEIGHT }, style]}>
      <PressableScale
        onPress={item.onPress}
        accessibilityRole={total > 1 ? "adjustable" : "button"}
        accessibilityLabel={`${item.title}. ${item.blurb}`}
        accessibilityActions={total > 1 ? [{ name: "increment", label: t("mobile.home.swipeHint") }, { name: "decrement" }] : undefined}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === "increment" ? onNext() : onPrev())}
        accessible={front}
        style={{ flex: 1, padding: spacing.xl - 2, borderRadius: radii.xxl, borderCurve: "continuous", backgroundColor: theme.card, borderWidth: 1, borderColor: theme.cardBorder, justifyContent: "space-between" }}
      >
        <RA.View style={[{ flex: 1, justifyContent: "space-between" }, contentStyle]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Icon name={item.icon} size={26} color={theme.mode === "dark" ? theme.text : theme.primary} />
          <Text maxFontSizeMultiplier={1.2} style={{ color: theme.textMuted, fontSize: 14, fontVariant: ["tabular-nums"] }}>
            {pad2(index + 1)} / {pad2(total)}
          </Text>
        </View>
        <View style={{ gap: 6, paddingRight: 64 }}>
          {front && total > 1 ? (
            <View style={{ gap: 0 }}>
              <Text maxFontSizeMultiplier={1.2} style={{ color: theme.textMuted, fontSize: 12, lineHeight: 12 }}>
                ^
              </Text>
              <Text maxFontSizeMultiplier={1.2} style={{ color: theme.textMuted, fontSize: 12, letterSpacing: 0.2 }}>
                {t("mobile.home.swipeHint")}
              </Text>
            </View>
          ) : null}
          <Text maxFontSizeMultiplier={1.2} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ color: theme.text, fontSize: 34, lineHeight: 40, fontWeight: "300", letterSpacing: -0.8 }}>
            {item.title}
          </Text>
          <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ color: theme.textMuted, fontSize: 14, lineHeight: 19 }}>
            {item.blurb}
          </Text>
        </View>
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={{ position: "absolute", right: -6, bottom: -6, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.mode === "dark" ? theme.secondary : theme.ink, alignItems: "center", justifyContent: "center" }}>
          <Icon name="add" size={20} color="#FFFFFF" />
        </View>
        </RA.View>
      </PressableScale>
    </RA.View>
  );
}

/** Vertical card stack: swipe up sends the front card to the back, swipe down brings the last card forward. */
export function ModuleDeck({ items }: { items: DeckItem[] }) {
  const reduced = useReducedMotion();
  const { width: screenW } = useWindowDimensions();
  const width = contentWidth(screenW);
  const n = items.length;
  const [frontIdx, setFrontIdx] = useState(0);
  const pos = useSharedValue(0); // continuous deck position; integer = settled
  const tgt = useSharedValue(0); // settled target of pos (unwrapped)
  const pull = useSharedValue(0); // rubber-band offset for downward drag

  const done = useCallback((to: number) => {
    setFrontIdx(mod(to, n));
    haptic.select();
  }, [n]);

  const go = useCallback((dir: 1 | -1) => {
    if (n < 2) return;
    const to = tgt.get() + dir;
    tgt.set(to);
    pos.set(withSpring(to, spring(0)));
    done(to);
  }, [n, tgt, pos, done]);

  // shortcut: built-in PanResponder (JS thread) instead of gesture-handler, because the Expo Go build on the user's
  // phone ships an older native gesture-handler than the JS SDK 58 resolves; it only writes shared values (no
  // re-render per frame). Upgrade to gesture-handler once the app runs in a dev/release build.
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim only clear vertical drags, so taps reach the card and horizontal moves are ignored.
        onMoveShouldSetPanResponder: (_e, g) => n > 1 && Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => {
          if (g.dy < 0) {
            pull.set(0);
            pos.set(tgt.get() + Math.min(-g.dy / EXIT, 1));
          } else {
            pos.set(tgt.get());
            pull.set(Math.min(g.dy * 0.4, 70)); // rubber band
          }
        },
        onPanResponderRelease: (_e, g) => {
          const vy = g.vy * 1000; // px/ms -> px/s
          const up = g.dy < -60 || vy < -600;
          const down = g.dy > 60 || vy > 600;
          pull.set(withSpring(0, spring(0)));
          if (!up && !down) {
            pos.set(withSpring(tgt.get(), spring(-vy / EXIT)));
            return;
          }
          const to = tgt.get() + (up ? 1 : -1);
          tgt.set(to);
          pos.set(withSpring(to, spring(-vy / EXIT)));
          done(to);
        },
        onPanResponderTerminate: () => {
          pull.set(withSpring(0, spring(0)));
          pos.set(withSpring(tgt.get(), spring(0)));
        },
      }),
    [n, pos, pull, tgt, done],
  );

  return (
    <View {...pan.panHandlers} style={{ height: HEIGHT + STEP * 2 + 8, width }}>
      {items.map((item, i) => (
        <Card key={item.id} item={item} index={i} total={n} width={width} pos={pos} pull={pull} front={i === frontIdx} reduced={reduced} onNext={() => go(1)} onPrev={() => go(-1)} />
      ))}
    </View>
  );
}
