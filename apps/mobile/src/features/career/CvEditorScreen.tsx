import {
  CEFR_LEVELS,
  CV_LANGUAGES,
  CV_PRINT_LABEL_KEYS,
  CV_SECTION_ITEMS_MAX,
  cvCompleteness,
  cvMissingRequired,
  renderCvHtml,
  type CvData,
  type CvDescribeKind,
  type CvDocumentInput,
  type CvFeedback,
  type CvLanguage,
  type CvPrintLabels,
} from "@unimate/core";
import { t as translate, type MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Asset } from "expo-asset";
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useRef, useState } from "react";
import { Image, View } from "react-native";
import { EdgeNotice } from "../../components/EdgeNotice";
import { Icon } from "../../components/Icon";
import { PickerField } from "../../components/PickerField";
import { ProgressRing } from "../../components/ProgressRing";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Screen, ScreenHeader, Segmented, Skeleton, useToast, PressableScale } from "../../components/ui";
import type { EdgeError } from "../../lib/edge";
import { cvDescribe, cvFeedback } from "../../lib/edge-client";
import { useAsync } from "../../lib/use-async";
import { useTheme } from "../../theme/ThemeProvider";
import { useUser } from "../../state/session";
import { TemplatePicker } from "./TemplatePicker";
import { createCv, deleteCv, getCv, myTracking, saveCv } from "./api";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CV JSON is schema-less in the editor
type Obj = Record<string, any>;
type Kind = "text" | "csv" | "lines" | "bool" | "cefr";
interface FieldDef {
  key: string;
  label: MessageKey;
  kind?: Kind;
  multiline?: boolean;
  /** Hidden when this returns true (CEFR pickers for a native language). */
  hideIf?: (it: Obj) => boolean;
}
/** Which description field gets the "write with AI" button, the non-PII context sent to the model, and the field's length cap. */
interface AiDef {
  kind: CvDescribeKind;
  field: string;
  max: number;
  ctx: (it: Obj) => Record<string, string>;
}
const pick = (o: Obj, ...keys: string[]): Record<string, string> =>
  Object.fromEntries(keys.map((k) => [k, (Array.isArray(o[k]) ? o[k].join(", ") : String(o[k] ?? "")).slice(0, 200)] as const).filter(([, v]) => v.trim()));
const SOCIAL_CHIPS = ["LinkedIn", "Instagram", "WhatsApp", "GitHub", "Telegram"];
const CEFR_OPTIONS = ["", ...CEFR_LEVELS].map((l) => ({ id: l, label: l || "-" }));

/** "Write with AI" for one description field. Sends only the allow-listed entry context, never personal identifiers. */
function AiWrite({ kind, language, context, current, max, asLines, onText }: { kind: CvDescribeKind; language: CvLanguage; context: Record<string, string>; current: string; max: number; asLines?: boolean; onText: (v: string) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const run = async () => {
    // the server refuses to write from nothing (no invented facts); say so instead of a generic failure
    if (!Object.values(context).some((v) => v.trim()) && !current.trim()) return setMsg(t("career.cv.ai.needContext"));
    setBusy(true);
    setMsg("");
    const r = await cvDescribe({ kind, language, context, ...(current.trim() ? { current: current.slice(0, 1500) } : {}) });
    setBusy(false);
    if (!r.ok) return setMsg(t(r.error.kind === "provider_not_configured" ? "career.cv.ai.notConfigured" : "career.cv.ai.failed"));
    onText(asLines ? lines(r.data.text.replace(/^\s*[-*\u2022]\s*/gm, "")).slice(0, 8).map((l) => l.slice(0, 300)).join("\n") : r.data.text.slice(0, max));
  };
  return (
    <View style={{ gap: 4, alignItems: "flex-start" }}>
      <Button small variant="secondary" title={busy ? t("career.cv.ai.working") : t(current.trim() ? "career.cv.ai.improve" : "career.cv.ai.write")} loading={busy} icon={<Icon name="ai-chat" size="sm" />} onPress={() => void run()} />
      {msg ? (
        <AppText variant="caption" muted>
          {msg}
        </AppText>
      ) : null}
    </View>
  );
}
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

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

function Entries({ title, items, fields, make, onChange, rev, ai, language }: { title: string; items: Obj[]; fields: FieldDef[]; make: () => Obj; onChange: (next: Obj[]) => void; rev: number; ai?: AiDef; language: CvLanguage }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const [aiRev, setAiRev] = useState(0); // remounts text fields after AI replaced their content
  const set = (i: number, k: string, v: unknown) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
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
          <Button small variant="danger" title={t("career.cv.removeEntry")} onPress={() => onChange(items.filter((_, j) => j !== i))} />
        </View>
      ))}
      <Button small variant="secondary" title={t("career.cv.add")} disabled={items.length >= CV_SECTION_ITEMS_MAX} icon={<Icon name="add" size="sm" />} onPress={() => onChange([...items, make()])} />
    </Card>
  );
}

