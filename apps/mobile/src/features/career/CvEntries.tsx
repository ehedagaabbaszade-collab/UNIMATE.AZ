import { CEFR_LEVELS, CV_EMPLOYMENT_TYPES, CV_SECTION_ITEMS_MAX, type CvDescribeKind, type CvLanguage } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Image, View } from "react-native";
import { EdgeNotice } from "../../components/EdgeNotice";
import { Icon } from "../../components/Icon";
import { PickerField } from "../../components/PickerField";
import { AppText, Badge, Button, Card, Input, PressableScale, useToast } from "../../components/ui";
import type { EdgeError } from "../../lib/edge";
import { cvDescribe } from "../../lib/edge-client";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { moveItem } from "./cv-helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CV JSON is schema-less in the editor
export type Obj = Record<string, any>;
type Kind = "text" | "csv" | "lines" | "bool" | "cefr" | "employment" | "skillKind" | "level";
export interface FieldDef {
  key: string;
  label: MessageKey;
  kind?: Kind;
  multiline?: boolean;
  /** Hidden when this returns true (CEFR pickers for a native language). */
  hideIf?: (it: Obj) => boolean;
}
/** Which description field gets the "write with AI" button, the non-PII context sent to the model, and the field's length cap. */
export interface AiDef {
  kind: CvDescribeKind;
  field: string;
  max: number;
  ctx: (it: Obj) => Record<string, string>;
}
const pick = (o: Obj, ...keys: string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, (Array.isArray(o[k]) ? o[k].join(", ") : String(o[k] ?? "")).slice(0, 200)] as const).filter(([, v]) => v.trim()));
const SOCIAL_CHIPS = ["LinkedIn", "Instagram", "WhatsApp", "GitHub", "Telegram"];
const CEFR_OPTIONS = ["", ...CEFR_LEVELS].map((l) => ({ id: l, label: l || "-" }));
export const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
export const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** "Write with AI" for one field: shows the suggestion first; nothing changes until Accept. Sends only the allow-listed entry context. */
export function AiWrite({ kind, language, context, current, max, asLines, onText }: { kind: CvDescribeKind; language: CvLanguage; context: Record<string, string>; current: string; max: number; asLines?: boolean; onText: (v: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<EdgeError | null>(null);
  const [proposal, setProposal] = useState<string | null>(null);
  const run = async () => {
    // the server refuses to write from nothing (no invented facts); say so instead of a generic failure
    if (!Object.values(context).some((v) => v.trim()) && !current.trim()) return setMsg(t("career.cv.ai.needContext"));
    setBusy(true);
    setMsg("");
    setError(null);
    const r = await cvDescribe({ kind, language, context, ...(current.trim() ? { current: current.slice(0, 1500) } : {}) });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setProposal(asLines ? lines(r.data.text.replace(/^\s*[-*•]\s*/gm, "")).slice(0, 8).map((l) => l.slice(0, 300)).join("\n") : r.data.text.slice(0, max));
  };
  return (
    <View style={{ gap: 6, alignItems: "stretch" }}>
      <View style={{ alignItems: "flex-start" }}>
        <Button small variant="secondary" title={busy ? t("career.cv.ai.working") : t(current.trim() ? "career.cv.ai.improve" : "career.cv.ai.write")} loading={busy} icon={<Icon name="ai-chat" size="sm" />} onPress={() => void run()} />
      </View>
      {msg ? (
        <AppText variant="caption" muted>
          {msg}
        </AppText>
      ) : null}
      {error ? <EdgeNotice error={error} /> : null}
      {proposal !== null ? (
        <Proposal
          text={proposal}
          onAccept={() => {
            onText(proposal);
            setProposal(null);
          }}
          onDiscard={() => setProposal(null)}
        />
      ) : null}
    </View>
  );
}
/** AI text preview with Accept / Discard (also used for the "Review my CV" rewritten summary). */
export function Proposal({ text, onAccept, onDiscard }: { text: string; onAccept: () => void; onDiscard: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  return (
    <View style={{ gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: theme.border }}>
      <Badge tone="info">{t("cvMobile.aiProposed")}</Badge>
      <AppText>{text}</AppText>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button small title={t("cvMobile.aiAccept")} onPress={onAccept} />
        <Button small variant="secondary" title={t("cvMobile.aiDiscard")} onPress={onDiscard} />
      </View>
      <AppText variant="caption" muted>
        {t("career.ai.disclaimer")}
      </AppText>
    </View>
  );
}

/** Keeps its own text while typing so separators (commas, newlines) are not eaten by the parse/join round trip. */
function ListField({ label, value, parse, join, multiline, onChange }: { label: string; value: string[]; parse: (s: string) => string[]; join: string; multiline?: boolean; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(join));
  return (
    <Input
      label={label}
      value={text}
      onChangeText={(s) => {
        setText(s);
        onChange(parse(s));
      }}
      multiline={multiline}
      autoCapitalize="none"
      style={multiline ? { minHeight: 80, textAlignVertical: "top" } : undefined}
    />
  );
}

/** One section's entries: fields, AI, add / remove / move up / move down. `rev` remounts text fields after undo, redo, reload or AI. */
export function Entries({ title, items, fields, make, onChange, rev, ai, language, group }: { title: string; items: Obj[]; fields: FieldDef[]; make: () => Obj; onChange: (next: Obj[], group?: string) => void; rev: number; ai?: AiDef; language: CvLanguage; group: string }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [aiRev, setAiRev] = useState(0);
  const set = (i: number, k: string, v: unknown) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)), `${group}.${i}.${k}`);
  const selectOptions = (f: FieldDef) =>
    f.kind === "employment"
      ? [{ id: "", label: "-" }, ...CV_EMPLOYMENT_TYPES.map((v) => ({ id: v, label: t(`career.cv.employmentType.${v}`) }))]
      : f.kind === "skillKind"
        ? [{ id: "", label: "-" }, ...(["technical", "soft"] as const).map((v) => ({ id: v, label: t(`career.cv.skillKind.${v}`) }))]
        : [{ id: "", label: "-" }, ...[1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: String(n) }))];
  const aiButton = (it: Obj, i: number, f: FieldDef) =>
    ai && ai.field === f.key ? (
      <AiWrite
        key={`ai-${f.key}`}
        kind={ai.kind}
        language={language}
        context={ai.ctx(it)}
        current={f.kind === "lines" ? (it[f.key] ?? []).join("\n") : String(it[f.key] ?? "")}
        max={ai.max}
        asLines={f.kind === "lines"}
        onText={(v) => {
          set(i, f.key, f.kind === "lines" ? lines(v) : v);
          setAiRev((r) => r + 1);
        }}
      />
    ) : null;
  return (
    <Card>
      <AppText variant="heading">{title}</AppText>
      {items.map((it, i) => (
        <View key={`${rev}-${i}`} style={{ gap: 8, paddingTop: 8, borderTopWidth: i ? 1 : 0, borderTopColor: theme.border }}>
          {fields.flatMap((f) => [
            f.hideIf?.(it) ? null : f.kind === "cefr" ? (
              <PickerField key={f.key} label={t(f.label)} sections={[{ data: CEFR_OPTIONS }]} value={String(it[f.key] ?? "")} onChange={(v) => set(i, f.key, v)} />
            ) : f.kind === "employment" || f.kind === "skillKind" || f.kind === "level" ? (
              <PickerField
                key={f.key}
                label={t(f.label)}
                sections={[{ data: selectOptions(f) }]}
                value={String(it[f.key] ?? "")}
                onChange={(v) => set(i, f.key, f.kind === "employment" ? v : v === "" ? undefined : f.kind === "level" ? Number(v) : v)}
              />
            ) : f.kind === "bool" ? (
              <PressableScale key={f.key} onPress={() => set(i, f.key, !it[f.key])} accessibilityRole="checkbox" accessibilityState={{ checked: !!it[f.key] }} accessibilityLabel={t(f.label)} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
                <Icon name={it[f.key] ? "check" : "add"} size="sm" color={it[f.key] ? theme.success : theme.textMuted} />
                <AppText>{t(f.label)}</AppText>
              </PressableScale>
            ) : f.kind === "csv" || f.kind === "lines" ? (
              <ListField key={`${rev}-${aiRev}-${i}-${f.key}`} label={t(f.label)} value={it[f.key] ?? []} parse={f.kind === "csv" ? csv : lines} join={f.kind === "csv" ? ", " : "\n"} multiline={f.kind === "lines"} onChange={(v) => set(i, f.key, v)} />
            ) : (
              <Input key={`${aiRev}-${f.key}`} label={t(f.label)} value={String(it[f.key] ?? "")} onChangeText={(v) => set(i, f.key, v)} multiline={f.multiline} style={f.multiline ? { minHeight: 70, textAlignVertical: "top" } : undefined} />
            ),
            aiButton(it, i, f),
          ])}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button small variant="secondary" title="↑" accessibilityLabel={t("career.cv.design.moveUp")} disabled={i === 0} onPress={() => onChange(moveItem(items, i, -1))} />
            <Button small variant="secondary" title="↓" accessibilityLabel={t("career.cv.design.moveDown")} disabled={i === items.length - 1} onPress={() => onChange(moveItem(items, i, 1))} />
            <Button small variant="danger" title={t("career.cv.removeEntry")} onPress={() => onChange(items.filter((_, j) => j !== i))} />
          </View>
        </View>
      ))}
      <Button small variant="secondary" title={t("career.cv.add")} disabled={items.length >= CV_SECTION_ITEMS_MAX} icon={<Icon name="add" size="sm" />} onPress={() => onChange([...items, make()])} />
    </Card>
  );
}

