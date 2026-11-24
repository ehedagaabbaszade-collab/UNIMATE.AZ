"use client";

import {
  CEFR_LEVELS,
  CV_LANGUAGES,
  CV_SECTION_ITEMS_MAX,
  cvCompleteness,
  cvMissingRequired,
  type CvDescribeKind,
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
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/user";
import { EdgeNotice } from "@/components/EdgeNotice";
import type { EdgeError } from "@/lib/edge";
import { cvFeedback } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { deleteCv, getCv, myTracking, saveCv } from "./api";
import { AiWrite, CvPhoto } from "./cv-parts";
import { Chips } from "./parts";
import { TemplatePicker } from "./TemplatePicker";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CV JSON is schema-less in the editor
type Obj = Record<string, any>;
type Kind = "text" | "csv" | "lines" | "bool" | "cefr";
interface FieldDef {
  key: string;
  label: MessageKey;
  kind?: Kind;
  multiline?: boolean;
  /** Hidden for entries where this returns true (CEFR levels of a native language). */
  hide?: (it: Obj) => boolean;
}
/** Which entries get a "write with AI" button on their description field, and the non-PII context sent with it. */
interface AiDef {
  kind: CvDescribeKind;
  ctx: (it: Obj) => Record<string, string>;
}
const pick = (it: Obj, keys: string[]) => Object.fromEntries(keys.map((k) => [k, String(it[k] ?? "")]));
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

function Entries({ title, items, fields, make, onChange, rev, ai, language }: { title: string; items: Obj[]; fields: FieldDef[]; make: () => Obj; onChange: (next: Obj[]) => void; rev: number; ai?: AiDef; language: CvLanguage }) {
  const { t } = useI18n();
  const [aiRev, setAiRev] = useState(0);
  const set = (i: number, k: string, v: unknown) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <Card>
      <div className="stack">
        <h2>{title}</h2>
        {items.map((it, i) => (
          <fieldset key={`${rev}-${i}`} className="stack" style={{ border: 0, borderTop: i ? "1px solid var(--border)" : 0, paddingTop: i ? 12 : 0, margin: 0, minInlineSize: 0 }}>
            <legend className="um-sr-only">{`${title} ${i + 1}`}</legend>
            <div className="grid-auto">
              {fields.filter((f) => !f.hide?.(it)).map((f) => {
                const write =
                  ai && (f.multiline || f.kind === "lines") ? (
                    <AiWrite
                      kind={ai.kind}
                      language={language}
                      context={ai.ctx(it)}
                      current={f.kind === "lines" ? (it[f.key] ?? []).join("\n") : String(it[f.key] ?? "")}
                      onText={(text) => {
                        set(i, f.key, f.kind === "lines" ? lines(text) : text);
                        setAiRev((r) => r + 1);
                      }}
                    />
                  ) : null;
                const field =
                  f.kind === "bool" ? (
                    <label className="row" style={{ gap: 8 }}>
                      <input type="checkbox" checked={!!it[f.key]} onChange={(e) => set(i, f.key, e.target.checked)} />
                      {t(f.label)}
                    </label>
                  ) : f.kind === "cefr" ? (
                    <Select label={t(f.label)} value={String(it[f.key] ?? "")} onChange={(e) => set(i, f.key, e.target.value)} style={{ width: "100%" }}>
                      <option value="" />
                      {CEFR_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  ) : f.kind === "csv" || f.kind === "lines" ? (
                    <ListField key={`${rev}-${aiRev}-${i}-${f.key}`} label={t(f.label)} value={it[f.key] ?? []} parse={f.kind === "csv" ? csv : lines} join={f.kind === "csv" ? ", " : "\n"} multiline={f.kind === "lines"} onChange={(v) => set(i, f.key, v)} />
                  ) : f.multiline ? (
                    <Textarea key={`${aiRev}`} label={t(f.label)} rows={3} value={String(it[f.key] ?? "")} onChange={(e) => set(i, f.key, e.target.value)} />
                  ) : (
                    <Input label={t(f.label)} value={String(it[f.key] ?? "")} onChange={(e) => set(i, f.key, e.target.value)} />
                  );
                return (
                  <div key={f.key} className="stack" style={{ minWidth: 0, gap: 6 }}>
                    {field}
                    {write}
                  </div>
                );
              })}
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
  { key: "city", label: "career.cv.field.city" },
  { key: "website", label: "career.cv.field.website" },
  { key: "eqfLevel", label: "career.cv.field.eqfLevel" },
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
  { key: "native", label: "career.cv.field.native", kind: "bool" },
  ...(["listening", "reading", "spokenProduction", "spokenInteraction", "writing"] as const).map((k) => ({ key: k, label: `career.cv.field.${k}` as MessageKey, kind: "cefr" as const, hide: (it: Obj) => !!it.native })),
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
const AI_EDU: AiDef = { kind: "education", ctx: (it) => pick(it, ["institution", "degree", "field"]) };
const AI_EXP: AiDef = { kind: "experience", ctx: (it) => ({ ...pick(it, ["role", "company", "location"]), dates: `${it.start ?? ""} - ${it.current ? "" : (it.end ?? "")}` }) };
const AI_PROJ: AiDef = { kind: "project", ctx: (it) => ({ name: String(it.name ?? ""), tech: (it.tech ?? []).join(", ") }) };
const AI_CERT: AiDef = { kind: "certificate", ctx: (it) => pick(it, ["name", "issuer", "date", "mode"]) };
const AI_HONOUR: AiDef = { kind: "honour", ctx: (it) => pick(it, ["title", "issuer", "date"]) };
const AI_HOBBY: AiDef = { kind: "hobby", ctx: (it) => pick(it, ["title"]) };
const AI_ACT: AiDef = { kind: "activity", ctx: (it) => pick(it, ["title", "place", "date"]) };

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
  const user = useUser();
  const { toast } = useToast();
  const [exportBlocked, setExportBlocked] = useState(false);
  const [summaryRev, setSummaryRev] = useState(0);
  const doc = useAsync(() => getCv(getBrowserClient(), id), [id]);
  const [draft, setDraft] = useState<CvDocumentInput | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rev, setRev] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // cv-photos objects: replaced/removed ones are deleted only after a successful save; never-saved uploads are deleted on leave.
  const savedPhoto = useRef("");
  const uploadedPhotos = useRef(new Set<string>());
  const sbRef = useRef(getBrowserClient());
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
  const setPersonal = (k: Exclude<keyof CvData["personal"], "socials">, v: string) => setData("personal", { ...cv.personal, [k]: v });
  const setSocials = (v: CvData["personal"]["socials"]) => setData("personal", { ...cv.personal, socials: v });
  const sectionList = <K extends "education" | "experience" | "languages" | "projects" | "certificates" | "hobbies" | "honours" | "activities">(k: K) => (next: Obj[]) => {
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
  const missing = cvMissingRequired(cv);
  const exportPdf = async () => {
    setExportBlocked(missing.length > 0);
    if (missing.length) return;
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
              {score.missing.filter((k): k is Exclude<typeof k, "hobbies" | "honours" | "activities"> => k !== "hobbies" && k !== "honours" && k !== "activities").slice(0, 3).map((k) => (
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
          <TemplatePicker value={draft.template} onChange={(v) => edit((d) => ({ ...d, template: v }))} />
        </div>
      </Card>

      <Card>
        <div className="stack">
          <h2>{t("career.cv.section.personal")}</h2>
          <div className="grid-auto">
            {(["fullName", "headline", "email", "phone", "city", "address", "idNumber", "birthDate", "nationality", "gender", "linkedin", "website"] as const).map((k) => {
              const req = (["fullName", "email", "phone"] as string[]).includes(k);
              return (
                <Input
                  key={k}
                  label={req ? `${t(`career.cv.field.${k}`)} *` : t(`career.cv.field.${k}`)}
                  value={cv.personal[k]}
                  type={k === "email" ? "email" : k === "phone" ? "tel" : "text"}
                  required={req}
                  hint={req && exportBlocked && !cv.personal[k].trim() ? t("career.cv.required") : undefined}
                  onChange={(e) => setPersonal(k, e.target.value)}
                />
              );
            })}
          </div>
          <CvPhoto uid={user.id} url={cv.personal.photoUrl} path={cv.personal.photoPath} onChange={(p) => {
            if (p.photoPath) uploadedPhotos.current.add(p.photoPath);
            setData("personal", { ...cv.personal, ...p });
          }} />
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}>
            <legend>{t("career.cv.field.socials")}</legend>
            {cv.personal.socials.map((so, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 8 }}>
                <div className="grid-auto">
                  <Input label={t("career.cv.field.platform")} list="cv-social-platforms" value={so.platform} onChange={(e) => setSocials(cv.personal.socials.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)))} />
                  <Input label={t("career.cv.field.socialValue")} value={so.value} onChange={(e) => setSocials(cv.personal.socials.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                </div>
                <div className="row">
                  <Button size="sm" variant="danger" onClick={() => setSocials(cv.personal.socials.filter((_, j) => j !== i))}>
                    {t("career.cv.removeEntry")}
                  </Button>
                </div>
              </div>
            ))}
            <datalist id="cv-social-platforms">
              {["LinkedIn", "Instagram", "WhatsApp", "Facebook", "GitHub", "Telegram"].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <div className="row">
              <Button size="sm" variant="secondary" disabled={cv.personal.socials.length >= 10} onClick={() => setSocials([...cv.personal.socials, { platform: "", value: "" }])}>
                <Icon name="add" size="sm" />
                {t("career.cv.add")}
              </Button>
            </div>
          </fieldset>
        </div>
      </Card>
      <Card>
        <div className="stack">
          <h2>{t("career.cv.section.summary")}</h2>
          <Textarea key={summaryRev} label={t("career.cv.field.summary")} rows={4} maxLength={1500} value={cv.summary} onChange={(e) => setData("summary", e.target.value)} />
          <AiWrite
            kind="summary"
            language={draft.language}
            context={{ title: cv.personal.headline, skills: cv.skills.map((s) => s.name).join(", ") }}
            current={cv.summary}
            onText={(text) => {
              setData("summary", text);
              setSummaryRev((r) => r + 1);
            }}
          />
        </div>
      </Card>
      <Entries title={t("career.cv.section.education")} items={cv.education} fields={EDU} rev={rev} ai={AI_EDU} language={draft.language} make={() => ({ institution: "", degree: "", field: "", start: "", end: "", gpa: "", description: "", city: "", website: "", eqfLevel: "" })} onChange={sectionList("education")} />
      <Entries title={t("career.cv.section.experience")} items={cv.experience} fields={EXP} rev={rev} ai={AI_EXP} language={draft.language} make={() => ({ company: "", role: "", location: "", start: "", end: "", current: false, bullets: [] })} onChange={sectionList("experience")} />
      <Card>
        <div className="stack">
          <h2>{t("career.cv.section.skills")}</h2>
          <ListField label={t("career.cv.field.skills")} value={cv.skills.map((s) => s.name)} parse={csv} join=", " onChange={(v) => setData("skills", v.slice(0, CV_SECTION_ITEMS_MAX).map((s) => s.slice(0, 50)).map((name) => ({ ...cv.skills.find((x) => x.name === name), name })))} />
        </div>
      </Card>
      <Entries title={t("career.cv.section.languages")} items={cv.languages} fields={LANG} rev={rev} language={draft.language} make={() => ({ name: "", level: "", native: false, listening: "", reading: "", spokenProduction: "", spokenInteraction: "", writing: "" })} onChange={sectionList("languages")} />
      <Entries title={t("career.cv.section.projects")} items={cv.projects} fields={PROJ} rev={rev} ai={AI_PROJ} language={draft.language} make={() => ({ name: "", link: "", description: "", tech: [] })} onChange={sectionList("projects")} />
      <Entries title={t("career.cv.section.certificates")} items={cv.certificates} fields={CERT} rev={rev} ai={AI_CERT} language={draft.language} make={() => ({ name: "", issuer: "", year: "", link: "", date: "", mode: "", description: "" })} onChange={sectionList("certificates")} />
      <Entries title={t("career.cv.section.hobbies")} items={cv.hobbies} fields={HOBBY} rev={rev} ai={AI_HOBBY} language={draft.language} make={() => ({ title: "", description: "" })} onChange={sectionList("hobbies")} />
      <Entries title={t("career.cv.section.honours")} items={cv.honours} fields={HONOUR} rev={rev} ai={AI_HONOUR} language={draft.language} make={() => ({ title: "", issuer: "", date: "", description: "" })} onChange={sectionList("honours")} />
      <Entries title={t("career.cv.section.activities")} items={cv.activities} fields={ACTIVITY} rev={rev} ai={AI_ACT} language={draft.language} make={() => ({ title: "", place: "", date: "", description: "" })} onChange={sectionList("activities")} />

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
      {exportBlocked && missing.length ? (
        <p className="err-box" role="alert">
          {`${missing.map((k) => t(`career.cv.field.${k}`)).join(", ")}: ${t("career.cv.required")}`}
        </p>
      ) : null}
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
