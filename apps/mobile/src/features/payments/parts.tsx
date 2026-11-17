import { useI18n } from "@unimate/i18n/react";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import RA, { Easing, FadeIn, FadeOut, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../../components/Icon";
import { AppText, Button } from "../../components/ui";
import { EASE_OUT, haptic, useReducedMotion } from "../../lib/motion";
import { useTheme } from "../../theme/ThemeProvider";
import { radii, spacing } from "../../theme/tokens";
import type { CardBrand } from "./card";
import { WALLET_NAME } from "./usePayment";

const VISA = "VISA";

/** Shown on every checkout screen and on the receipt. */
export function DemoBadge() {
  const { t } = useI18n();
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: theme.warningSoft, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7 }}>
      <Icon name="info" size={14} color={theme.warning} />
      <AppText variant="caption" style={{ color: theme.warning, fontWeight: "700", flexShrink: 1 }}>
        {t("mobile.checkout.demo")}
      </AppText>
    </View>
  );
}

/** Simple drawn marks (not trademark artwork). */
export function BrandMark({ brand, height = 22 }: { brand: CardBrand | null; height?: number }) {
  if (brand === "visa") {
    return (
      <View style={{ height, paddingHorizontal: height * 0.4, borderRadius: height * 0.25, backgroundColor: "#FFFFFF", justifyContent: "center" }}>
        <Text style={{ color: "#1A1F71", fontStyle: "italic", fontWeight: "900", fontSize: height * 0.6, letterSpacing: 0.5 }}>{VISA}</Text>
      </View>
    );
  }
  if (brand === "mastercard") {
    return (
      <View style={{ flexDirection: "row", height, width: height * 1.6, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: height, height, borderRadius: height / 2, backgroundColor: "#EB001B" }} />
        <View style={{ width: height, height, borderRadius: height / 2, backgroundColor: "#F79E1B", opacity: 0.9, marginLeft: -height * 0.4 }} />
      </View>
    );
  }
  return null;
}

/** Full-screen processing state: spinning arc, fading step texts, cancel until the provider answers. */
export function Processing({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const spin = useSharedValue(0);
  const [step, setStep] = useState(0);
  useEffect(() => {
    spin.value = withRepeat(withTiming(360, { duration: reduced ? 2400 : 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(spin);
  }, [reduced, spin]);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, 2)), 700);
    return () => clearInterval(id);
  }, []);
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  return (
    <RA.View entering={FadeIn.duration(200)} accessibilityViewIsModal style={[StyleSheet.absoluteFill, { backgroundColor: theme.bg, alignItems: "center", justifyContent: "center", gap: spacing.xl, padding: spacing.xl }]}>
      <RA.View style={[{ width: 76, height: 76, borderRadius: 38, borderWidth: 5, borderColor: theme.border, borderTopColor: theme.primary }, ring]} />
      <View style={{ height: 28, alignItems: "center", justifyContent: "center" }}>
        <RA.View key={step} entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={{ position: "absolute" }}>
          <AppText variant="heading" accessibilityLiveRegion="polite">
            {step === 0 ? t("mobile.checkout.s1") : step === 1 ? t("mobile.checkout.s2") : t("mobile.checkout.s3")}
          </AppText>
        </RA.View>
      </View>
      <DemoBadge />
      <Button title={t("mobile.checkout.cancel")} variant="ghost" small onPress={onCancel} />
    </RA.View>
  );
}

/** Imitates a native wallet sheet (demo only; no Apple/Google API). */
export function WalletSheet({ open, planName, total, onConfirm, onClose }: { open: boolean; planName: string; total: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <SheetBody planName={planName} total={total} onConfirm={onConfirm} onClose={onClose} />
    </Modal>
  );
}

function SheetBody({ planName, total, onConfirm, onClose }: { planName: string; total: string; onConfirm: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const y = useSharedValue(reduced ? 0 : height);
  const fade = useSharedValue(reduced ? 1 : 0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!reduced) {
      y.value = withSpring(0, { duration: 500, dampingRatio: 0.85 });
      fade.value = withTiming(1, { duration: 200 });
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reduced, y, fade]);
  const close = () => {
    y.value = withTiming(height, { duration: 200, easing: EASE_OUT });
    fade.value = withTiming(0, { duration: 200 });
    timer.current = setTimeout(onClose, reduced ? 0 : 200);
  };
  const back = useAnimatedStyle(() => ({ opacity: fade.value }));
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const row = { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md } as const;
  return (
    <View style={{ flex: 1, justifyContent: "flex-end" }}>
      <RA.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.5)" }, back]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("mobile.checkout.cancel")} style={{ flex: 1 }} onPress={close} />
      </RA.View>
      <RA.View accessibilityViewIsModal style={[{ backgroundColor: theme.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderCurve: "continuous", padding: spacing.xl, paddingBottom: insets.bottom + spacing.xl, gap: spacing.lg }, sheet]}>
        <View style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: theme.border }} />
        <View style={row}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}>
              <Icon name="wallet" size={22} color={theme.onPrimary} />
            </View>
            <AppText variant="heading">UNIMATE.AZ</AppText>
          </View>
          <View style={{ backgroundColor: theme.warningSoft, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
            <AppText variant="caption" style={{ color: theme.warning, fontWeight: "700" }}>
              {t("mobile.checkout.sheetDemo")}
            </AppText>
          </View>
        </View>
        <View style={{ gap: spacing.sm, paddingVertical: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border }}>
          <View style={row}>
            <AppText muted>{t("mobile.checkout.plan")}</AppText>
            <AppText style={{ fontWeight: "600" }}>{planName}</AppText>
          </View>
          <View style={row}>
            <AppText muted>{t("mobile.checkout.sheetTotal")}</AppText>
            <AppText variant="title">{total}</AppText>
          </View>
          <View style={row}>
            <AppText muted>{t("mobile.checkout.method")}</AppText>
            <AppText style={{ fontWeight: "600" }}>{WALLET_NAME}</AppText>
          </View>
        </View>
        <DemoBadge />
        <AppText variant="caption" muted style={{ textAlign: "center" }}>
          {t("mobile.checkout.sheetHint")}
        </AppText>
        <Button
          title={t("mobile.checkout.confirm")}
          onPress={() => {
            haptic.medium();
            onConfirm();
          }}
        />
        <Button title={t("mobile.checkout.cancel")} variant="ghost" onPress={close} />
      </RA.View>
    </View>
  );
}
