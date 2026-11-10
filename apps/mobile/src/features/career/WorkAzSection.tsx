import { useI18n } from "@unimate/i18n/react";
import { useEffect, useMemo, useState } from "react";
import { Linking, View } from "react-native";
import { AppText, Badge, Button, Card, Input, Notice, PressableScale, Reveal, Skeleton, useToast } from "../../components/ui";
import { careerPrefsKey, kv } from "../../lib/storage";
import { unwrap, useAsync } from "../../lib/use-async";
import { EMPLOYMENT_KINDS, EMPTY_PREFS, INTERESTS, recommend, searchUrl, type CareerPrefs, type EmploymentKind, type Reason, type Recommendation } from "../../lib/workaz";
import { useUser } from "../../state/session";
import { myCvSkills } from "./api";

function parsePrefs(raw: string | null): CareerPrefs {
  try {
    const o = JSON.parse(raw ?? "{}") as Partial<CareerPrefs>;
    return {
      interests: Array.isArray(o.interests) ? o.interests.filter((x): x is string => INTERESTS.some((i) => i.id === x)) : [],
      kinds: Array.isArray(o.kinds) ? o.kinds.filter((x): x is EmploymentKind => (EMPLOYMENT_KINDS as readonly string[]).includes(x)) : [],
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
 * "Sənin üçün seçilmiş vakansiyalar": Work.az searches ranked from the signed-in student's own profile (specialty, faculty,
 * CV skills) and the interests / employment types they chose. No vacancies are copied: every card opens Work.az's own search.
 */
export function WorkAzSection() {
  const { t } = useI18n();
  const { user, profile, supabase: sb } = useUser();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<CareerPrefs>(EMPTY_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");

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
    let skills: string[] = [];
    try {
      skills = await myCvSkills(sb);
    } catch {
      skills = [];
    }
    return { major: major?.name ?? null, faculty: fac, skills };
  }, [user.id, profile?.major_id]);

  const recs = useMemo(() => recommend({ major: signals.data?.major ?? null, faculty: signals.data?.faculty ?? null, skills: signals.data?.skills ?? [] }, prefs), [signals.data, prefs]);

  const save = (next: CareerPrefs) => {
    setPrefs(next);
    void kv.setItem(careerPrefsKey(user.id), JSON.stringify(next)).catch(() => undefined);
  };
  const toggle = (key: "interests" | "kinds", value: string) => {
    const cur = prefs[key] as string[];
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    save({ ...prefs, [key]: next } as CareerPrefs);
  };
  const open = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      toast(t("workaz.openFailed"), "error");
    }
  };

  const reasonText = (r: Reason): string => {
    switch (r.kind) {
      case "major":
        return t("workaz.whyMajor", { text: r.text });
      case "interest":
        return t("workaz.whyInterest", { name: t(`workaz.i_${r.interestId}` as never) });
      case "skill":
        return t("workaz.whySkill", { text: r.text });
      case "type":
        return t("workaz.whyType", { name: t(`workaz.kind_${r.type}` as never) });
      default:
        return t("workaz.whyEntry");
    }
  };
  const cardTitle = (r: Recommendation) => (r.interestId ? t(`workaz.i_${r.interestId}` as never) : t(`workaz.kind_${r.kind}` as never));

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <AppText variant="heading" accessibilityRole="header">
          {t("workaz.title")}
        </AppText>
        <AppText variant="caption" muted>
          {t("workaz.subtitle")}
        </AppText>
      </View>

      {!loaded || (signals.loading && !signals.data) ? (
        <Skeleton height={96} />
      ) : (
        recs.map((r, i) => (
          <Reveal key={r.id} index={Math.min(i, 6)}>
            <PressableScale onPress={() => void open(r.url)} accessibilityRole="link" accessibilityLabel={`${cardTitle(r)}: ${t("workaz.open")}`}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <AppText variant="heading" style={{ flex: 1 }}>
                    {cardTitle(r)}
                  </AppText>
                  <Badge tone={r.matched ? "success" : "neutral"}>{r.matched ? t("workaz.match") : t("workaz.entryBadge")}</Badge>
                </View>
                {r.reasons.map((x, n) => (
                  <AppText key={n} variant="caption" muted>
                    {reasonText(x)}
                  </AppText>
                ))}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <AppText variant="caption" muted>
                    {t("workaz.source")}
                  </AppText>
                  <AppText variant="label" style={{ color: "#06B6DA" }}>
                    {t("workaz.open")} {"↗"}
                  </AppText>
                </View>
              </Card>
            </PressableScale>
          </Reveal>
        ))
      )}

      <Button title={t("workaz.prefsTitle")} variant="secondary" onPress={() => setEditing((e) => !e)} />
      {editing ? (
        <Card>
          <AppText variant="label">{t("workaz.prefsInterests")}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {INTERESTS.map((i) => (
              <Chip key={i.id} label={t(`workaz.i_${i.id}` as never)} on={prefs.interests.includes(i.id)} onPress={() => toggle("interests", i.id)} />
            ))}
          </View>
          <AppText variant="label">{t("workaz.prefsKinds")}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {EMPLOYMENT_KINDS.map((k) => (
              <Chip key={k} label={t(`workaz.kind_${k}` as never)} on={prefs.kinds.includes(k)} onPress={() => toggle("kinds", k)} />
            ))}
          </View>
          <AppText variant="caption" muted>
            {t("workaz.prefsHint")}
          </AppText>
        </Card>
      ) : null}

      <Input label={t("workaz.searchLabel")} value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => query.trim() && void open(searchUrl(query))} />
      <Button title={t("workaz.searchGo")} disabled={!query.trim()} onPress={() => void open(searchUrl(query))} />
      <Notice tone="info" text={t("workaz.notice")} />
    </View>
  );
}
