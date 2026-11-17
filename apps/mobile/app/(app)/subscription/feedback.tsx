import { useI18n } from "@unimate/i18n/react";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, TextInput, View, useWindowDimensions } from "react-native";
import RA, { useAnimatedStyle, useSharedValue, withSequence, withSpring } from "react-native-reanimated";
import { z } from "zod";
import { Icon } from "../../../src/components/Icon";
import { AppText, Button, PressableScale, Screen, ScreenHeader } from "../../../src/components/ui";
import { useLocalValue } from "../../../src/lib/local-store";
import { haptic } from "../../../src/lib/motion";
import { useUser } from "../../../src/state/session";
import { useTheme } from "../../../src/theme/ThemeProvider";
import { radii, spacing } from "../../../src/theme/tokens";

const schema = z.array(z.object({ at: z.number(), plan: z.string(), stars: z.number(), note: z.string() })).max(50);
const MAX = 500;

function Star({ n, on, label, onPress }: { n: number; on: boolean; label: string; onPress: (n: number) => void }) {
  const { theme } = useTheme();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (on) scale.value = withSequence(withSpring(1.3, { duration: 150 }), withSpring(1, { duration: 300 }));
  }, [on, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <PressableScale
      onPress={() => {
        haptic.select();
        onPress(n);
      }}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      hitSlop={6}
    >
      <RA.View style={style}>
        <Icon name="rating" size={44} color={on ? theme.warning : theme.textMuted} strokeWidth={on ? 2.6 : 1.6} />
      </RA.View>
    </PressableScale>
  );
}

/** Cancel / downgrade, step 2. Feedback is stored on this device only (um.feedback.<uid>) and never sent. */
export default function FeedbackRoute() {
  const { t } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const { user } = useUser();
  const { height } = useWindowDimensions();
  const compact = height < 740;
  const p = useLocalSearchParams<{ target?: string }>();
  const saved = useLocalValue(`um.feedback.${user.id}`, schema, []);
  const [stars, setStars] = useState(0);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const toProfile = () => router.dismissTo("/profile" as Href);

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(toProfile, 1600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const send = () => {
    saved.update((prev) => [...prev, { at: Date.now(), plan: String(p.target ?? ""), stars, note: note.trim() }].slice(-50));
    haptic.success();
    setDone(true);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <Screen scroll={false} style={{ gap: compact ? spacing.md : spacing.lg }}>
        <ScreenHeader title={t("mobile.profile.subscription.fbTitle")} />
        {done ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md }}>
            <Icon name="check" size={56} color={theme.success} strokeWidth={2.4} />
            <AppText variant="heading" style={{ textAlign: "center" }}>
              {t("mobile.profile.subscription.fbThanks")}
            </AppText>
          </View>
        ) : (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.warningSoft, borderRadius: radii.lg, padding: spacing.md }}>
              <Icon name="info" size={16} color={theme.warning} />
              <AppText style={{ color: theme.warning, fontWeight: "700", flex: 1 }}>{t("mobile.profile.subscription.fbDemo")}</AppText>
            </View>
            <AppText variant={compact ? "heading" : "title"} accessibilityRole="header">
              {t("mobile.profile.subscription.fbTitle")}
            </AppText>
            <View accessibilityRole="radiogroup" style={{ flexDirection: "row", justifyContent: "center", gap: spacing.sm }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} n={n} on={n <= stars} label={t("mobile.profile.subscription.fbStar", { n })} onPress={setStars} />
              ))}
            </View>
            <View style={{ gap: 6 }}>
              <AppText variant="label">{t("mobile.profile.subscription.fbNote")}</AppText>
              <TextInput
                value={note}
                onChangeText={(v) => setNote(v.slice(0, MAX))}
                multiline
                maxLength={MAX}
                accessibilityLabel={t("mobile.profile.subscription.fbNote")}
                placeholderTextColor={theme.textMuted}
                style={{ height: compact ? 90 : 130, textAlignVertical: "top", padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, color: theme.text, fontSize: 16 }}
              />
              <AppText variant="caption" muted style={{ textAlign: "right" }}>
                {note.length}/{MAX}
              </AppText>
            </View>
            <View style={{ flex: 1 }} />
            <Button title={t("mobile.profile.subscription.fbSend")} disabled={stars === 0 || !saved.ready} onPress={send} />
            <Button title={t("mobile.profile.subscription.fbSkip")} variant="ghost" onPress={toProfile} />
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