const EDU: FieldDef[] = [
  { key: "institution", label: "career.cv.field.institution" },
  { key: "degree", label: "career.cv.field.degree" },
  { key: "field", label: "career.cv.field.fieldOfStudy" },
  { key: "start", label: "career.cv.field.start" },
  { key: "end", label: "career.cv.field.end" },
  { key: "gpa", label: "career.cv.field.gpa" },
  { key: "description", label: "career.cv.field.description", multiline: true },
  { key: "city", label: "career.cv.field.city" },
  { key: "website", label: "career.cv.field.website" },
  { key: "eqfLevel", label: "career.cv.field.eqfLevel" },
];
const EXP: FieldDef[] = [
  { key: "role", label: "career.cv.field.role" },
  { key: "company", label: "career.cv.field.company" },
  { key: "location", label: "career.cv.field.location" },
  { key: "start", label: "career.cv.field.start" },
  { key: "end", label: "career.cv.field.end" },
  { key: "current", label: "career.cv.field.current", kind: "bool" },
  { key: "bullets", label: "career.cv.field.bullets", kind: "lines" },
];
const LANG: FieldDef[] = [
  { key: "name", label: "career.cv.field.langName" },
  { key: "native", label: "career.cv.field.native", kind: "bool" },
  { key: "level", label: "career.cv.field.langLevel", hideIf: (it) => !!it.native },
  ...(["listening", "reading", "spokenProduction", "spokenInteraction", "writing"] as const).map((k): FieldDef => ({ key: k, label: `career.cv.field.${k}`, kind: "cefr", hideIf: (it) => !!it.native })),
];
const PROJ: FieldDef[] = [
  { key: "name", label: "career.cv.field.projectName" },
  { key: "link", label: "career.cv.field.link" },
  { key: "description", label: "career.cv.field.description", multiline: true },
  { key: "tech", label: "career.cv.field.tech", kind: "csv" },
];
const CERT: FieldDef[] = [
  { key: "name", label: "career.cv.field.certName" },
  { key: "issuer", label: "career.cv.field.issuer" },
  { key: "year", label: "career.cv.field.year" },
  { key: "date", label: "career.cv.field.date" },
  { key: "mode", label: "career.cv.field.mode" },
  { key: "link", label: "career.cv.field.link" },
  { key: "description", label: "career.cv.field.description", multiline: true },
];
const HOBBY: FieldDef[] = [
  { key: "title", label: "career.cv.field.title" },
  { key: "description", label: "career.cv.field.description", multiline: true },
];
const HONOUR: FieldDef[] = [
  { key: "title", label: "career.cv.field.title" },
  { key: "issuer", label: "career.cv.field.issuer" },
  { key: "date", label: "career.cv.field.date" },
  { key: "description", label: "career.cv.field.description", multiline: true },
];
const ACTIVITY: FieldDef[] = [
  { key: "title", label: "career.cv.field.title" },
  { key: "place", label: "career.cv.field.place" },
  { key: "date", label: "career.cv.field.date" },
  { key: "description", label: "career.cv.field.description", multiline: true },
];
const AI: Record<string, AiDef> = {
  education: { kind: "education", field: "description", max: 600, ctx: (o) => pick(o, "institution", "degree", "field") },
  experience: { kind: "experience", field: "bullets", max: 300, ctx: (o) => ({ ...pick(o, "role", "company", "location"), ...(o.start || o.end ? { dates: `${o.start ?? ""} - ${o.current ? "" : (o.end ?? "")}`.slice(0, 200) } : {}) }) },
  projects: { kind: "project", field: "description", max: 600, ctx: (o) => pick(o, "name", "tech") },
  certificates: { kind: "certificate", field: "description", max: 1000, ctx: (o) => pick(o, "name", "issuer", "date", "mode") },
  hobbies: { kind: "hobby", field: "description", max: 1000, ctx: (o) => pick(o, "title") },
  honours: { kind: "honour", field: "description", max: 1000, ctx: (o) => pick(o, "title", "issuer", "date") },
  activities: { kind: "activity", field: "description", max: 1000, ctx: (o) => pick(o, "title", "place", "date") },
};