const F = (key: string, kind?: Kind, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label: `career.cv.field.${key}` as MessageKey, ...(kind ? { kind } : {}), ...extra });
const FL = (key: string, label: string, kind?: Kind, extra: Partial<FieldDef> = {}): FieldDef => ({ key, label: `career.cv.field.${label}` as MessageKey, ...(kind ? { kind } : {}), ...extra });
const DESC = FL("description", "description", undefined, { multiline: true });
export const EDU: FieldDef[] = [FL("institution", "institution"), FL("degree", "degree"), FL("field", "fieldOfStudy"), F("start"), F("end"), F("gpa"), DESC, F("city"), FL("website", "website"), F("eqfLevel")];
export const EXP: FieldDef[] = [F("role"), FL("company", "company"), F("location"), FL("employmentType", "employmentType", "employment"), F("start"), F("end"), F("current", "bool"), FL("bullets", "responsibilities", "lines"), F("achievements", "lines")];
export const SKILL: FieldDef[] = [FL("name", "skillName"), FL("kind", "skillKind", "skillKind"), FL("level", "skillLevel", "level")];
export const LANG: FieldDef[] = [
  FL("name", "langName"),
  F("native", "bool"),
  FL("level", "langLevel", undefined, { hideIf: (it) => !!it.native }),
  ...(["listening", "reading", "spokenProduction", "spokenInteraction", "writing"] as const).map((k): FieldDef => F(k, "cefr", { hideIf: (it) => !!it.native })),
];
export const PROJ: FieldDef[] = [FL("name", "projectName"), FL("role", "projectRole"), F("link"), FL("tech", "tech", "csv"), DESC];
export const CERT: FieldDef[] = [FL("name", "certName"), F("issuer"), F("year"), F("date"), F("expiry"), FL("credentialUrl", "credentialUrl"), F("link"), F("mode"), DESC];
export const HOBBY: FieldDef[] = [F("title"), DESC];
export const HONOUR: FieldDef[] = [F("title"), F("issuer"), F("date"), DESC];
export const ACTIVITY: FieldDef[] = [F("title"), F("place"), F("date"), DESC];
export const VOLUNTEER: FieldDef[] = [F("role"), FL("organization", "company"), F("location"), F("start"), F("end"), F("current", "bool"), DESC];
export const PUBLICATION: FieldDef[] = [F("title"), F("publisher"), F("date"), F("link"), DESC];
export const COURSE: FieldDef[] = [FL("name", "certName"), F("provider"), F("date"), DESC];
export const REFERENCE: FieldDef[] = [FL("name", "fullName"), F("position"), FL("company", "company"), F("email"), F("phone"), F("note"), F("onRequest", "bool")];
export const AI: Record<string, AiDef> = {
  education: { kind: "education", field: "description", max: 600, ctx: (o) => pick(o, "institution", "degree", "field") },
  experience: { kind: "experience", field: "bullets", max: 300, ctx: (o) => ({ ...pick(o, "role", "company", "location"), ...(o.start || o.end ? { dates: `${o.start ?? ""} - ${o.current ? "" : (o.end ?? "")}`.slice(0, 200) } : {}) }) },
  projects: { kind: "project", field: "description", max: 600, ctx: (o) => pick(o, "name", "tech") },
  certificates: { kind: "certificate", field: "description", max: 1000, ctx: (o) => pick(o, "name", "issuer", "date", "mode") },
  hobbies: { kind: "hobby", field: "description", max: 1000, ctx: (o) => pick(o, "title") },
  honours: { kind: "honour", field: "description", max: 1000, ctx: (o) => pick(o, "title", "issuer", "date") },
  activities: { kind: "activity", field: "description", max: 1000, ctx: (o) => pick(o, "title", "place", "date") },
};

