import { LOCALES, LOCALE_NAMES, createTranslator } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { Alert, Image, View, useWindowDimensions } from "react-native";
import { ModuleIcon } from "../../components/Icon";
import { SlidingSegmented } from "../../components/SlidingSegmented";
import { AppText, HeroTitle, ListGroup, ListRow, PressableScale, Screen, useToast } from "../../components/ui";
import { haptic } from "../../lib/motion";
import { MODULES } from "../../lib/registry";
import { kv, tourKey } from "../../lib/storage";
import { usePins } from "../../state/pins";
import { useAppMode } from "../../state/mode";
import { useLocaleControl } from "../../state/locale";
import { useSession, useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { MIN_TOUCH, contentWidth, gridColumns, spacing, type ThemePref } from "../../theme/tokens";
import { useAvatar } from "../profile/avatar";

const THEME_ICONS = { dark: "moon", light: "sun", system: "smartphone" } as const;

/** All modules (tap opens, press and hold pins/unpins it in the tab bar). */
function ModuleGrid({ uid }: { uid: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { ids, pin, unpin } = usePins(uid);
  const cols = gridColumns(contentWidth(useWindowDimensions().width));
  const menu = (id: string, label: string) => {
    haptic.medium();
    const isPinned = ids.includes(id);
    Alert.alert(label, undefined, [
      {
        text: t(isPinned ? "mobile.profile.unpin" : "mobile.profile.pin"),
        style: isPinned ? "destructive" : "default",
        onPress: () => {
          if (isPinned) unpin(id);
          else if (!pin(id)) Alert.alert(t("mobile.profile.pinFull"));
        },
      },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  };
  return (
    <ListGroup title={t("mobile.profile.moreModules")}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", paddingVertical: spacing.sm }}>
        {MODULES.map((m) => {
          const label = t(m.labelKey);
          const isPinned = ids.includes(m.id);
          return (
            <PressableScale
              key={m.id}
              onPress={() => router.push(m.href as Href)}
              onLongPress={() => menu(m.id, label)}
              delayLongPress={350}
              accessibilityRole="button"
              accessibilityLabel={isPinned ? `${label}, ${t("mobile.profile.pinned")}` : label}
              accessibilityHint={t("mobile.profile.morePinHint")}
              accessibilityActions={[{ name: "longpress", label: t(isPinned ? "mobile.profile.unpin" : "mobile.profile.pin") }]}
              onAccessibilityAction={() => menu(m.id, label)}
              style={{ width: `${100 / cols}%`, alignItems: "center", gap: 6, paddingVertical: spacing.sm }}
            >
              <View>
                <ModuleIcon icon={m.icon} size={52} />
                {isPinned ? <View style={{ position: "absolute", top: -2, right: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: theme.active, borderWidth: 2, borderColor: theme.card }} /> : null}
              </View>
              <AppText variant="caption" numberOfLines={1} style={{ textAlign: "center", paddingHorizontal: 4 }}>
                {label}
              </AppText>
            </PressableScale>
          );
        })}
      </View>
      <AppText variant="caption" muted style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
        {t("mobile.profile.morePinHint")}
      </AppText>
    </ListGroup>
  );
}

/** More tab: every module (pinnable to the tab bar), then preferences and support. Identity lives on the Profile screen. */
export function SettingsScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { theme, pref, setPref } = useTheme();
  const { user, profile } = useUser();
  const { signOut } = useSession();
  const { setLocale } = useLocaleControl();
  const { toast } = useToast();
  const { mode, setMode } = useAppMode(user.id);
  const avatar = useAvatar(user.id);
  const [open, setOpen] = useState<"theme" | "lang" | null>(null);
  const toggle = (k: "theme" | "lang") => setOpen((o) => (o === k ? null : k));
  const name = profile?.display_name ?? "";
  const initial = (name || user.email || "?").trim().slice(0, 1).toUpperCase();
  const go = (href: string) => () => router.push(href as Href);

  return (
    <Screen ambient style={{ gap: spacing.lg }}>
      <HeroTitle muted={t("nav.more")} strong={t("mobile.profile.moreHeroStrong")} />

      <PressableScale onPress={go("/profile")} accessibilityRole="button" accessibilityLabel={t("mobile.profile.settingsOpenProfile")} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: 28, borderCurve: "continuous", backgroundColor: theme.card }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, overflow: "hidden", backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" }}>
          {avatar.uri ? (
            <Image source={{ uri: avatar.uri }} accessibilityIgnoresInvertColors style={{ width: 56, height: 56 }} />
          ) : (
            <AppText importantForAccessibility="no" style={{ color: theme.onPrimary, fontSize: 22, fontWeight: "300" }}>
              {initial}
            </AppText>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <AppText numberOfLines={1} style={{ fontSize: 18, fontWeight: "500" }}>
            {name || initial}
          </AppText>
          <AppText muted variant="caption" numberOfLines={1}>
            {user.email}
          </AppText>
        </View>
        <AppText importantForAccessibility="no" muted style={{ fontSize: 22 }}>
          ›
        </AppText>
      </PressableScale>

      <ModuleGrid uid={user.id} />

      <ListGroup title={t("mobile.profile.settingsPersonalize")}>
        <ListRow icon="palette" iconColor={theme.active} title={t("mobile.profile.settingsAppearance")} subtitle={t("mobile.profile.settingsAppearanceSub")} onPress={() => toggle("theme")} />
        {open === "theme" ? (
          <View style={{ padding: spacing.md }}>
            <SlidingSegmented<ThemePref> label={t("theme.label")} value={pref} onChange={setPref} stacked height={56} options={(["dark", "light", "system"] as const).map((v) => ({ value: v, label: t(`theme.${v}`), icon: THEME_ICONS[v] }))} />
          </View>
        ) : null}
        <ListRow icon="languages" iconColor={theme.active} title={t("mobile.profile.settingsLanguage")} subtitle={t("mobile.profile.settingsLanguageSub")} trailing={LOCALE_NAMES[locale]} onPress={() => toggle("lang")} />
        {open === "lang" ? (
          <View style={{ padding: spacing.md }}>
            <SlidingSegmented
              label={t("language.label")}
              value={locale}
              height={MIN_TOUCH}
              onChange={(l) => {
                void setLocale(l).then((ok) => {
                  if (!ok) toast(createTranslator(l)("language.saveFailed"), "error");
                });
              }}
              options={LOCALES.map((l) => ({ value: l, label: l.toUpperCase(), a11y: LOCALE_NAMES[l] }))}
            />
          </View>
        ) : null}
        <ListRow icon="sparkles" iconColor={theme.active} title={t("mobile.profile.upgrade")} subtitle={t("mobile.profile.upgradeSub")} onPress={go("/plans")} />
      </ListGroup>

      <ListGroup title={t("mobile.profile.settingsHelp")}>
        <ListRow icon="notes" iconColor={theme.text} title={t("legal.terms")} onPress={go("/legal/terms")} />
        <ListRow icon="info" iconColor={theme.text} title={t("legal.privacy")} onPress={go("/legal/privacy")} />
        <ListRow icon="locked" iconColor={theme.text} title={t("mobile.profile.privacyRow")} subtitle={t("mobile.profile.privacySub")} onPress={go("/privacy")} />
        {mode !== "teacher" ? (
          <ListRow
            icon="home"
            iconColor={theme.text}
            title={t("teach.switch.replayTour")}
            onPress={async () => {
              await kv.removeItem(tourKey(user.id)).catch(() => undefined);
              router.replace("/");
            }}
          />
        ) : null}
        <ListRow
          icon="settings"
          iconColor={theme.text}
          title={t("teach.switch.change")}
          subtitle={t("teach.switch.current", { mode: mode === "teacher" ? t("teach.welcome.teacher") : t("teach.welcome.student") })}
          onPress={async () => {
            const next = mode === "teacher" ? "student" : "teacher";
            await setMode(next);
            router.replace(next === "teacher" ? "/teacher" : "/");
          }}
        />
      </ListGroup>

      <ListGroup>
        <ListRow icon="sign-out" iconColor={theme.danger} titleColor={theme.danger} title={t("nav.signOut")} onPress={() => void signOut()} />
      </ListGroup>
    </Screen>
  );
}
