import { useI18n } from "@unimate/i18n/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View, useWindowDimensions } from "react-native";
import RA, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Icon } from "../../../src/components/Icon";
import { AppText, Button, Reveal, Screen, ScreenHeader } from "../../../src/components/ui";
import { useDemoPlan } from "../../../src/features/payments/demo-plan";
import { DemoBadge } from "../../../src/features/payments/parts";
import { Receipt } from "../../../src/features/payments/Receipt";
import { BRAND_NAME, WALLET_NAME, paidPlan, planPrice } from "../../../src/features/payments/usePayment";
import { haptic, useReducedMotion } from "../../../src/lib/motion";
import { useUser } from "../../../src/state/session";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { spacing } from "../../../src/theme/tokens";

type Outcome = "succeeded" | "failed" | "canceled";

function StatusIcon({ outcome, size }: { outcome: Outcome; size: number }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(reduced ? 1 : 0.4);
  const opacity = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (outcome === "succeeded") haptic.success();
    else if (outcome === "failed") haptic.error();
    if (reduced) return;
    scale.value = withSpring(1, { duration: 650, dampingRatio: 0.5 });
    opacity.value = withTiming(1, { duration: 200 });
  }, [outcome, reduced, scale, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  const tone = { succeeded: [theme.successSoft, theme.success], failed: [theme.dangerSoft, theme.danger], canceled: [theme.cardStrong, theme.textMuted] }[outcome];
  const icon = { succeeded: "check", failed: "error", canceled: "close" }[outcome] as "check" | "error" | "close";
  return (
    <RA.View style={[{ alignSelf: "center", width: size, height: size, borderRadius: size / 2, backgroundColor: tone[0], alignItems: "center", justifyContent: "center" }, style]}>
      <Icon name={icon} size={Math.round(size * 0.48)} color={tone[1]} strokeWidth={2.4} />
    </RA.View>
  );
}

/** Final step: success (demo receipt), declined test card, or canceled. Never changes the plan or any server data. */
export default function CheckoutResultRoute() {
  const { t } = useI18n();
  const router = useRouter();
  const compact = useWindowDimensions().height < 740;
  const p = useLocalSearchParams<{ plan?: string; method?: string; status?: string; tx?: string; brand?: string; last4?: string; at?: string }>();
  const plan = paidPlan(p.plan);
  const outcome: Outcome = p.status === "succeeded" || p.status === "failed" ? p.status : "canceled";
  const { user } = useUser();
  const { setDemoPlan, ready } = useDemoPlan(user.id);
  // Device-local demo plan only; waits for the store to load so the write is not clobbered by the initial read.
  useEffect(() => {
    if (outcome === "succeeded" && ready) setDemoPlan(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, ready, plan]);
  const brand = p.brand === "visa" || p.brand === "mastercard" ? p.brand : null;
  const methodLabel = p.method === "wallet" ? WALLET_NAME : `${brand ? BRAND_NAME[brand] : t("mobile.checkout.card")} •••• ${p.last4 ?? ""}`;
  const at = new Date(Number(p.at) || Date.now());
  const toPlans = () => router.dismissTo("/plans");
  const title = { succeeded: t("mobile.checkout.thanks"), failed: t("mobile.checkout.declined"), canceled: t("mobile.checkout.canceled") }[outcome];
  const sub = { succeeded: t("mobile.checkout.successSub"), failed: t("mobile.checkout.declinedSub"), canceled: t("mobile.checkout.canceledSub") }[outcome];

  return (
    <Screen scroll={false} style={{ gap: compact ? spacing.sm : spacing.lg }}>
      <ScreenHeader title={t("mobile.checkout.title")} />
      {outcome === "succeeded" ? null : <DemoBadge />}
      <StatusIcon outcome={outcome} size={compact ? 56 : 96} />
      <Reveal style={{ alignItems: "center", gap: spacing.sm }}>
        <AppText variant={compact ? "title" : "display"} accessibilityRole="header" style={{ textAlign: "center" }}>
          {title}
        </AppText>
        <AppText muted style={{ textAlign: "center" }}>
          {sub}
        </AppText>
      </Reveal>
      {outcome === "succeeded" ? (
        <Reveal index={1}>
          <Receipt planName={t(`mobile.profile.plans.name.${plan}`)} amount={planPrice(plan)} methodLabel={methodLabel} transactionId={p.tx || "UM-DEMO"} at={at} compact={compact} />
        </Reveal>
      ) : null}
      <View style={{ gap: spacing.md }}>
        {outcome === "failed" ? (
          <>
            <Button title={t("mobile.checkout.retry")} onPress={() => router.replace(p.method === "wallet" ? { pathname: "/checkout", params: { plan } } : { pathname: "/checkout/card", params: { plan } })} />
            <Button title={t("mobile.checkout.otherMethod")} variant="secondary" onPress={() => router.replace({ pathname: "/checkout", params: { plan } })} />
            <Button title={t("mobile.checkout.cancel")} variant="ghost" onPress={toPlans} />
          </>
        ) : (
          <Button title={outcome === "succeeded" ? t("mobile.checkout.close") : t("mobile.checkout.backPlans")} onPress={toPlans} />
        )}
      </View>
    </Screen>
  );
}
