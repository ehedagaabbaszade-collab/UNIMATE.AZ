import { PLANS, PRICE_AZN, type PlanId } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, View, useWindowDimensions } from "react-native";
import RA, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { Icon } from "../../src/components/Icon";
import { AppText, Button, Screen, ScreenHeader } from "../../src/components/ui";
import { useTheme as useTagTheme } from "../../src/theme/ThemeProvider";

/** Small badge next to a plan name: always clearly smaller than the name it labels. */
function Tag({ label, accent }: { label: string; accent?: boolean }) {
  const { theme } = useTagTheme();
  return (
    <View style={{ paddingHorizontal: 8, minHeight: 22, justifyContent: "center", borderRadius: 999, backgroundColor: accent ? theme.primarySoft : "transparent", borderWidth: accent ? 0 : 1, borderColor: theme.border }}>
      <AppText maxFontSizeMultiplier={1.3} style={{ fontSize: 11, lineHeight: 14, fontWeight: "600", color: accent ? theme.primary : theme.textMuted }}>
        {label}
      </AppText>
    </View>
  );
}
import { useDemoPlan } from "../../src/features/payments/demo-plan";
import { planRelation } from "../../src/features/payments/plan-relation";
import { EASE_OUT, useReducedMotion } from "../../src/lib/motion";
import { planFromSubscription } from "../../src/lib/usage";
import { useAsync } from "../../src/lib/use-async";
import { useUser } from "../../src/state/session";
import { useTheme } from "../../src/theme/ThemeProvider";
import { radii, spacing } from "../../src/theme/tokens";

const SHOWN = ["FREE", "PLUS", "PRO"] as const satisfies readonly PlanId[];
const FEATURES = ["flashcards", "quiz", "ocr", "export", "priority_models"] as const;

