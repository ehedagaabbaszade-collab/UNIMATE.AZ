import type { PlanId } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Alert, View, useWindowDimensions } from "react-native";
import { Icon } from "../../../src/components/Icon";
import { AppText, Button, Card, Screen, ScreenHeader } from "../../../src/components/ui";
import { planLosses, type Loss } from "../../../src/features/payments/plan-relation";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { radii, spacing } from "../../../src/theme/tokens";

const asPlan = (v: unknown, fallback: PlanId): PlanId => (v === "FREE" || v === "PLUS" || v === "PRO" ? v : fallback);
const LOSE_KEY = { ai: "Ai", docs: "Docs", pages: "Pages" } as const;

/** Cancel / downgrade, step 1. SIMULATION: confirming never touches the server plan. */
export default function CancelRoute() {
  const { t, number } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const compact = height < 740;
  const p = useLocalSearchParams<{ from?: string; target?: string }>();
  const from = asPlan(p.from, "PLUS");
  const target = asPlan(p.target, "FREE");
  const losses = planLosses(from, target).slice(0, compact ? 4 : 6);
  const label = (l: Loss) =>
    l.kind === "feat"
      ? t(`mobile.profile.plans.feat.${l.feature}` as "mobile.profile.plans.feat.quiz")
      : t(`mobile.profile.subscription.lose${LOSE_KEY[l.kind]}`, { from: number(l.from ?? 0), to: number(l.to ?? 0) });
  const title = target === "PLUS" ? t("mobile.profile.subscription.toPLUS") : t("mobile.profile.subscription.cancelTitle");
  const go = () => {
    router.replace({ pathname: "/subscription/feedback", params: { from, target } } as Href);
  };
  const confirm = () =>
    Alert.alert(t("mobile.profile.subscription.confirmTitle"), t("mobile.profile.subscription.confirmBody"), [
      { text: t("mobile.profile.subscription.confirmNo"), style: "cancel" },
      { text: t("mobile.profile.subscription.confirmYes"), style: "destructive", onPress: go },
    ]);

  return (
    <Screen scroll={false} style={{ gap: compact ? spacing.md : spacing.lg }}>
      <ScreenHeader title={title} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: theme.warningSoft, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7 }}>
        <Icon name="info" size={14} color={theme.warning} />
        <AppText variant="caption" style={{ color: theme.warning, fontWeight: "700", flexShrink: 1 }}>
          {t("mobile.profile.subscription.demo")}
        </AppText>
      </View>
      <View style={{ gap: spacing.xs }}>
        <AppText variant={compact ? "heading" : "title"} accessibilityRole="header">
          {t("mobile.profile.subscription.retainTitle")}
        </AppText>
        <AppText muted>{t("mobile.profile.subscription.retainBody")}</AppText>
      </View>
      <Card strong style={{ gap: compact ? spacing.sm : spacing.md, padding: compact ? spacing.lg : spacing.xl }}>
        <AppText variant="label" muted>
          {t("mobile.profile.subscription.loseHead")}
        </AppText>
        {losses.map((l) => (
          <View key={label(l)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
            <Icon name="close" size={18} color={theme.danger} />
            <AppText style={{ flex: 1 }}>{label(l)}</AppText>
          </View>
        ))}
      </Card>
      <View style={{ flex: 1 }} />
      <Button title={t("mobile.profile.subscription.stay")} onPress={() => router.back()} />
      <Button title={t("mobile.profile.subscription.proceed")} variant="danger" onPress={confirm} />
    </Screen>
  );
}
