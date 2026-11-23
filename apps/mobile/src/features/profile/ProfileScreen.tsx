import { PRICE_AZN, parseMyProgress } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, TextInput, View } from "react-native";
import RA, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { Icon } from "../../components/Icon";
import { AppText, ListGroup, ListRow, PressableScale, Screen, useToast } from "../../components/ui";
import { haptic } from "../../lib/motion";
import { planFromSubscription } from "../../lib/usage";
import { useAsync } from "../../lib/use-async";
import { useSession, useUser } from "../../state/session";
import { useAppMode } from "../../state/mode";
import { useTheme } from "../../theme/ThemeProvider";
import { MIN_TOUCH, spacing } from "../../theme/tokens";
import { useAvatar } from "./avatar";
import { saveDisplayName } from "./save-name";

/** Small round icon button (44pt touch target). */
function IconButton({ icon, label, onPress, color, busy }: { icon: "pencil" | "check" | "close"; label: string; onPress: () => void; color?: string; busy?: boolean }) {
  const { theme } = useTheme();
  return (
    <PressableScale onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={label} style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }}>
      {busy ? <ActivityIndicator color={theme.active} /> : <Icon name={icon} size={18} color={color ?? theme.text} />}
    </PressableScale>
  );
}

/** Identity (photo, name, email, institution) plus grouped shortcuts: plan, my stuff, settings/level/privacy, sign out. */
export function ProfileScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { user, profile, supabase: sb } = useUser();
  const { refreshProfile, signOut } = useSession();
  const { toast } = useToast();
  const avatar = useAvatar(user.id);
  // Teacher mode has no Settings tab, so the way back to student mode must live here too.
  const { mode, setMode } = useAppMode(user.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function pickAvatar() {
    try {
      await avatar.pick();
    } catch (e) {
      const denied = /permission|denied|authori/i.test(e instanceof Error ? e.message : "");
      toast(t(denied ? "mobile.profile.avatarDenied" : "mobile.profile.avatarFailed"), "error");
    }
  }
  async function removeAvatar() {
    try {
      await avatar.remove();
    } catch {
      toast(t("mobile.profile.avatarFailed"), "error");
    }
  }
  function avatarSheet() {
    Alert.alert(t("mobile.profile.avatarTitle"), undefined, [
      { text: t("mobile.profile.avatarPick"), onPress: () => void pickAvatar() },
      ...(avatar.uri ? [{ text: t("mobile.profile.avatarRemove"), style: "destructive" as const, onPress: () => void removeAvatar() }] : []),
      { text: t("common.cancel"), style: "cancel" as const },
    ]);
  }

  const info = useAsync(async () => {
    const [plan, uni, unread, prog, st] = await Promise.all([
      sb.rpc("my_plan"),
      profile?.university_id ? sb.from("universities").select("name").eq("id", profile.university_id).maybeSingle<{ name: string }>() : Promise.resolve({ data: null, error: null }),
      sb.rpc("unread_notification_count"),
      sb.rpc("my_progress"),
      sb.from("profiles").select("university_status").eq("id", user.id).maybeSingle<{ university_status: string }>(),
    ]);
    return {
      plan: planFromSubscription(plan.error ? null : { plan: String(plan.data ?? "free") as "free" | "plus" | "pro", status: "active" }),
      university: uni.data?.name ?? null,
      uniStatus: profile?.university_id ? (st.data?.university_status ?? null) : null,
      unread: typeof unread.data === "number" ? unread.data : 0,
      level: prog.error ? null : parseMyProgress(prog.data).level,
    };
  }, [user.id]);

  const reloadInfo = info.reload;
  const shownPlan = info.data ? info.data.plan : null;
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      reloadInfo();
    }, [reloadInfo]),
  );

  const shownName = profile?.display_name ?? "";
  function startEdit() {
    setDraft(shownName);
    setNameError(null);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setNameError(null);
  }
  async function saveName() {
    setSaving(true);
    const res = await saveDisplayName(sb, user.id, draft);
    if (res.ok) await refreshProfile(); // Home and everywhere else read the profile from the session
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      setSaved(true);
      haptic.success();
      setTimeout(() => setSaved(false), 1400);
    } else if (res.kind === "validation") {
      setNameError(t(res.messageKey as never));
    } else {
      haptic.error();
      setEditing(false); // previous name stays (the draft is discarded)
      setNameError(t("mobile.profile.nameSaveFailed"));
    }
  }

  const initials = (shownName || user.email || "?").trim().slice(0, 1).toUpperCase();
  const av = 88;
  const nameStyle = { fontWeight: "300", fontSize: 30, lineHeight: 36, letterSpacing: -0.8, textAlign: "center" } as const;
  const unread = info.data?.unread ?? 0;
  const price = shownPlan && shownPlan !== "GROUP" ? PRICE_AZN[shownPlan] : 0;
  const confirmSignOut = () =>
    Alert.alert(t("nav.signOut"), undefined, [
      { text: t("nav.signOut"), style: "destructive", onPress: () => void signOut() },
      { text: t("common.cancel"), style: "cancel" },
    ]);
  return (
    <Screen ambient style={{ gap: spacing.lg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <PressableScale onPress={() => router.push("/notifications")} accessibilityRole="button" accessibilityLabel={t(unread > 0 ? "mobile.home.notificationsUnread" : "mobile.home.notifications")} style={{ width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" }}>
              <Icon name="notifications" size={20} color={theme.text} />
              {unread > 0 ? <View style={{ position: "absolute", top: 10, right: 11, width: 9, height: 9, borderRadius: 5, backgroundColor: theme.danger, borderWidth: 2, borderColor: theme.card }} /> : null}
            </PressableScale>
          ),
        }}
      />
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <PressableScale onPress={avatarSheet} accessibilityRole="button" accessibilityLabel={t("mobile.profile.avatarTitle")} style={{ width: av, height: av, borderRadius: av / 2, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center", boxShadow: "0 8px 22px rgba(67,56,202,0.32)" }}>
          <RA.View key={avatar.uri ?? "none"} entering={FadeIn.duration(260).reduceMotion(ReduceMotion.System)} style={{ width: av, height: av, borderRadius: av / 2, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
            {avatar.uri ? (
              <Image source={{ uri: avatar.uri }} accessibilityIgnoresInvertColors style={{ width: av, height: av }} />
            ) : (
              <AppText importantForAccessibility="no" style={{ color: theme.onPrimary, fontSize: av / 2.6, fontWeight: "300" }}>
                {initials}
              </AppText>
            )}
          </RA.View>
          <View style={{ position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: theme.card, borderWidth: 2, borderColor: theme.bg, alignItems: "center", justifyContent: "center" }}>
            <Icon name="camera" size={14} color={theme.active} />
          </View>
        </PressableScale>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "stretch", justifyContent: "center" }}>
          {editing ? (
            <>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                autoFocus
                maxLength={120}
                returnKeyType="done"
                onSubmitEditing={() => void saveName()}
                accessibilityLabel={t("settings.displayName")}
                maxFontSizeMultiplier={1.2}
                style={[{ flex: 1, color: theme.text, paddingVertical: 2, borderBottomWidth: 1, borderBottomColor: nameError ? theme.danger : theme.active }, nameStyle]}
              />
              <IconButton icon="close" label={t("mobile.profile.cancelEdit")} onPress={cancelEdit} color={theme.textMuted} busy={false} />
              <IconButton icon="check" label={t("mobile.profile.saveName")} onPress={() => void saveName()} color={theme.active} busy={saving} />
            </>
          ) : (
            <>
              <AppText variant="display" accessibilityRole="header" numberOfLines={1} style={[{ flexShrink: 1 }, nameStyle]}>
                {shownName || initials}
              </AppText>
              <IconButton icon={saved ? "check" : "pencil"} label={t("mobile.profile.editName")} onPress={startEdit} color={saved ? theme.success : theme.text} />
            </>
          )}
        </View>
        {nameError ? (
          <AppText variant="caption" accessibilityRole="alert" style={{ color: theme.danger }}>
            {nameError}
          </AppText>
        ) : null}
        <AppText muted numberOfLines={1}>
          {user.email}
        </AppText>
        <AppText variant="caption" muted numberOfLines={1}>
          {info.data?.university ?? t("mobile.profile.noInstitution")}
        </AppText>
        {info.data?.uniStatus === "pending" || info.data?.uniStatus === "approved" || info.data?.uniStatus === "rejected" ? (
          <AppText variant="caption" muted>
            {t(info.data.uniStatus === "pending" ? "mobile.profile.uniPending" : info.data.uniStatus === "approved" ? "mobile.profile.uniApproved" : "mobile.profile.uniRejected")}
          </AppText>
        ) : null}
      </View>

      {shownPlan ? (
        <ListGroup>
          <ListRow
            icon="sparkles"
            title={t(`mobile.profile.plans.name.${shownPlan}`)}
            subtitle={price ? `${t("mobile.profile.plans.price", { amount: price })}${t("mobile.profile.plans.perMonth")}` : t("usage.plan.FREE")}
            trailing={
              shownPlan !== "PRO" ? (
                <View style={{ paddingHorizontal: 10, minHeight: 24, justifyContent: "center", borderRadius: 999, backgroundColor: theme.primarySoft }}>
                  <AppText maxFontSizeMultiplier={1.2} style={{ color: theme.active, fontSize: 12, fontWeight: "600" }}>
                    {t("mobile.profile.plans.cta")}
                  </AppText>
                </View>
              ) : undefined
            }
            onPress={() => router.push("/plans")}
          />
        </ListGroup>
      ) : null}

      <ListGroup>
        <ListRow icon="pencil" title={t("mobile.profile.editName")} onPress={startEdit} />
        <ListRow icon="notes" title={t("nav.documents")} onPress={() => router.push("/documents")} />
        <ListRow icon="planner" title={t("nav.planner")} onPress={() => router.push("/planner")} />
        <ListRow icon="achievements" title={t("gamification.achievementsTitle")} onPress={() => router.push("/gamification")} />
      </ListGroup>

      <ListGroup>
        <ListRow
          icon="profile"
          title={t("teach.switch.change")}
          subtitle={t("teach.switch.current", { mode: mode === "teacher" ? t("teach.welcome.teacher") : t("teach.welcome.student") })}
          onPress={async () => {
            const next = mode === "teacher" ? "student" : "teacher";
            await setMode(next);
            router.replace(next === "teacher" ? "/teacher" : "/");
          }}
        />
        {mode === "teacher" ? null : <ListRow icon="settings" title={t("nav.settings")} onPress={() => router.navigate("/more")} />}
        <ListRow icon="xp" title={t("gamification.levelProgress")} trailing={info.data?.level ? t("gamification.level", { n: info.data.level }) : undefined} onPress={() => router.push("/gamification")} />
        <ListRow icon="locked" title={t("mobile.profile.privacyRow")} onPress={() => router.push("/privacy")} />
      </ListGroup>

      <ListGroup>
        <ListRow icon="sign-out" iconColor={theme.danger} titleColor={theme.danger} title={t("nav.signOut")} onPress={confirmSignOut} />
      </ListGroup>
    </Screen>
  );
}
