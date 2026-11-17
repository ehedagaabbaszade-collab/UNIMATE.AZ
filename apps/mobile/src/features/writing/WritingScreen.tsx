import { WRITING_KINDS, draftToText, renderDocumentHtml, renderSlidesHtml, type DocumentDraft, type SlidesDraft, type TitlePage, type WritingKind, type WritingLabels } from "@unimate/core";
import { t as translate, type Locale, type MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Share, View } from "react-native";
import { z } from "zod";
import { EdgeNotice } from "../../components/EdgeNotice";
import { AppText, Badge, Button, Card, ExpandCard, Input, Reveal, Segmented, SkeletonCard, useToast } from "../../components/ui";
import type { EdgeError } from "../../lib/edge";
import { writeAssignment } from "../../lib/edge-client";
import { useLocalValue } from "../../lib/local-store";
import { haptic } from "../../lib/motion";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { radii, spacing } from "../../theme/tokens";

const LANGS = ["az", "tr", "en", "ru"] as const;
const tpSchema = z.object({ university: z.string().max(200), faculty: z.string().max(200), department: z.string().max(200), group: z.string().max(60), student: z.string().max(120), teacher: z.string().max(120), city: z.string().max(60) });
type TP = z.infer<typeof tpSchema>;
const EMPTY_TP: TP = { university: "", faculty: "", department: "", group: "", student: "", teacher: "", city: "" };
const TP_FIELDS = ["university", "faculty", "department", "group", "student", "teacher", "city"] as const;
const TP_MAX: Record<(typeof TP_FIELDS)[number], number> = { university: 200, faculty: 200, department: 200, group: 60, student: 120, teacher: 120, city: 60 };

/** Labels for the printed document, in the language the work is written in (not necessarily the UI language). */
const printLabels = (lang: Locale, kind: WritingKind): WritingLabels => {
  const p = (k: string) => translate(lang, `writing.print.${k}` as MessageKey);
  return { kind: p(`kind.${kind}`), topic: p("topic"), subject: p("subject"), student: p("student"), group: p("group"), teacher: p("teacher"), contents: p("contents"), introduction: p("introduction"), conclusion: p("conclusion"), keyTerms: p("keyTerms"), references: p("references"), referencesNote: p("referencesNote") };
};

