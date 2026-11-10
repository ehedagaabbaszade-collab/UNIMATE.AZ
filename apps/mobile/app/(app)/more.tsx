import { useI18n } from "@unimate/i18n/react";
import { PressableScale } from "../../src/components/ui";
import { useRouter, type Href } from "expo-router";
import { View } from "react-native";
import { ModuleIcon } from "../../src/components/Icon";
import { AppText, Card, Screen, ScreenHeader } from "../../src/components/ui";
import { tileLayout } from "../../src/lib/registry";

/** Modules that did not fit the 3x3 Home grid (only reachable from the "more" tile, which exists only when there are some). */
export default function More() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <Screen>
      <ScreenHeader title={t("nav.more")} onBack={() => router.back()} />
      <View style={{ gap: 10 }}>
        {tileLayout().overflow.map((m) => (
          <PressableScale key={m.id} onPress={() => router.push(m.href as Href)} accessibilityRole="button" accessibilityLabel={t(m.labelKey)}>
            <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <ModuleIcon icon={m.icon} {...(m.module ? { module: m.module } : {})} {...(m.tileColors ? { colors: m.tileColors } : {})} size={40} />
              <AppText variant="heading">{t(m.labelKey)}</AppText>
            </Card>
          </PressableScale>
        ))}
      </View>
    </Screen>
  );
}
