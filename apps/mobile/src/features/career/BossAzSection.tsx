import { useI18n } from "@unimate/i18n/react";
import { useEffect, useMemo, useState } from "react";
import { Linking, View } from "react-native";
import { AppText, Badge, Button, Card, Notice, PressableScale, Reveal, Skeleton, useToast } from "../../components/ui";
import { careerPrefsKey, kv } from "../../lib/storage";
import { unwrap, useAsync } from "../../lib/use-async";
import { EMPTY_PREFS, INTERESTS, recommend, type CareerPrefs, type Reason, type Recommendation } from "../../lib/bossaz";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { myCvSkills } from "./api";

function parsePrefs(raw: string | null): CareerPrefs {
  try {
    const o = JSON.parse(raw ?? "{}") as Partial<CareerPrefs>;
    return {
      interests: Array.isArray(o.interests) ? o.interests.filter((x): x is string => INTERESTS.some((i) => i.id === x)) : [],
    };
  } catch {
    return EMPTY_PREFS;
  }
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      <Badge tone={on ? "primary" : "neutral"}>{`${on ? "✓ " : ""}${label}`}</Badge>
    </PressableScale>
  );
}

/**
 * "Sənin üçün seçilmiş vakansiyalar": Boss.az category pages ranked from the signed-in student's own profile (specialty, faculty,
 * CV skills) and the interests / employment types they chose. No vacancies are copied: every card opens Boss.az's own category page.
 */
export function BossAzSection() {
  const { t } = useI18n();
  const { user, profile, supabase: sb } = useUser();
  const { toast } = useToast();
  const { theme } = useTheme();
  const [prefs, setPrefs] = useState<CareerPrefs>(EMPTY_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);

  // Preferences are per account on this device, so another student on the same phone never sees them.
  useEffect(() => {
    setLoaded(false);
    void kv
      .getItem(careerPrefsKey(user.id))
      .then((v) => setPrefs(parsePrefs(v)))
      .catch(() => setPrefs(EMPTY_PREFS))
      .finally(() => setLoaded(true));
  }, [user.id]);

  const signals = useAsync(async () => {
    const major = profile?.major_id ? ((unwrap(await sb.from("majors").select("name, faculties(name)").eq("id", profile.major_id).maybeSingle()) as { name: string; faculties: { name: string } | { name: string }[] | null } | null) ?? null) : null;
    const fac = major ? (Array.isArray(major.faculties) ? major.faculties[0]?.name : major.faculties?.name) ?? null : null;
    const skills = await myCvSkills(sb).catch(() => [] as string[]);
    return { major: major?.name ?? null, faculty: fac, skills };
  }, [user.id, profile?.major_id]);

  const recs = useMemo(() => recommend({ major: signals.data?.major ?? null, faculty: signals.data?.faculty ?? null, skills: signals.data?.skills ?? [] }, prefs), [signals.data, prefs]);

  const save = (next: CareerPrefs) => {
    setPrefs(next);
    void kv.setItem(careerPrefsKey(user.id), JSON.stringify(next)).catch(() => undefined);
  };
  const toggle = (value: string) => save({ interests: prefs.interests.includes(value) ? prefs.interests.filter((x) => x !== value) : [...prefs.interests, value] });
  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast(t("bossaz.openFailed"), "error");
    }
  };

  const reasonText = (r: Reason): string => {
    switch (r.kind) {
      case "major":
        return t("bossaz.whyMajor", { text: r.text });
      case "interest":
        return t("bossaz.whyInterest", { name: t(`bossaz.i_${r.interestId}` as never) });
      case "skill":
        return t("bossaz.whySkill", { text: r.text });
      default:
        return t("bossaz.whyEntry");
    }
  };
  const cardTitle = (r: Recommendation) => (r.interestId ? t(`bossaz.i_${r.interestId}` as never) : t("bossaz.students"));

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <AppText variant="heading" accessibilityRole="header">
          {t("bossaz.title")}
        </AppText>
        <AppText variant="caption" muted>
          {t("bossaz.subtitle")}
        </AppText>
      </View>

      {!loaded || (signals.loading && !signals.data) ? (
        <Skeleton height={96} />
      ) : (
        recs.map((r, i) => (
          <Reveal key={r.id} index={Math.min(i, 6)}>
            <PressableScale onPress={() => void open(r.url)} accessibilityRole="link" accessibilityLabel={`${cardTitle(r)}: ${t("bossaz.open")}`}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <AppText variant="heading" style={{ flex: 1 }}>
                    {cardTitle(r)}
                  </AppText>
                  <Badge tone={r.matched ? "success" : "neutral"}>{r.matched ? t("bossaz.match") : t("bossaz.entryBadge")}</Badge>
                </View>
                {r.reasons.map((x, n) => (
                  <AppText key={n} variant="caption" muted>
                    {reasonText(x)}
                  </AppText>
                ))}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <AppText variant="caption" muted>
                    {t("bossaz.source")}
                  </AppText>
                  <AppText variant="label" style={{ color: theme.active }}>
                    {t("bossaz.open")} {"↗"}
                  </AppText>
                </View>
              </Card>
            </PressableScale>
          </Reveal>
        ))
      )}

      <Button title={t("bossaz.prefsTitle")} variant="secondary" onPress={() => setEditing((e) => !e)} />
      {editing ? (
        <Card>
          <AppText variant="label">{t("bossaz.prefsInterests")}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {INTERESTS.map((i) => (
              <Chip key={i.id} label={t(`bossaz.i_${i.id}` as never)} on={prefs.interests.includes(i.id)} onPress={() => toggle(i.id)} />
            ))}
          </View>
          <AppText variant="caption" muted>
            {t("bossaz.prefsHint")}
          </AppText>
        </Card>
      ) : null}

      <Button title={t("bossaz.allVacancies")} variant="secondary" onPress={() => void open("https://boss.az/search/vacancies")} />
      <Notice tone="info" text={t("bossaz.notice")} />
    </View>
  );
}