export function WritingScreen() {
  const { t, locale } = useI18n();
  const { theme } = useTheme();
  const { user, profile } = useUser();
  const { toast } = useToast();
  const tpStore = useLocalValue(`um.titlepage.${user.id}`, tpSchema, { ...EMPTY_TP, student: (profile?.display_name ?? "").slice(0, 120) });
  const [kind, setKind] = useState<WritingKind>("independent_work");
  const [topic, setTopic] = useState("");
  const [subject, setSubject] = useState("");
  const [requirements, setRequirements] = useState("");
  const [lang, setLang] = useState<Locale>(locale);
  const deck = kind === "presentation";
  const [length, setLength] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EdgeError | null>(null);
  const [topicError, setTopicError] = useState(false);
  const [draft, setDraft] = useState<{ kind: WritingKind; lang: Locale; data: DocumentDraft | SlidesDraft } | null>(null);
  const [exporting, setExporting] = useState(false);

  const range = deck ? { min: 5, max: 15 } : { min: 2, max: 12 };
  const clamp = (n: number) => Math.min(range.max, Math.max(range.min, n));

  async function generate() {
    if (topic.trim().length < 3) {
      haptic.error();
      return setTopicError(true);
    }
    setTopicError(false);
    setError(null);
    setBusy(true);
    const r = await writeAssignment({ kind, topic: topic.trim(), ...(subject.trim() ? { subject: subject.trim() } : {}), length: clamp(length), ...(requirements.trim() ? { requirements: requirements.trim() } : {}), outputLanguage: lang });
    setBusy(false);
    if (!r.ok) {
      haptic.error();
      return setError(r.error);
    }
    haptic.success();
    setDraft({ kind, lang, data: r.data.result });
  }

  const titlePage = (forLang: Locale): TitlePage => {
    const v = tpStore.value;
    const opt = (s: string) => (s.trim() ? s.trim() : undefined);
    return {
      ministry: translate(forLang, "writing.print.ministry"),
      university: opt(v.university),
      faculty: opt(v.faculty),
      department: opt(v.department),
      subject: opt(subject),
      student: opt(v.student),
      group: opt(v.group),
      teacher: opt(v.teacher),
      city: opt(v.city) ?? translate(forLang, "writing.print.city"),
      year: String(new Date().getFullYear()),
    };
  };

  async function sharePdf() {
    if (!draft) return;
    setExporting(true);
    try {
      const data = draft.data;
      const file = "slides" in data ? await Print.printToFileAsync({ html: renderSlidesHtml(data, titlePage(draft.lang)), width: 960, height: 540 }) : await Print.printToFileAsync({ html: renderDocumentHtml(data, titlePage(draft.lang), printLabels(draft.lang, draft.kind)) });
      if (!(await Sharing.isAvailableAsync())) toast(t("writing.sharingUnavailable"), "error");
      else await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
    } catch {
      toast(t("writing.exportFailed"), "error");
    } finally {
      setExporting(false);
    }
  }

  const shareText = () => {
    if (!draft) return;
    void Share.share({ message: draftToText(draft.data, printLabels(draft.lang, draft.kind)) }).catch(() => undefined);
  };

  const chapters = draft && !("slides" in draft.data) ? [{ heading: t("writing.print.introduction"), paragraphs: draft.data.introduction }, ...draft.data.sections, { heading: t("writing.print.conclusion"), paragraphs: draft.data.conclusion }] : [];

  return (
    <View style={{ gap: spacing.lg }}>
      <AppText muted>{t("writing.subtitle")}</AppText>

      <Card>
        <Segmented
          label={t("writing.kindLabel")}
          value={kind}
          onChange={(k) => {
            setKind(k);
            setLength(k === "presentation" ? 10 : 5);
          }}
          options={WRITING_KINDS.map((k) => ({ value: k, label: t(`writing.kind.${k}`) }))}
        />
        <Input label={t("writing.topic")} value={topic} onChangeText={setTopic} maxLength={300} placeholder={t("writing.topicPlaceholder")} error={topicError ? t("writing.topicRequired") : undefined} />
        <Input label={t("writing.subject")} value={subject} onChangeText={setSubject} maxLength={120} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
          <AppText variant="label">{deck ? t("writing.slides", { n: clamp(length) }) : t("writing.pages", { n: clamp(length) })}</AppText>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <Button small variant="secondary" title="−" accessibilityLabel={t("writing.less")} onPress={() => setLength((n) => clamp(n - 1))} />
            <Button small variant="secondary" title="+" accessibilityLabel={t("writing.more")} onPress={() => setLength((n) => clamp(n + 1))} />
          </View>
        </View>
        <Segmented label={t("writing.language")} value={lang} onChange={(v) => setLang(v)} options={LANGS.map((l) => ({ value: l, label: l.toUpperCase() }))} />
        <Input label={t("writing.requirements")} value={requirements} onChangeText={setRequirements} maxLength={1000} multiline style={{ minHeight: 80, textAlignVertical: "top" }} hint={t("writing.requirementsHint")} />
        <Button title={busy ? t("writing.generating") : t("writing.generate")} loading={busy} onPress={() => void generate()} />
        {busy ? (
          <AppText variant="caption" muted style={{ textAlign: "center" }}>
            {t("writing.wait")}
          </AppText>
        ) : null}
      </Card>

      {error ? <EdgeNotice error={error} /> : null}
      {busy ? <SkeletonCard lines={4} /> : null}

      {draft && !busy ? (
        <Reveal>
          <Card>
            <Badge tone="primary">{t(`writing.kind.${draft.kind}`)}</Badge>
            <AppText variant="title" selectable>
              {draft.data.title}
            </AppText>
            {"slides" in draft.data
              ? draft.data.slides.map((s, i) => (
                  <View key={i} style={{ gap: 4, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: theme.border }}>
                    <AppText variant="label">{`${i + 2}. ${s.title}`}</AppText>
                    {s.bullets.map((b, j) => (
                      <AppText key={j} variant="caption" muted selectable>
                        {`• ${b}`}
                      </AppText>
                    ))}
                  </View>
                ))
              : chapters.map((s, i) => (
                  <View key={i} style={{ gap: 4, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: theme.border }}>
                    <AppText variant="label">{s.heading}</AppText>
                    <AppText variant="caption" muted numberOfLines={3} selectable>
                      {s.paragraphs.join(" ")}
                    </AppText>
                  </View>
                ))}
            <View style={{ padding: spacing.md, borderRadius: radii.md, backgroundColor: theme.warningSoft }}>
              <AppText variant="caption" style={{ color: theme.warning, fontWeight: "600" }}>
                {t("writing.draftNote")}
              </AppText>
            </View>
            <AppText variant="label">{t("writing.keywords")}</AppText>
            <AppText variant="caption" muted selectable>
              {draft.data.searchKeywords.join(" · ")}
            </AppText>
            <Button title={t("writing.sharePdf")} loading={exporting} onPress={() => void sharePdf()} />
            <Button title={t("writing.shareText")} variant="secondary" onPress={shareText} />
            <Button title={t("writing.regenerate")} variant="ghost" onPress={() => void generate()} />
          </Card>
        </Reveal>
      ) : null}

      <ExpandCard label={t("writing.titlePage")} header={<AppText variant="heading">{t("writing.titlePage")}</AppText>}>
        <AppText variant="caption" muted>
          {t("writing.titlePageHint")}
        </AppText>
        {TP_FIELDS.map((f) => (
          <Input key={f} label={t(`writing.tp.${f}`)} value={tpStore.value[f]} maxLength={TP_MAX[f]} onChangeText={(v) => tpStore.update((s) => ({ ...s, [f]: v.slice(0, TP_MAX[f]) }))} />
        ))}
      </ExpandCard>
    </View>
  );
}