/** Plans and limits come from @unimate/core billing. Payment is a demo simulation; no server plan changes. No scrolling: sized from the window. */
export default function PlansRoute() {
  const { t, number } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const compact = height < 740;
  const { user, supabase: sb } = useUser();
  const current = useAsync(async () => {
    const plan = await sb.rpc("my_plan");
    return planFromSubscription(plan.error ? null : { plan: String(plan.data ?? "free") as "free" | "plus" | "pro", status: "active" });
  }, [user.id]);
  const demo = useDemoPlan(user.id);
  const reloadDemo = demo.reload;
  useFocusEffect(useCallback(() => reloadDemo(), [reloadDemo])); // checkout/cancel write the demo plan from other screens
  const plan = current.data ? (demo.demoPlan ?? current.data) : null;
  const reduced = useReducedMotion();
  const layout = reduced ? undefined : LinearTransition.duration(260).easing(EASE_OUT);
  const detailIn = reduced ? undefined : FadeIn.duration(200).delay(80);
  const detailOut = reduced ? undefined : FadeOut.duration(100);
  // Default: the next upgrade from the current plan, else the recommended plan.
  const [picked, setSelected] = useState<PlanId | null>(null);
  const selected = picked ?? (plan ? (SHOWN.find((id) => planRelation(plan, id) === "upgrade") ?? "PLUS") : "PLUS");

  return (
    <Screen scroll={false} style={{ gap: compact ? spacing.sm : spacing.md }}>
      <ScreenHeader title={t("mobile.profile.plans.title")} />
      {demo.demoPlan ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
          <AppText variant="caption" muted style={{ flex: 1 }}>
            {t("mobile.profile.plans.demoNotice", { plan: t(`mobile.profile.plans.name.${demo.demoPlan}`) })}
          </AppText>
          <Pressable accessibilityRole="link" accessibilityLabel={t("mobile.profile.plans.demoReset")} onPress={demo.clear} hitSlop={8}>
            <AppText variant="caption" style={{ color: theme.primary, fontWeight: "700" }}>
              {t("mobile.profile.plans.demoReset")}
            </AppText>
          </Pressable>
        </View>
      ) : null}
      {SHOWN.map((id) => {
        const lim = PLANS[id];
        const price = PRICE_AZN[id];
        const featured = id === "PLUS";
        const open = id === selected;
        const rel = plan ? planRelation(plan, id) : null;
        const isCurrent = rel === "current";
        const canSwitch = id !== "PRO"; // no "switch to Ultra" key: Ultra is only ever an upgrade target
        const title = isCurrent ? t("mobile.profile.plans.current") : rel === "downgrade" ? (canSwitch ? t(`mobile.profile.subscription.to${id}`) : t("mobile.profile.plans.cta")) : t("mobile.profile.plans.cta");
        const disabled = rel === null || isCurrent || (rel === "downgrade" && !canSwitch);
        const onPress = () =>
          rel === "downgrade"
            ? router.push({ pathname: "/subscription/cancel", params: { from: plan, target: id } } as Href)
            : router.push({ pathname: "/checkout", params: { plan: id } });
        const features = [
          t("mobile.profile.plans.ai", { n: number(lim.aiMessagesPerDay) }),
          t("mobile.profile.plans.docs", { n: number(lim.docsPerMonth) }),
          t("mobile.profile.plans.pages", { n: number(lim.maxPages) }),
          ...FEATURES.filter((f) => lim.features.includes(f)).map((f) => t(`mobile.profile.plans.feat.${f}`)),
        ];
        const priceText = (
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.xs, flexWrap: "wrap" }}>
            <AppText accessibilityRole="header" style={{ fontSize: open ? (compact ? 34 : 42) : 22, lineHeight: open ? (compact ? 40 : 48) : 28, fontWeight: "300", letterSpacing: open ? -1 : -0.4, fontVariant: ["tabular-nums"] }}>
              {t("mobile.profile.plans.price", { amount: number(price, { minimumFractionDigits: price ? 2 : 0, maximumFractionDigits: 2 }) })}
            </AppText>
            <AppText muted variant="caption">
              {price ? t("mobile.profile.plans.perMonth") : t("mobile.profile.plans.free")}
            </AppText>
          </View>
        );
        const name = (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
            {/* Plan name in the Home headline voice: large, light, never smaller than its pills. */}
            <AppText style={{ fontSize: open ? (compact ? 28 : 32) : 24, lineHeight: open ? (compact ? 34 : 38) : 30, fontWeight: "300", letterSpacing: -0.6, color: open ? theme.text : theme.textMuted }}>
              {t(`mobile.profile.plans.name.${id}`)}
            </AppText>
            {featured ? <Tag label={t("mobile.profile.subscription.recommended")} accent /> : null}
            {isCurrent ? <Tag label={t("mobile.profile.plans.current")} /> : null}
          </View>
        );
        const variant = featured && rel === "upgrade" ? "primary" : rel === "downgrade" ? "ghost" : "secondary";
        const frame = { padding: compact ? spacing.md : spacing.lg, borderRadius: radii.xl, borderCurve: "continuous", backgroundColor: theme.card, borderWidth: 2, overflow: "hidden", borderColor: open ? theme.primary : theme.cardBorder, transitionProperty: "borderColor", transitionDuration: reduced ? 0 : 180 } as const;

        return (
          // Cards size to their content (no flex fill), so an expanded card never leaves an empty band above its button.
          <RA.View key={id} layout={layout}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={t(`mobile.profile.plans.name.${id}`)} onPress={() => setSelected(id)} disabled={open}>
              <RA.View layout={layout} style={[frame, open ? { gap: compact ? spacing.sm : spacing.md } : { minHeight: 68, justifyContent: "center" }]}>
                {open ? (
                  <>
                    {name}
                    {priceText}
                    <RA.View entering={detailIn} exiting={detailOut} style={{ gap: compact ? spacing.md : spacing.lg }}>
                      <View style={{ gap: compact ? 6 : spacing.sm }}>
                        {features.map((label) => (
                          <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                            <Icon name="check" size={16} color={theme.primary} />
                            <AppText style={{ flex: 1, color: theme.textMuted, fontWeight: "300", fontSize: compact ? 15 : 17 }}>{label}</AppText>
                          </View>
                        ))}
                      </View>
                      <Button title={title} variant={variant} disabled={disabled} onPress={onPress} />
                    </RA.View>
                  </>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      {name}
                      <AppText variant="caption" muted numberOfLines={1}>
                        {features[0]}
                      </AppText>
                    </View>
                    {priceText}
                  </View>
                )}
              </RA.View>
            </Pressable>
          </RA.View>
        );
      })}
    </Screen>
  );
}
