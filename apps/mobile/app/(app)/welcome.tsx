import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { BrandLogo } from "../../src/components/Brand";
import { AppText, Card, PressableScale, Screen } from "../../src/components/ui";
import { haptic } from "../../src/lib/motion";
import { useUser } from "../../src/state/session";
import { useAppMode, type AppMode } from "../../src/state/mode";
import { useTheme } from "../../src/theme/ThemeProvider";
import { spacing } from "../../src/theme/tokens";

export default function Welcome() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const { user } = useUser();
  const { setMode } = useAppMode(user.id);
  const choose = async (m: AppMode) => {
    haptic.success();
    await setMode(m);
    router.replace(m === "teacher" ? "/teacher" : "/");
  };
  const choices: { mode: AppMode; title: string; desc: string }[] = [
    { mode: "student", title: t("teach.welcome.student"), desc: t("teach.welcome.studentDesc") },
    { mode: "teacher", title: t("teach.welcome.teacher"), desc: t("teach.welcome.teacherDesc") },
  ];
  return (
    <Screen>
      <View style={{ alignItems: "center", gap: spacing.md, paddingTop: spacing.lg }}>
        <BrandLogo height={110} />
        <AppText variant="title" accessibilityRole="header" style={{ textAlign: "center" }}>
          {t("teach.welcome.title")}
        </AppText>
        <AppText muted style={{ textAlign: "center" }}>
          {t("teach.welcome.pitch")}
        </AppText>
      </View>
      <AppText variant="heading">{t("teach.welcome.question")}</AppText>
      {choices.map((c) => (
        <PressableScale key={c.mode} onPress={() => void choose(c.mode)} accessibilityRole="button" accessibilityLabel={`${c.title}. ${c.desc}`}>
          <Card style={{ minHeight: 110, justifyContent: "center", gap: 4, borderColor: theme.active }}>
            <AppText variant="title">{c.title}</AppText>
            <AppText muted>{c.desc}</AppText>
          </Card>
        </PressableScale>
      ))}
    </Screen>
  );
}
