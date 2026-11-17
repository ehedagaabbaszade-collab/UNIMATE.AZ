"use client";

import { WRITING_KINDS, draftToText, renderDocumentHtml, renderSlidesHtml, type DocumentDraft, type SlidesDraft, type TitlePage, type WritingKind, type WritingLabels } from "@unimate/core";
import { t as translate, type Locale, type MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Input, Select, Skeleton, Textarea, useToast } from "@unimate/ui";
import { useEffect, useState } from "react";
import { z } from "zod";
import { EdgeNotice } from "@/components/EdgeNotice";
import { useUser } from "@/components/user";
import type { EdgeError } from "@/lib/edge";
import { writeAssignment } from "@/lib/edge-client";
import { useLocalValue } from "@/lib/local-value";

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

/** Prints an HTML document through a hidden iframe: the browser's print dialog offers "Save as PDF". */
let printing: { frame: HTMLIFrameElement; timer?: ReturnType<typeof setTimeout> } | null = null;
function clearPrint() {
  if (!printing) return;
  clearTimeout(printing.timer);
  printing.frame.remove();
  printing = null;
}
function printHtml(html: string) {
  clearPrint(); // never more than one iframe
  const frame = document.createElement("iframe");
  const job: NonNullable<typeof printing> = { frame };
  printing = job;
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
  frame.srcdoc = html;
  frame.onload = () => {
    frame.contentWindow?.addEventListener("afterprint", () => printing === job && clearPrint());
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    job.timer = setTimeout(() => printing === job && clearPrint(), 60_000); // fallback when afterprint never fires
  };
  document.body.appendChild(frame);
}

export function WritingPage() {
  const { t, locale } = useI18n();
  const user = useUser();
  const { toast } = useToast();
  useEffect(() => clearPrint, []);
  const tpStore = useLocalValue(`um.titlepage.${user.id}`, tpSchema, { ...EMPTY_TP, student: (user.displayName ?? "").slice(0, 120) });
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

  const range = deck ? { min: 5, max: 15 } : { min: 2, max: 12 };
  const clamp = (n: number) => Math.min(range.max, Math.max(range.min, n));

  async function generate() {
    if (topic.trim().length < 3) return setTopicError(true);
    setTopicError(false);
    setError(null);
    setBusy(true);
    const r = await writeAssignment({ kind, topic: topic.trim(), ...(subject.trim() ? { subject: subject.trim() } : {}), length: clamp(length), ...(requirements.trim() ? { requirements: requirements.trim() } : {}), outputLanguage: lang });
    setBusy(false);
    if (!r.ok) return setError(r.error);
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

  function sharePdf() {
    if (!draft) return;
    try {
      const d = draft.data;
      printHtml("slides" in d ? renderSlidesHtml(d, titlePage(draft.lang)) : renderDocumentHtml(d, titlePage(draft.lang), printLabels(draft.lang, draft.kind)));
    } catch {
      toast(t("writing.exportFailed"), "error");
    }
  }

  async function shareText() {
    if (!draft) return;
    const text = draftToText(draft.data, printLabels(draft.lang, draft.kind));
    try {
      if (navigator.share) await navigator.share({ text });
      else await navigator.clipboard.writeText(text);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) toast(t("writing.sharingUnavailable"), "error");
    }
  }

  const chapters = draft && !("slides" in draft.data) ? [{ heading: t("writing.print.introduction"), paragraphs: draft.data.introduction }, ...draft.data.sections, { heading: t("writing.print.conclusion"), paragraphs: draft.data.conclusion }] : [];

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("writing.title")}</h1>
        <p>{t("writing.subtitle")}</p>
      </div>

      <Card>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <Select
            label={t("writing.kindLabel")}
            value={kind}
            onChange={(e) => {
              const k = e.target.value as WritingKind;
              setKind(k);
              setLength(k === "presentation" ? 10 : 5);
            }}
          >
            {WRITING_KINDS.map((k) => (
              <option key={k} value={k}>{t(`writing.kind.${k}`)}</option>
            ))}
          </Select>
          <Input label={t("writing.topic")} value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={300} placeholder={t("writing.topicPlaceholder")} error={topicError ? t("writing.topicRequired") : undefined} />
          <Input label={t("writing.subject")} value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} />
          <div className="row row--between">
            <strong>{deck ? t("writing.slides", { n: clamp(length) }) : t("writing.pages", { n: clamp(length) })}</strong>
            <div className="row">
              <Button type="button" variant="secondary" size="sm" aria-label={t("writing.less")} onClick={() => setLength((n) => clamp(n - 1))}>−</Button>
              <Button type="button" variant="secondary" size="sm" aria-label={t("writing.more")} onClick={() => setLength((n) => clamp(n + 1))}>+</Button>
            </div>
          </div>
          <Select label={t("writing.language")} value={lang} onChange={(e) => setLang(e.target.value as Locale)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </Select>
          <Textarea label={t("writing.requirements")} value={requirements} onChange={(e) => setRequirements(e.target.value)} maxLength={1000} hint={t("writing.requirementsHint")} />
          <div>
            <Button type="submit" loading={busy}>{busy ? t("writing.generating") : t("writing.generate")}</Button>
          </div>
          {busy ? <p className="um-hint" role="status">{t("writing.wait")}</p> : null}
        </form>
      </Card>

      {error ? <EdgeNotice error={error} /> : null}
      {busy ? <Skeleton height={160} /> : null}

      {draft && !busy ? (
        <Card>
          <div className="stack">
            <div>
              <Badge tone="primary">{t(`writing.kind.${draft.kind}`)}</Badge>
            </div>
            <h2>{draft.data.title}</h2>
            {"slides" in draft.data
              ? draft.data.slides.map((sl, i) => (
                  <div key={i} className="stack">
                    <strong>{`${i + 2}. ${sl.title}`}</strong>
                    {sl.bullets.map((b, j) => (
                      <span key={j} className="um-hint">{`• ${b}`}</span>
                    ))}
                  </div>
                ))
              : chapters.map((c, i) => (
                  <div key={i} className="stack">
                    <strong>{c.heading}</strong>
                    <span className="um-hint">{c.paragraphs.join(" ")}</span>
                  </div>
                ))}
            <p className="warn-box">{t("writing.draftNote")}</p>
            <strong>{t("writing.keywords")}</strong>
            <span className="um-hint">{draft.data.searchKeywords.join(" · ")}</span>
            <div className="row">
              <Button onClick={sharePdf}>{t("writing.sharePdf")}</Button>
              <Button variant="secondary" onClick={() => void shareText()}>{t("writing.shareText")}</Button>
              <Button variant="ghost" onClick={() => void generate()}>{t("writing.regenerate")}</Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <details>
          <summary><strong>{t("writing.titlePage")}</strong></summary>
          <div className="stack" style={{ marginTop: "var(--space-3)" }}>
            <p className="um-hint">{t("writing.titlePageHint")}</p>
            {TP_FIELDS.map((f) => (
              <Input key={f} label={t(`writing.tp.${f}`)} value={tpStore.value[f]} maxLength={TP_MAX[f]} onChange={(e) => tpStore.update((st) => ({ ...st, [f]: e.target.value.slice(0, TP_MAX[f]) }))} />
            ))}
          </div>
        </details>
      </Card>
    </div>
  );
}
