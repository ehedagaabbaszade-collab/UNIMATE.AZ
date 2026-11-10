"use client";

import {
  CV_LANGUAGES,
  CV_SECTION_ITEMS_MAX,
  CV_TEMPLATES,
  cvCompleteness,
  type CvData,
  type CvDocumentInput,
  type CvFeedback,
  type CvLanguage,
} from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Icon, Input, ProgressRing, Select, Skeleton, Textarea, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import type { EdgeError } from "@/lib/edge";
import { cvFeedback } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { deleteCv, getCv, myTracking, saveCv } from "./api";
import { Chips } from "./parts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CV JSON is schema-less in the editor
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
  const update = (s: string) => {
    setText(s);
    onChange(parse(s));
  };
  return multiline ? <Textarea label={label} rows={3} value={text} onChange={(e) => update(e.target.value)} /> : <Input label={label} value={text} onChange={(e) => update(e.target.value)} />;
}

function Entries({ title, items, fields, make, onChange, rev }: { title: string; items: Obj[]; fields: FieldDef[]; make: () => Obj; onChange: (next: Obj[]) => void; rev: number }) {
  const { t } = useI18n();
  const set = (i: number, k: string, v: unknown) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card>
      <div className="stack">
        <h2>{title}</h2>
        {items.map((it, i) => (
          <fieldset key={`${rev}-${i}`} className="stack" style={{ border: 0, borderTop: i ? "1px solid var(--border)" : 0, paddingTop: i ? 12 : 0, margin: 0, minInlineSize: 0 }}>
            <legend className="um-sr-only">{`${title} ${i + 1}`}</legend>
            <div className="grid-auto">
              {fields.map((f) =>
                f.kind === "bool" ? (
                  <label key={f.key} className="row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={!!it[f.key]} onChange={(e) => set(i, f.key, e.target.checked)} />
                    {t(f.label)}
                  </label>
                ) : f.kind === "csv" || f.kind === "lines" ? (
                  <ListField key={`${rev}-${i}-${f.key}`} label={t(f.label)} value={it[f.key] ?? []} parse={f.kind === "csv" ? csv : lines} join={f.kind === "csv" ? ", " : "\n"} multiline={f.kind === "lines"} onChange={(v) => set(i, f.key, v)} />
                ) : f.multiline ? (
                  <Textarea key={f.key} label={t(f.label)} rows={3} value={String(it[f.key] ?? "")} onChange={(e) => set(i, f.key, e.target.value)} />
                ) : (
                  <Input key={f.key} label={t(f.label)} value={String(it[f.key] ?? "")} onChange={(e) => set(i, f.key, e.target.value)} />
                ),
              )}
            </div>
            <div className="row">
              <Button size="sm" variant="danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                {t("career.cv.removeEntry")}
              </Button>
            </div>
          </fieldset>
        ))}
        <div className="row">
          <Button size="sm" variant="secondary" disabled={items.length >= CV_SECTION_ITEMS_MAX} onClick={() => onChange([...items, make()])}>
            <Icon name="add" size="sm" />
            {t("career.cv.add")}
          </Button>
        </div>
      </div>
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
  const tracked = useAsync(() => myTracking(getBrowserClient()), []);
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
      <div className="stack">
        <h2 className="row" style={{ gap: 8 }}>
          <Icon name="ai-chat" /> {t("career.ai.cvTitle")}
        </h2>
        <p className="um-muted">{t("career.ai.cvBody")}</p>
        {listings.length ? (
          <Select label={t("career.ai.target")} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t("career.ai.targetNone")}</option>
            {listings.map((l) => (
              <option key={l.id} value={l.opportunityId!}>
                {`${l.title} · ${l.organization}`}
              </option>
            ))}
          </Select>
        ) : null}
        <Chips label={t("career.ai.language")} value={lang} onChange={setLang} options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))} />
        <div className="row">
          <Button loading={busy} onClick={() => void run()}>
            {busy ? t("career.ai.working") : t("career.ai.action")}
          </Button>
        </div>
        {error ? <EdgeNotice error={error} /> : null}
        {out ? (
          <div className="stack" role="status">
            {out.cached ? <p className="um-muted">{t("career.ai.cached")}</p> : null}
            <h3>{t("career.ai.overall")}</h3>
            <p>{out.feedback.overall}</p>
            <h3>{t("career.ai.strengths")}</h3>
            <ul>
              {out.feedback.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <h3>{t("career.ai.improvements")}</h3>
            <ul style={{ listStyle: "none", padding: 0 }} className="stack">
              {out.feedback.improvements.map((s, i) => (
                <li key={i} className="stack">
                  <Badge tone="info">{s.section === "general" ? t("career.ai.sectionGeneral") : t(`career.cv.section.${s.section}`)}</Badge>
                  <span>{s.suggestion}</span>
                </li>
              ))}
            </ul>
            {out.feedback.missingKeywords.length ? (
              <>
                <h3>{t("career.ai.keywords")}</h3>
                <div className="row">
                  {out.feedback.missingKeywords.map((k) => (
                    <Badge key={k} tone="warning">
                      {k}
                    </Badge>
                  ))}
                </div>
              </>
            ) : null}
            {out.feedback.rewrittenSummary ? (
              <>
                <h3>{t("career.ai.summary")}</h3>
                <p className="um-muted">{out.feedback.rewrittenSummary}</p>
              </>
            ) : null}
            <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
              {t("career.ai.disclaimer")}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function CvEditor({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const doc = useAsync(() => getCv(getBrowserClient(), id), [id]);
  const [draft, setDraft] = useState<CvDocumentInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rev, setRev] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (doc.data && !draft) setDraft({ title: doc.data.title, language: doc.data.language, template: doc.data.template, data: doc.data.data });
  }, [doc.data, draft]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const back = (
    <p>
      <Link href="/career">← {t("career.title")}</Link>
    </p>
  );
  if (doc.loading && !doc.data) {
    return (
      <div className="stack-lg">
        {back}
        <Skeleton height={220} />
      </div>
    );
  }
  if (doc.error) {
    return (
      <div className="stack-lg">
        {back}
        <ErrorState title={t("career.loadFailed")} description={doc.error} action={<Button onClick={doc.reload}>{t("common.retry")}</Button>} />
      </div>
    );
  }
  if (!doc.data || !draft) {
    return (
      <div className="stack-lg">
        {back}
        <EmptyState title={t("career.notFound")} />
      </div>
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
    const r = await saveCv(getBrowserClient(), id, draft);
    setSaving(false);
    if (r.ok) {
      setDirty(false);
      toast(t("career.cv.saved"), "success");
      return true;
    }
    toast(r.error === "too_large" ? t("career.cv.tooLarge") : r.error === "invalid" ? t("career.cv.invalid") : t("career.cv.saveFailed"), "error");
    return false;
  };
  const exportPdf = async () => {
    if (await save()) router.push(`/career/cv/${id}/print`);
  };
  const remove = async () => {
    setConfirmDelete(false);
    try {
      await deleteCv(getBrowserClient(), id);
      router.push("/career");
    } catch {
      toast(t("career.cv.saveFailed"), "error");
    }
  };

  return (
    <div className="stack-lg">
      {back}
      <div className="page-head">
        <h1>{draft.title}</h1>
      </div>
      <Card>
        <div className="row" style={{ gap: 20 }}>
          <ProgressRing value={score.score} label={t("career.cv.score")}>{`${score.score}%`}</ProgressRing>
          <div className="stack" style={{ flex: 1, minWidth: 220 }}>
            <h2>{t("career.cv.scoreValue", { n: score.score })}</h2>
            {score.missing.length ? <strong>{t("career.cv.improve")}</strong> : null}
            <ul>
              {score.missing.slice(0, 3).map((k) => (
                <li key={k} className="um-muted">
                  {t(`career.cv.tip.${k}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card>
        <div className="stack">
          <Input label={t("career.cv.title")} value={draft.title} maxLength={120} onChange={(e) => edit((d) => ({ ...d, title: e.target.value }))} />
          <Chips label={t("career.cv.language")} value={draft.language} onChange={(v) => edit((d) => ({ ...d, language: v }))} options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))} />
          <Chips label={t("career.cv.template")} value={draft.template} onChange={(v) => edit((d) => ({ ...d, template: v }))} options={CV_TEMPLATES.map((x) => ({ value: x, label: t(`career.cv.templates.${x}`) }))} />
        </div>
      </Card>

      <Card>
        <div className="stack">
          <h2>{t("career.cv.section.personal")}</h2>
          <div className="grid-auto">
            {(["fullName", "headline", "email", "phone", "city", "linkedin", "website"] as const).map((k) => (
              <Input key={k} label={t(`career.cv.field.${k}`)} value={cv.personal[k]} type={k === "email" ? "email" : k === "phone" ? "tel" : "text"} onChange={(e) => setPersonal(k, e.target.value)} />
            ))}
          </div>
        </div>
      </Card>
      <Card>
        <div className="stack">
          <h2>{t("career.cv.section.summary")}</h2>
          <Textarea label={t("career.cv.field.summary")} rows={4} maxLength={1500} value={cv.summary} onChange={(e) => setData("summary", e.target.value)} />
        </div>
      </Card>
      <Entries title={t("career.cv.section.education")} items={cv.education} fields={EDU} rev={rev} make={() => ({ institution: "", degree: "", field: "", start: "", end: "", gpa: "", description: "" })} onChange={sectionList("education")} />
      <Entries title={t("career.cv.section.experience")} items={cv.experience} fields={EXP} rev={rev} make={() => ({ company: "", role: "", location: "", start: "", end: "", current: false, bullets: [] })} onChange={sectionList("experience")} />
      <Card>
        <div className="stack">
          <h2>{t("career.cv.section.skills")}</h2>
          <ListField label={t("career.cv.field.skills")} value={cv.skills} parse={csv} join=", " onChange={(v) => setData("skills", v.slice(0, CV_SECTION_ITEMS_MAX).map((s) => s.slice(0, 50)))} />
        </div>
      </Card>
      <Entries title={t("career.cv.section.languages")} items={cv.languages} fields={LANG} rev={rev} make={() => ({ name: "", level: "" })} onChange={sectionList("languages")} />
      <Entries title={t("career.cv.section.projects")} items={cv.projects} fields={PROJ} rev={rev} make={() => ({ name: "", link: "", description: "", tech: [] })} onChange={sectionList("projects")} />
      <Entries title={t("career.cv.section.certificates")} items={cv.certificates} fields={CERT} rev={rev} make={() => ({ name: "", issuer: "", year: "", link: "" })} onChange={sectionList("certificates")} />

      <div className="row">
        <Button loading={saving} disabled={!dirty} onClick={() => void save()}>
          {t("career.cv.save")}
        </Button>
        {dirty ? <span className="um-muted">{t("career.cv.unsaved")}</span> : null}
        <Button variant="secondary" onClick={() => void exportPdf()}>
          <Icon name="download" size="sm" />
          {t("career.cv.export")}
        </Button>
      </div>
      <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
        {t("career.cv.exportHintWeb")}
      </p>

      <FeedbackPanel cvId={id} language={draft.language} ensureSaved={save} />

      <div className="row">
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>
          {t("career.cv.delete")}
        </Button>
      </div>
      <Dialog
        open={confirmDelete}
        title={t("career.cv.delete")}
        onClose={() => setConfirmDelete(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p>{t("career.cv.deleteConfirm")}</p>
      </Dialog>
    </div>
  );
}
