import { isInviteCode, normalizeInviteCode } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, ExpandCard, HeroTitle, Input, PressableScale, Screen, ScreenHeader, Skeleton, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useAppMode } from "../../state/mode";
import { useUser } from "../../state/session";
import { spacing } from "../../theme/tokens";
import { ClassApiError, createClass, joinClass, myClasses } from "./api";

/** Toast for any class RPC failure, with a specific message where the server gave a known reason. */
export function useClassError() {
  const { t } = useI18n();
  const { toast } = useToast();
  return (e: unknown) => toast(t(`teach.class.errors.${e instanceof ClassApiError ? e.key : "generic"}`), "error");
}

/**
 * Classes: a teacher creates classes (private study groups) and opens them; a student joins one with the teacher's code.
 * `pushed`: opened on the stack (student side, from More), so it shows the native back header.
 */
export function ClassesScreen({ pushed = false }: { pushed?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const onError = useClassError();
  const { user, supabase: sb } = useUser();
  const { mode } = useAppMode(user.id);
  const teacher = mode === "teacher";
  const list = useAsync(() => myClasses(sb), [sb]);
  const reload = list.reload;
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reload();
    }, [reload]),
  );
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const open = (id: string) => router.push({ pathname: "/class/[id]", params: { id } } as Href);

  async function run(kind: "create" | "join") {
    setBusy(kind);
    try {
      const id = kind === "create" ? await createClass(sb, name.trim()) : await joinClass(sb, code);
      toast(t(kind === "create" ? "teach.class.created" : "teach.class.joined"), "success");
      setName("");
      setCode("");
      reload();
      open(id);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  const classes = (list.data ?? []).filter((c) => (teacher ? c.teaching : !c.teaching));
  return (
    <Screen ambient>
      {pushed ? <ScreenHeader title={t("teach.class.title")} /> : null}
      <HeroTitle muted={t("teach.class.title")} strong={t("teach.class.heroStrong")} />

      {teacher ? (
        <ExpandCard label={t("teach.class.create")} header={<AppText variant="heading">{t("teach.class.create")}</AppText>} defaultOpen={list.data?.every((c) => !c.teaching)}>
          <Input label={t("teach.class.name")} placeholder={t("teach.class.namePlaceholder")} value={name} onChangeText={setName} maxLength={100} />
          <Button title={t("teach.class.create")} loading={busy === "create"} disabled={name.trim().length < 2 || !!busy} onPress={() => void run("create")} />
        </ExpandCard>
      ) : (
        <ExpandCard label={t("teach.class.join")} header={<AppText variant="heading">{t("teach.class.join")}</AppText>} defaultOpen={list.data?.every((c) => c.teaching)}>
          <Input label={t("teach.class.code")} value={code} onChangeText={(v) => setCode(normalizeInviteCode(v).slice(0, 10))} autoCapitalize="characters" autoCorrect={false} />
          <Button title={t("teach.class.join")} loading={busy === "join"} disabled={!isInviteCode(code) || !!busy} onPress={() => void run("join")} />
        </ExpandCard>
      )}

      {list.loading && !list.data ? (
        <Skeleton height={72} />
      ) : list.error && !list.data ? (
        <ErrorState title={t("teach.class.errors.generic")} action={<Button title={t("common.retry")} onPress={reload} />} />
      ) : classes.length === 0 ? (
        <EmptyState title={t("teach.class.empty")} description={t(teacher ? "teach.class.emptyTeacher" : "teach.class.emptyStudent")} />
      ) : (
        <View style={{ gap: spacing.md }}>
          {classes.map((c) => (
            <PressableScale key={c.id} onPress={() => open(c.id)} accessibilityRole="button" accessibilityLabel={c.name}>
              <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText variant="heading" numberOfLines={2}>
                    {c.name}
                  </AppText>
                  <AppText variant="caption" muted>
                    {t("teach.class.members", { n: c.member_count })}
                  </AppText>
                </View>
                {c.teaching ? <Badge tone="primary">{t("teach.class.teaching")}</Badge> : null}
              </Card>
            </PressableScale>
          ))}
        </View>
      )}
    </Screen>
  );
}