let logoCache: string | undefined;
/** The bundled official full logo as a data URI (the print HTML accepts only https or data:image). */
async function logoDataUri(): Promise<string | undefined> {
  if (logoCache) return logoCache;
  try {
    const a = await Asset.fromModule(require("../../../assets/full-logo.png") as number).downloadAsync();
    if (!a.localUri) return undefined;
    return (logoCache = `data:image/png;base64,${await new File(a.localUri).base64()}`);
  } catch {
    return undefined;
  }
}
/** Photo as a data URI for the PDF renderer; falls back to the https URL when the download fails. */
async function photoSrc(url: string): Promise<string> {
  const tmp = new File(Paths.cache, `cvphoto-${Crypto.randomUUID()}.jpg`);
  try {
    const f = await File.downloadFileAsync(url, tmp);
    return `data:image/jpeg;base64,${await f.base64()}`;
  } catch {
    return url;
  } finally {
    try {
      if (tmp.exists) tmp.delete();
    } catch {
      /* temp file; harmless */
    }
  }
}

const SIGNED_URL_TTL_S = 600;
function PhotoField({ url, path, uid, onChange }: { url: string; path: string; uid: string; onChange: (p: { photoUrl: string; photoPath: string }) => void }) {
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
  const removePhoto = () => {
    onChange({ photoUrl: "", photoPath: "" });
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
        {shown ? <Image source={{ uri: shown }} accessibilityIgnoresInvertColors style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.border }} /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, flexShrink: 1, minWidth: 0 }}>
          <Button small variant="secondary" title={t("career.cv.photo.add")} loading={busy} icon={<Icon name="add" size="sm" />} onPress={() => void pickPhoto()} />
          {shown || path ? <Button small variant="danger" title={t("career.cv.photo.remove")} onPress={() => void removePhoto()} /> : null}
        </View>
      </View>
      <AppText variant="caption" muted>
        {t("career.cv.photo.hint")}
      </AppText>
    </View>
  );
}

