import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { AppText, Button, Screen, ScreenHeader } from "../../../src/components/ui";
import { spacing } from "../../../src/theme/tokens";

/** Payments are not available yet: no card form, no fake success, no local premium. */
export default function CheckoutRoute() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen style={{ gap: spacing.lg }}>
      <ScreenHeader title={t("mobile.checkout.soonTitle")} />
      <View style={{ gap: spacing.sm }}>
        <AppText variant="title" accessibilityRole="header">{t("mobile.checkout.soonTitle")}</AppText>
        <AppText muted>{t("mobile.checkout.soonBody")}</AppText>
      </View>
      <Button title={t("mobile.checkout.back")} onPress={() => router.back()} />
    </Screen>
  );
}