const SIGNED_URL_TTL_S = 600;
export function PhotoField({ url, path, uid, onChange }: { url: string; path: string; uid: string; onChange: (p: { photoUrl: string; photoPath: string }) => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const { toast } = useToast();
  const { supabase: sb } = useUser();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    let live = true;
    if (!path) setPreview("");
    else void sb.storage.from("cv-photos").createSignedUrl(path, SIGNED_URL_TTL_S).then((r) => live && setPreview(r.data?.signedUrl ?? ""));
    return () => {
      live = false;
    };
  }, [path, sb]);
  const shown = path ? preview : url;
  const pickPhoto = async () => {
    setBusy(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
      if (res.canceled || !res.assets[0]) return;
      const next = `${uid}/${Crypto.randomUUID()}.jpg`;
      const bytes = await new File(res.assets[0].uri).arrayBuffer();
      const up = await sb.storage.from("cv-photos").upload(next, bytes, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw new Error(up.error.message);
      onChange({ photoUrl: "", photoPath: next });
    } catch {
      toast(t("common.genericError"), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        {shown ? <Image source={{ uri: shown }} accessibilityIgnoresInvertColors style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.border }} /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, flexShrink: 1, minWidth: 0 }}>
          <Button small variant="secondary" title={t("career.cv.photo.add")} loading={busy} icon={<Icon name="add" size="sm" />} onPress={() => void pickPhoto()} />
          {shown || path ? <Button small variant="danger" title={t("career.cv.photo.remove")} onPress={() => onChange({ photoUrl: "", photoPath: "" })} /> : null}
        </View>
      </View>
      <AppText variant="caption" muted>
        {t("career.cv.photo.hint")}
      </AppText>
    </View>
  );
}

