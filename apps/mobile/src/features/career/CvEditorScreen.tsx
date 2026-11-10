import {
  CV_LANGUAGES,
  CV_SECTIONS,
  CV_SECTION_ITEMS_MAX,
  CV_TEMPLATES,
  cvCompleteness,
  renderCvHtml,
  type CvData,
  type CvDocumentInput,
  type CvFeedback,
  type CvLanguage,
  type CvPrintLabels,
} from "@unimate/core";
import { t as translate, type MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import * as Print from "expo-print";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { EdgeNotice } from "../../components/EdgeNotice";
import { Icon } from "../../components/Icon";
import { PickerField } from "../../components/PickerField";
import { ProgressRing } from "../../components/ProgressRing";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Screen, ScreenHeader, Segmented, Skeleton, useToast } from "../../components/ui";
import type { EdgeError } from "../../lib/edge";
import { cvFeedback } from "../../lib/edge-client";
import { useAsync } from "../../lib/use-async";
import { useTheme } from "../../theme/ThemeProvider";
import { useUser } from "../../state/session";
import { deleteCv, getCv, myTracking, saveCv } from "./api";

type Obj = Record<string, any>;
type Kind = "text" | "csv" | "lines" | "bool";
interface FieldDef {
  key: string;
  label: MessageKey;
  kind?: Kind;
  multiline?: boolean;
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

function Entries({ title, items, fields, make, onChange, rev }: { title: string; items: Obj[]; fields: FieldDef[]; make: () => Obj; onChange: (next: Obj[]) => void; rev: number }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const set = (i: number, k: string, v: unknown) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card>
      <AppText variant="heading">{title}</AppText>
      {items.map((it, i) => (
        <View key={`${rev}-${i}`} style={{ gap: 8, paddingTop: 8, borderTopWidth: i ? 1 : 0, borderTopColor: theme.border }}>
          {fields.map((f) =>
            f.kind === "bool" ? (
              <Pressable key={f.key} onPress={() => set(i, f.key, !it[f.key])} accessibilityRole="checkbox" accessibilityState={{ checked: !!it[f.key] }} accessibilityLabel={t(f.label)} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
                <Icon name={it[f.key] ? "check" : "add"} size="sm" color={it[f.key] ? theme.success : theme.textMuted} />
                <AppText>{t(f.label)}</AppText>
              </Pressable>
            ) : f.kind === "csv" || f.kind === "lines" ? (
              <ListField key={`${rev}-${i}-${f.key}`} label={t(f.label)} value={it[f.key] ?? []} parse={f.kind === "csv" ? csv : lines} join={f.kind === "csv" ? ", " : "\n"} multiline={f.kind === "lines"} onChange={(v) => set(i, f.key, v)} />
            ) : (
              <Input key={f.key} label={t(f.label)} value={String(it[f.key] ?? "")} onChangeText={(v) => set(i, f.key, v)} multiline={f.multiline} style={f.multiline ? { minHeight: 70, textAlignVertical: "top" } : undefined} />
            ),
          )}
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
  { key: "level", label: "career.cv.field.langLevel" },
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
  { key: "link", label: "career.cv.field.link" },
];

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
  const { supabase: sb } = useUser();
  const doc = useAsync(() => getCv(sb, id), [sb, id]);
  const [draft, setDraft] = useState<CvDocumentInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rev, setRev] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
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
  const setPersonal = (k: keyof CvData["personal"], v: string) => setData("personal", { ...cv.personal, [k]: v });
  const sectionList = <K extends "education" | "experience" | "languages" | "projects" | "certificates">(k: K) => (next: Obj[]) => {
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
      return true;
    }
    toast(r.error === "too_large" ? t("career.cv.tooLarge") : r.error === "invalid" ? t("career.cv.invalid") : t("career.cv.saveFailed"), "error");
    return false;
  };
  const exportPdf = async () => {
    setExporting(true);
    try {
      const labels = Object.fromEntries([...CV_SECTIONS, "present"].map((k) => [k, translate(draft.language, `career.cv.sectionPrint.${k}` as MessageKey)])) as CvPrintLabels;
      const html = renderCvHtml(cv, { template: draft.template, language: draft.language, title: draft.title, labels });
      const file = await Print.printToFileAsync({ html });
      if (!(await Sharing.isAvailableAsync())) toast(t("career.cv.sharingUnavailable"), "error");
      else await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    } catch {
      toast(t("career.cv.exportFailed"), "error");
    } finally {
      setExporting(false);
    }
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
            {score.missing.slice(0, 3).map((k) => (
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
        <Segmented label={t("career.cv.template")} value={draft.template} onChange={(v) => edit((d) => ({ ...d, template: v }))} options={CV_TEMPLATES.map((x) => ({ value: x, label: t(`career.cv.templates.${x}`) }))} />
      </Card>

      <Card>
        <AppText variant="heading">{t("career.cv.section.personal")}</AppText>
        {(["fullName", "headline", "email", "phone", "city", "linkedin", "website"] as const).map((k) => (
          <Input
            key={k}
            label={t(`career.cv.field.${k}`)}
            value={cv.personal[k]}
            onChangeText={(v) => setPersonal(k, v)}
            autoCapitalize={k === "email" || k === "linkedin" || k === "website" ? "none" : "words"}
            keyboardType={k === "email" ? "email-address" : k === "phone" ? "phone-pad" : "default"}
          />
        ))}
      </Card>
      <Card>
        <AppText variant="heading">{t("career.cv.section.summary")}</AppText>
        <Input label={t("career.cv.field.summary")} value={cv.summary} onChangeText={(v) => setData("summary", v)} multiline maxLength={1500} style={{ minHeight: 100, textAlignVertical: "top" }} />
      </Card>
      <Entries title={t("career.cv.section.education")} items={cv.education} fields={EDU} rev={rev} make={() => ({ institution: "", degree: "", field: "", start: "", end: "", gpa: "", description: "" })} onChange={sectionList("education")} />
      <Entries title={t("career.cv.section.experience")} items={cv.experience} fields={EXP} rev={rev} make={() => ({ company: "", role: "", location: "", start: "", end: "", current: false, bullets: [] })} onChange={sectionList("experience")} />
      <Card>
        <AppText variant="heading">{t("career.cv.section.skills")}</AppText>
        <ListField label={t("career.cv.field.skills")} value={cv.skills} parse={csv} join=", " onChange={(v) => setData("skills", v.slice(0, CV_SECTION_ITEMS_MAX).map((s) => s.slice(0, 50)))} />
      </Card>
      <Entries title={t("career.cv.section.languages")} items={cv.languages} fields={LANG} rev={rev} make={() => ({ name: "", level: "" })} onChange={sectionList("languages")} />
      <Entries title={t("career.cv.section.projects")} items={cv.projects} fields={PROJ} rev={rev} make={() => ({ name: "", link: "", description: "", tech: [] })} onChange={sectionList("projects")} />
      <Entries title={t("career.cv.section.certificates")} items={cv.certificates} fields={CERT} rev={rev} make={() => ({ name: "", issuer: "", year: "", link: "" })} onChange={sectionList("certificates")} />

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