type Social = { platform: string; value: string };
function Socials({ items, onChange }: { items: Social[]; onChange: (next: Social[]) => void }) {
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

function FeedbackPanel({ cvId, language, ensureSaved }: { cvId: string; language: CvLanguage; ensureSaved: () => Promise<boolean> }) {
  const { t } = useI18n();
  const { supabase: sb } = useUser();
  const tracked = useAsync(() => myTracking(sb), [sb]);
  const [target, setTarget] = useState("");
  const [lang, setLang] = useState<CvLanguage>(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EdgeError | null>(null);
  const [out, setOut] = useState<{ feedback: CvFeedback; cached: boolean } | null>(null);
  const listings = (tracked.data ?? []).filter((i) => i.listingState === "published" && i.opportunityId);
  const run = async () => {
    setBusy(true);
    setError(null);
    if (!(await ensureSaved())) return setBusy(false);
    const r = await cvFeedback(cvId, { ...(target ? { opportunityId: target } : {}), outputLanguage: lang });
    setBusy(false);
    if (r.ok) setOut(r.data);
    else setError(r.error);
  };
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="ai-chat" size="md" />
        <AppText variant="heading">{t("career.ai.cvTitle")}</AppText>
      </View>
      <AppText muted>{t("career.ai.cvBody")}</AppText>
      {listings.length ? (
        <PickerField
          label={t("career.ai.target")}
          sections={[{ data: [{ id: "", label: t("career.ai.targetNone") }, ...listings.map((l) => ({ id: l.opportunityId!, label: `${l.title} · ${l.organization}` }))] }]}
          value={target}
          onChange={setTarget}
        />
      ) : null}
      <Segmented label={t("career.ai.language")} value={lang} onChange={setLang} options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))} />
      <Button title={busy ? t("career.ai.working") : t("career.ai.action")} loading={busy} onPress={() => void run()} />
      {error ? <EdgeNotice error={error} /> : null}
      {out ? (
        <View style={{ gap: 8 }}>
          {out.cached ? (
            <AppText variant="caption" muted>
              {t("career.ai.cached")}
            </AppText>
          ) : null}
          <AppText variant="label">{t("career.ai.overall")}</AppText>
          <AppText>{out.feedback.overall}</AppText>
          <AppText variant="label">{t("career.ai.strengths")}</AppText>
          {out.feedback.strengths.map((s, i) => (
            <AppText key={`s${i}`}>{`• ${s}`}</AppText>
          ))}
          <AppText variant="label">{t("career.ai.improvements")}</AppText>
          {out.feedback.improvements.map((s, i) => (
            <View key={`i${i}`} style={{ gap: 4 }}>
              <Badge tone="info">{s.section === "general" ? t("career.ai.sectionGeneral") : t(`career.cv.section.${s.section}`)}</Badge>
              <AppText>{s.suggestion}</AppText>
            </View>
          ))}
          {out.feedback.missingKeywords.length ? (
            <>
              <AppText variant="label">{t("career.ai.keywords")}</AppText>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                {out.feedback.missingKeywords.map((k) => (
                  <Badge key={k} tone="warning">
                    {k}
                  </Badge>
                ))}
              </View>
            </>
          ) : null}
          {out.feedback.rewrittenSummary ? (
            <>
              <AppText variant="label">{t("career.ai.summary")}</AppText>
              <AppText muted>{out.feedback.rewrittenSummary}</AppText>
            </>
          ) : null}
          <AppText variant="caption" muted>
            {t("career.ai.disclaimer")}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

export function CvEditorScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const router = useRouter();
  const { toast } = useToast();
  const { user, supabase: sb } = useUser();
  const doc = useAsync(() => getCv(sb, id), [sb, id]);
  const [draft, setDraft] = useState<CvDocumentInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rev, setRev] = useState(0);
  const [sumRev, setSumRev] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // cv-photos objects: replaced/removed ones are deleted only after a successful save; never-saved uploads are deleted on leave.
  const savedPhoto = useRef("");
  const uploadedPhotos = useRef(new Set<string>());
  const sbRef = useRef(sb);
  useEffect(() => {
    const up = uploadedPhotos.current;
    const client = sbRef.current;
    return () => {
      const orphans = [...up].filter((x) => x !== savedPhoto.current);
      if (orphans.length) void client.storage.from("cv-photos").remove(orphans);
    };
  }, []);
  useEffect(() => {
    if (doc.data && !draft) savedPhoto.current = doc.data.data.personal.photoPath;
    if (doc.data && !draft) setDraft({ title: doc.data.title, language: doc.data.language, template: doc.data.template, data: doc.data.data });
  }, [doc.data, draft]);

  const header = <ScreenHeader title={t("career.tabs.cv")} onBack={() => router.back()} />;
  if (doc.loading && !doc.data) {
    return (
      <Screen>
        {header}
        <Skeleton height={220} />
      </Screen>
    );
  }
  if (doc.error) {
    return (
      <Screen>
        {header}
        <ErrorState title={t("career.loadFailed")} description={doc.error} action={<Button title={t("common.retry")} onPress={doc.reload} />} />
      </Screen>
    );
  }
  if (!doc.data || !draft) {
    return (
      <Screen>
        {header}
        <EmptyState title={t("career.notFound")} />
      </Screen>
    );
  }

  const cv = draft.data;
  const score = cvCompleteness(cv);
  const edit = (fn: (d: CvDocumentInput) => CvDocumentInput) => {
    setDraft((d) => (d ? fn(d) : d));
    setDirty(true);
  };
  const setData = <K extends keyof CvData>(k: K, v: CvData[K]) => edit((d) => ({ ...d, data: { ...d.data, [k]: v } }));
  const setPersonal = <K extends keyof CvData["personal"]>(k: K, v: CvData["personal"][K]) => setData("personal", { ...cv.personal, [k]: v });
  const sectionList = <K extends "education" | "experience" | "languages" | "projects" | "certificates" | "hobbies" | "honours" | "activities">(k: K) => (next: Obj[]) => {
    if (next.length < cv[k].length) setRev((r) => r + 1);
    setData(k, next as CvData[K]);
  };

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaving(true);
    const r = await saveCv(sb, id, draft);
    setSaving(false);
    if (r.ok) {
      setDirty(false);
      toast(t("career.cv.saved"));
      const cur = draft.data.personal.photoPath;
      const stale = [savedPhoto.current, ...uploadedPhotos.current].filter((x) => x && x !== cur);
      savedPhoto.current = cur;
      uploadedPhotos.current.clear();
      if (stale.length) void sbRef.current.storage.from("cv-photos").remove(stale); // best effort

      return true;
    }
    toast(r.error === "too_large" ? t("career.cv.tooLarge") : r.error === "invalid" ? t("career.cv.invalid") : t("career.cv.saveFailed"), "error");
    return false;
  };
  const exportPdf = async () => {
    const missing = cvMissingRequired(cv);
    if (missing.length) return toast(`${t("career.cv.required")}: ${missing.map((k) => t(`career.cv.field.${k}`)).join(", ")}`, "error");
    setExporting(true);
    try {
      const labels = Object.fromEntries(CV_PRINT_LABEL_KEYS.map((k) => [k, translate(draft.language, `career.cv.sectionPrint.${k}` as MessageKey)])) as CvPrintLabels;
      const signed = cv.personal.photoPath ? (await sb.storage.from("cv-photos").createSignedUrl(cv.personal.photoPath, SIGNED_URL_TTL_S)).data?.signedUrl : undefined;
      const photoLink = signed ?? cv.personal.photoUrl;
      const [logo, photo] = await Promise.all([logoDataUri(), photoLink ? photoSrc(photoLink) : Promise.resolve(undefined)]);
      const html = renderCvHtml(cv, { template: draft.template, language: draft.language, title: draft.title, labels, assets: { logoSrc: logo, photoSrc: photo } });
      const file = await Print.printToFileAsync({ html });
      if (!(await Sharing.isAvailableAsync())) toast(t("career.cv.sharingUnavailable"), "error");
      else await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    } catch {
      toast(t("career.cv.exportFailed"), "error");
    } finally {
      setExporting(false);
    }
  };
  const duplicate = async () => {
    const res = await createCv(sb, user.id, { title: `${draft.title} (2)`.slice(0, 120), language: draft.language, template: draft.template, data: draft.data });
    if (res.ok) {
      toast(t("career.cv.duplicated"), "success");
      router.replace(`/career/cv/${res.id}` as never);
    } else toast(res.error === "limit" ? t("career.cv.limit") : t("career.cv.saveFailed"), "error");
  };
  const remove = async () => {
    setConfirmDelete(false);
    try {
      await deleteCv(sb, id);
      router.back();
    } catch {
      toast(t("career.cv.saveFailed"), "error");
    }
  };

  return (
    <Screen>
      {header}
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <ProgressRing fraction={score.score / 100} track={theme.border} from={theme.primary} to={theme.info} label={t("career.cv.score")}>
            {`${score.score}%`}
          </ProgressRing>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="heading">{t("career.cv.scoreValue", { n: score.score })}</AppText>
            {score.missing.length ? <AppText variant="label">{t("career.cv.improve")}</AppText> : null}
            {score.missing.filter((k) => k !== "hobbies" && k !== "honours" && k !== "activities").slice(0, 3).map((k) => (
              <AppText key={k} variant="caption" muted>
                {`• ${t(`career.cv.tip.${k}`)}`}
              </AppText>
            ))}
          </View>
        </View>
      </Card>

      <Card>
        <Input label={t("career.cv.title")} value={draft.title} onChangeText={(v) => edit((d) => ({ ...d, title: v }))} maxLength={120} />
        <Segmented label={t("career.cv.language")} value={draft.language} onChange={(v) => edit((d) => ({ ...d, language: v }))} options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))} />
        <TemplatePicker value={draft.template} onChange={(v) => edit((d) => ({ ...d, template: v }))} />
      </Card>

      <Card>
        <AppText variant="heading">{t("career.cv.section.personal")}</AppText>
        <PhotoField url={cv.personal.photoUrl} path={cv.personal.photoPath} uid={user.id} onChange={(p) => {
            if (p.photoPath) uploadedPhotos.current.add(p.photoPath);
            setData("personal", { ...cv.personal, ...p });
          }} />
        {(["fullName", "headline", "email", "phone", "city", "address", "idNumber", "birthDate", "nationality", "gender", "linkedin", "website"] as const).map((k) => (
          <Input
            key={k}
            label={k === "fullName" || k === "email" || k === "phone" ? `${t(`career.cv.field.${k}`)} * (${t("career.cv.required")})` : t(`career.cv.field.${k}`)}
            value={cv.personal[k]}
            onChangeText={(v) => setPersonal(k, v)}
            autoCapitalize={k === "email" || k === "linkedin" || k === "website" ? "none" : "words"}
            keyboardType={k === "email" ? "email-address" : k === "phone" ? "phone-pad" : "default"}
          />
        ))}
        <Socials items={cv.personal.socials} onChange={(v) => setPersonal("socials", v)} />
      </Card>
      <Card>
        <AppText variant="heading">{t("career.cv.section.summary")}</AppText>
        <Input key={`sum-${sumRev}`} label={t("career.cv.field.summary")} value={cv.summary} onChangeText={(v) => setData("summary", v)} multiline maxLength={1500} style={{ minHeight: 100, textAlignVertical: "top" }} />
        <AiWrite
          kind="summary"
          language={draft.language}
          context={{ ...(cv.personal.headline ? { title: cv.personal.headline.slice(0, 200) } : {}), ...(cv.skills.length ? { skills: cv.skills.join(", ").slice(0, 200) } : {}) }}
          current={cv.summary}
          max={1500}
          onText={(v) => {
            setData("summary", v);
            setSumRev((r) => r + 1);
          }}
        />
      </Card>
      <Entries title={t("career.cv.section.education")} items={cv.education} fields={EDU} rev={rev} language={draft.language} ai={AI.education} make={() => ({ institution: "", degree: "", field: "", start: "", end: "", gpa: "", description: "", city: "", website: "", eqfLevel: "" })} onChange={sectionList("education")} />
      <Entries title={t("career.cv.section.experience")} items={cv.experience} fields={EXP} rev={rev} language={draft.language} ai={AI.experience} make={() => ({ company: "", role: "", location: "", start: "", end: "", current: false, bullets: [] })} onChange={sectionList("experience")} />
      <Card>
        <AppText variant="heading">{t("career.cv.section.skills")}</AppText>
        <ListField label={t("career.cv.field.skills")} value={cv.skills} parse={csv} join=", " onChange={(v) => setData("skills", v.slice(0, CV_SECTION_ITEMS_MAX).map((s) => s.slice(0, 50)))} />
      </Card>
      <Entries title={t("career.cv.section.languages")} items={cv.languages} fields={LANG} rev={rev} language={draft.language} make={() => ({ name: "", level: "", native: false, listening: "", reading: "", spokenProduction: "", spokenInteraction: "", writing: "" })} onChange={sectionList("languages")} />
      <Entries title={t("career.cv.section.projects")} items={cv.projects} fields={PROJ} rev={rev} language={draft.language} ai={AI.projects} make={() => ({ name: "", link: "", description: "", tech: [] })} onChange={sectionList("projects")} />
      <Entries title={t("career.cv.section.certificates")} items={cv.certificates} fields={CERT} rev={rev} language={draft.language} ai={AI.certificates} make={() => ({ name: "", issuer: "", year: "", link: "", date: "", mode: "", description: "" })} onChange={sectionList("certificates")} />
      <Entries title={t("career.cv.section.hobbies")} items={cv.hobbies} fields={HOBBY} rev={rev} language={draft.language} ai={AI.hobbies} make={() => ({ title: "", description: "" })} onChange={sectionList("hobbies")} />
      <Entries title={t("career.cv.section.honours")} items={cv.honours} fields={HONOUR} rev={rev} language={draft.language} ai={AI.honours} make={() => ({ title: "", issuer: "", date: "", description: "" })} onChange={sectionList("honours")} />
      <Entries title={t("career.cv.section.activities")} items={cv.activities} fields={ACTIVITY} rev={rev} language={draft.language} ai={AI.activities} make={() => ({ title: "", place: "", date: "", description: "" })} onChange={sectionList("activities")} />

      <Button title={t("career.cv.save")} loading={saving} disabled={!dirty} onPress={() => void save()} />
      {dirty ? (
        <AppText variant="caption" muted>
          {t("career.cv.unsaved")}
        </AppText>
      ) : null}
      <Card>
        <Button title={t("career.cv.export")} variant="secondary" icon={<Icon name="download" size="sm" />} loading={exporting} onPress={() => void exportPdf()} />
        <AppText variant="caption" muted>
          {t("career.cv.exportHintMobile")}
        </AppText>
      </Card>

      <FeedbackPanel cvId={id} language={draft.language} ensureSaved={save} />

      <Button title={t("career.cv.duplicate")} variant="secondary" onPress={() => void duplicate()} />
      <Button title={t("career.cv.delete")} variant="danger" onPress={() => setConfirmDelete(true)} />
      <Dialog
        open={confirmDelete}
        title={t("career.cv.delete")}
        onClose={() => setConfirmDelete(false)}
        actions={
          <>
            <Button small variant="secondary" title={t("common.cancel")} onPress={() => setConfirmDelete(false)} />
            <Button small variant="danger" title={t("common.delete")} onPress={() => void remove()} />
          </>
        }
      >
        <AppText>{t("career.cv.deleteConfirm")}</AppText>
      </Dialog>
    </Screen>
  );
}