export type Social = { platform: string; value: string };
export function Socials({ items, onChange }: { items: Social[]; onChange: (next: Social[]) => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const set = (i: number, k: keyof Social, v: string) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="label">{t("career.cv.field.socials")}</AppText>
      {items.map((it, i) => (
        <View key={i} style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: theme.border }}>
          <Input label={t("career.cv.field.platform")} value={it.platform} onChangeText={(v) => set(i, "platform", v)} maxLength={40} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {SOCIAL_CHIPS.map((c) => (
              <PressableScale key={c} onPress={() => set(i, "platform", c)} accessibilityRole="button" accessibilityLabel={c} style={{ minHeight: 44, justifyContent: "center" }}>
                <Badge tone={it.platform === c ? "info" : "neutral"}>{c}</Badge>
              </PressableScale>
            ))}
          </View>
          <Input label={t("career.cv.field.socialValue")} value={it.value} onChangeText={(v) => set(i, "value", v)} autoCapitalize="none" maxLength={200} />
          <Button small variant="danger" title={t("career.cv.removeEntry")} onPress={() => onChange(items.filter((_, j) => j !== i))} />
        </View>
      ))}
      <Button small variant="secondary" title={t("career.cv.add")} disabled={items.length >= 10} icon={<Icon name="add" size="sm" />} onPress={() => onChange([...items, { platform: "", value: "" }])} />
    </View>
  );
}
