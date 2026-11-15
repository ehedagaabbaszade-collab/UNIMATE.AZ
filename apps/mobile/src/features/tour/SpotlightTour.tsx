import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from "react";
import { Modal, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useI18n } from "@unimate/i18n/react";
import { AppText, Button } from "../../components/ui";
import { kv, tourKey } from "../../lib/storage";
import { useReducedMotion } from "../../lib/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { radii, spacing } from "../../theme/tokens";

export type TourRef = RefObject<ComponentRef<typeof View> | null>;
export interface TourStep {
  ref: TourRef;
  title: string;
  body: string;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const PAD = 6;
const measure = (ref: TourRef) => new Promise<Rect | null>((resolve) => (ref.current ? ref.current.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x, y, w, h } : null)) : resolve(null)));

/**
 * Coach marks over the live screen. Shown once per user (kv `um.tour.<uid>`); clearing that key and refocusing the screen
 * replays it. Steps whose target is not visible without scrolling are skipped. Reduced motion: fade only, nothing slides.
 */
export function SpotlightTour({ uid, steps }: { uid: string; steps: TourStep[] }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const [shown, setShown] = useState<{ step: TourStep; rect: Rect }[] | null>(null);
  const [i, setI] = useState(0);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void kv.getItem(tourKey(uid)).then((v) => {
        if (!alive || v === "1") return;
        // Let the entrance animations settle before measuring.
        timer.current = setTimeout(async () => {
          const out: { step: TourStep; rect: Rect }[] = [];
          for (const step of stepsRef.current) {
            const r = await measure(step.ref);
            if (r && r.y >= 0 && r.y < height - 120) out.push({ step, rect: { ...r, h: Math.min(r.h, height - r.y - 120) } });
          }
          if (alive && out.length > 0) {
            setI(0);
            setShown(out);
          }
        }, 450);
      });
      return () => {
        alive = false;
        if (timer.current) clearTimeout(timer.current);
      };
    }, [uid, height]),
  );
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!shown) return null;
  const finish = () => {
    setShown(null);
    void kv.setItem(tourKey(uid), "1").catch(() => undefined);
  };
  const cur = shown[i]!;
  const last = i === shown.length - 1;
  const top = Math.max(0, cur.rect.y - PAD);
  const left = Math.max(0, cur.rect.x - PAD);
  const bw = cur.rect.w + PAD * 2;
  const bh = cur.rect.h + PAD * 2;
  const below = top + bh + 220 < height;
  const dim = { position: "absolute", backgroundColor: theme.overlay } as const;
  const tipPos = below ? { top: top + bh + spacing.md } : { bottom: height - top + spacing.md };

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={finish} accessibilityViewIsModal>
      <Animated.View entering={FadeIn.duration(reduced ? 0 : 200)} style={{ flex: 1 }}>
        <View style={[dim, { top: 0, left: 0, right: 0, height: top }]} />
        <View style={[dim, { top: top + bh, left: 0, right: 0, bottom: 0 }]} />
        <View style={[dim, { top, left: 0, width: left, height: bh }]} />
        <View style={[dim, { top, left: left + bw, right: 0, height: bh }]} />
        <View pointerEvents="none" style={{ position: "absolute", top, left, width: bw, height: bh, borderRadius: radii.lg, borderCurve: "continuous", borderWidth: 2, borderColor: theme.active }} />
        <Animated.View
          key={i}
          entering={reduced ? FadeIn.duration(150) : FadeInDown.duration(220)}
          style={[{ position: "absolute", left: spacing.lg, right: spacing.lg, maxWidth: Math.min(width - spacing.lg * 2, 480), padding: spacing.lg, gap: spacing.sm, borderRadius: radii.lg, borderCurve: "continuous", backgroundColor: theme.card, borderWidth: 1, borderColor: theme.cardBorder }, tipPos]}
        >
          <AppText variant="caption" muted>
            {t("teach.tour.step", { n: i + 1, m: shown.length })}
          </AppText>
          <AppText variant="heading" accessibilityRole="header">
            {cur.step.title}
          </AppText>
          <AppText>{cur.step.body}</AppText>
          <View style={{ flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end", paddingTop: spacing.xs }}>
            {!last ? <Button small variant="ghost" title={t("teach.tour.skip")} onPress={finish} /> : null}
            <Button small title={last ? t("teach.tour.done") : t("teach.tour.next")} onPress={() => (last ? finish() : setI(i + 1))} />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
