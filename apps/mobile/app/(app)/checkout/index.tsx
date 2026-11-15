import { PLANS } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState, type ReactNode } from "react";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import RA from "react-native-reanimated";
import { Icon } from "../../../src/components/Icon";
import { AppText, Button, Card, PressableScale, Reveal, Screen, ScreenHeader } from "../../../src/components/ui";
import { BrandMark, DemoBadge, Processing, WalletSheet } from "../../../src/features/payments/parts";
import { WALLET_NAME, paidPlan, planPrice, usePayment } from "../../../src/features/payments/usePayment";
import { CSS_EASE_OUT, haptic, useReducedMotion } from "../../../src/lib/motion";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { radii, spacing } from "../../../src/theme/tokens";

const FEATURES = ["flashcards", "quiz", "ocr", "export", "priority_models"] as const;
const WALLET_MARK = Platform.OS === "ios" ? " Pay" : "G Pay";

function MethodTile({ selected, label, onPress, children, compact }: { selected: boolean; label: string; onPress: () => void; children: ReactNode; compact: boolean }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  return (
    <RA.View style={{ transform: [{ scale: selected && !reduced ? 1.02 : 1 }], transitionProperty: "transform", transitionDuration: 180, transitionTimingFunction: CSS_EASE_OUT }}>
      <PressableScale
        onPress={() => {
          haptic.select();
          onPress();
        }}
        scaleTo={0.98}
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: compact ? spacing.md : spacing.lg, borderRadius: radii.lg, borderCurve: "continuous", backgroundColor: theme.card, borderWidth: 2, borderColor: selected ? theme.primary : theme.cardBorder }}
      >
        {children}
        <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: selected ? theme.primary : "transparent", borderWidth: selected ? 0 : 1.5, borderColor: theme.border }}>
          {selected ? <Icon name="check" size={14} color={theme.onPrimary} /> : null}
        </View>
      </PressableScale>
    </RA.View>
  );
}

/** Step 1: order summary + payment method. SIMULATION ONLY: nothing is charged and the plan never changes. */
export default function CheckoutRoute() {
  const { t, number } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const compact = useWindowDimensions().height < 740;
  const params = useLocalSearchParams<{ plan?: string }>();
  const plan = paidPlan(params.plan);
  const [method, setMethod] = useState<"card" | "wallet">("card");
  const [sheet, setSheet] = useState(false);
  const { busy, pay, cancel } = usePayment(plan);
  const price = planPrice(plan);
  const amount = number(price, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const planName = t(`mobile.profile.plans.name.${plan}`);
  const lim = PLANS[plan];
  const benefits = [
    t("mobile.profile.plans.ai", { n: number(lim.aiMessagesPerDay) }),
    t("mobile.profile.plans.docs", { n: number(lim.docsPerMonth) }),
    t("mobile.profile.plans.pages", { n: number(lim.maxPages) }),
    ...FEATURES.filter((f) => lim.features.includes(f)).map((f) => t(`mobile.profile.plans.feat.${f}`)),
  ].slice(0, compact ? 2 : 4);
  const toPlans = () => router.dismissTo("/plans");

  return (
    <View style={{ flex: 1 }}>
      <Screen scroll={false} style={{ gap: compact ? spacing.sm : spacing.lg }}>
        <ScreenHeader title={t("mobile.checkout.title")} />
        <DemoBadge />
        <Reveal>
          <Card strong style={{ gap: compact ? spacing.sm : spacing.md, padding: compact ? spacing.lg : spacing.xl }}>
            <AppText variant="label" muted>
              {t("mobile.checkout.summary")}
            </AppText>
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.md }}>
              <AppText variant="title">{planName}</AppText>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                <AppText style={{ fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -0.5 }}>{t("mobile.checkout.price", { amount })}</AppText>
                <AppText muted>{t("mobile.profile.plans.perMonth")}</AppText>
              </View>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <AppText muted>{t("mobile.checkout.billing")}</AppText>
              <AppText style={{ fontWeight: "600" }}>{t("mobile.checkout.billingValue")}</AppText>
            </View>
            <View style={{ height: 1, backgroundColor: theme.border }} />
            {benefits.map((b) => (
              <View key={b} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <Icon name="check" size={18} color={theme.primary} />
                <AppText style={{ flex: 1 }}>{b}</AppText>
              </View>
            ))}
          </Card>
        </Reveal>
        <Reveal index={1} style={{ gap: spacing.md }}>
          <AppText variant="heading" accessibilityRole="header">
            {t("mobile.checkout.method")}
          </AppText>
          <View accessibilityRole="radiogroup" style={{ gap: spacing.md }}>
            <MethodTile compact={compact} selected={method === "card"} label={t("mobile.checkout.card")} onPress={() => setMethod("card")}>
              <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                <BrandMark brand="visa" height={22} />
                <BrandMark brand="mastercard" height={22} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontWeight: "600" }}>{t("mobile.checkout.card")}</AppText>
                <AppText variant="caption" muted>
                  {t("mobile.checkout.cardSub")}
                </AppText>
              </View>
            </MethodTile>
            <MethodTile compact={compact} selected={method === "wallet"} label={WALLET_NAME} onPress={() => setMethod("wallet")}>
              <View style={{ height: 28, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#000000", borderWidth: theme.mode === "dark" ? 1 : 0, borderColor: "rgba(255,255,255,0.35)", justifyContent: "center" }}>
                <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: 13 }}>{WALLET_MARK}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontWeight: "600" }}>{WALLET_NAME}</AppText>
                <AppText variant="caption" muted>
                  {t("mobile.checkout.walletSub")}
                </AppText>
              </View>
            </MethodTile>
          </View>
        </Reveal>
        <Button title={t("mobile.checkout.continue")} onPress={() => (method === "card" ? router.push({ pathname: "/checkout/card", params: { plan } }) : setSheet(true))} />
        <Button small={compact} title={t("mobile.checkout.cancel")} variant="ghost" onPress={toPlans} />
      </Screen>
      <WalletSheet
        open={sheet}
        planName={planName}
        total={t("mobile.checkout.price", { amount })}
        onClose={() => setSheet(false)}
        onConfirm={() => {
          setSheet(false);
          void pay("wallet", { kind: "wallet" }, {});
        }}
      />
      {busy ? <Processing onCancel={cancel} /> : null}
    </View>
  );
}
