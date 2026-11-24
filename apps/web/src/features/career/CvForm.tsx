"use client";

import { CEFR_LEVELS, CV_SECTION_ITEMS_MAX, CV_SKILL_KINDS, type CvData, type CvDesignSection, type CvLanguage } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Icon, Input, Select, Textarea } from "@unimate/ui";
import { useState, type KeyboardEvent } from "react";
import { AiWrite, CvPhoto, toBullets } from "./cv-parts";
import { EMPLOYMENT_OPTIONS, ENTRY_SECTIONS, type AiDef, type EntrySection, type FieldDef, type Obj } from "./cv-sections-config";
import { dropSection, moveItem, moveSectionBy, toggleHidden } from "./cv-sections";

const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

/** Keeps its own text while typing so separators (commas, newlines) survive the parse/join round trip; remounted via `key` on undo/AI/import. */
function ListField({ label, value, parse, join, multiline, onChange }: { label: string; value: string[]; parse: (s: string) => string[]; join: string; multiline?: boolean; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(join));
  const update = (s: string) => {
    setText(s);
    onChange(parse(s));
  };
  return multiline ? <Textarea label={label} rows={3} value={text} onChange={(e) => update(e.target.value)} /> : <Input label={label} value={text} onChange={(e) => update(e.target.value)} />;
}

/** Up / down / remove for one entry; Alt+ArrowUp / Alt+ArrowDown on the entry moves it too. */
function EntryTools({ i, n, onMove, onRemove, label }: { i: number; n: number; onMove: (to: number) => void; onRemove: () => void; label: string }) {
  const { t } = useI18n();
  return (
    <div className="row" style={{ gap: 6 }}>
      <Button size="sm" variant="secondary" disabled={i === 0} aria-label={`${t("cvWeb.editor.moveUp")}: ${label}`} onClick={() => onMove(i - 1)}>
        <Icon name="arrow-up" size="sm" />
      </Button>
      <Button size="sm" variant="secondary" disabled={i === n - 1} aria-label={`${t("cvWeb.editor.moveDown")}: ${label}`} onClick={() => onMove(i + 1)}>
        <span style={{ display: "inline-block", transform: "rotate(180deg)" }}>
          <Icon name="arrow-up" size="sm" />
        </span>
      </Button>
      <Button size="sm" variant="danger" onClick={onRemove}>
        {t("career.cv.removeEntry")}
      </Button>
    </div>
  );
}

function EntryList({ title, def, items, rev, language, onChange }: { title: string; def: EntrySection; items: Obj[]; rev: number; language: CvLanguage; onChange: (next: Obj[], structural: boolean) => void }) {
  const { t } = useI18n();
  const [aiRev, setAiRev] = useState(0);
  const set = (i: number, k: string, v: unknown) => onChange(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)), false);
  const move = (from: number, to: number) => onChange(moveItem(items, from, to), true);
  const onKey = (i: number) => (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    move(i, i + (e.key === "ArrowUp" ? -1 : 1));
  };
  const aiFor = (ai: AiDef | undefined, f: FieldDef, it: Obj, i: number) =>
    ai && (f.multiline || f.kind === "lines") && f.key !== "achievements" ? (
      <AiWrite
        kind={ai.kind}
        language={language}
        context={ai.ctx(it)}
        current={f.kind === "lines" ? (it[f.key] ?? []).join("\n") : String(it[f.key] ?? "")}
        lines={f.kind === "lines"}
        onText={(text) => {
          set(i, f.key, f.kind === "lines" ? toBullets(text) : text);
          setAiRev((r) => r + 1);
        }}
      />
    ) : null;
  return (
    <div className="stack">
      {items.length === 0 ? <p className="um-muted">{t("cvWeb.editor.emptyEntries")}</p> : null}
      {items.map((it, i) => (
        <fieldset key={`${rev}-${i}`} onKeyDown={onKey(i)} className="stack" style={{ border: 0, borderTop: i ? "1px solid var(--border)" : 0, paddingTop: i ? 12 : 0, margin: 0, minInlineSize: 0 }}>
          <legend className="um-sr-only">{t("cvWeb.editor.entry", { title, n: i + 1 })}</legend>
          <div className="grid-auto">
            {def.fields
              .filter((f) => !f.hide?.(it))
              .map((f) => {
                const label = t(f.label);
                const field =
                  f.kind === "bool" ? (
                    <label className="row" style={{ gap: 8 }}>
                      <input type="checkbox" checked={!!it[f.key]} onChange={(e) => set(i, f.key, e.target.checked)} />
                      {label}
                    </label>
                  ) : f.kind === "cefr" ? (
                    <Select label={label} value={String(it[f.key] ?? "")} onChange={(e) => set(i, f.key, e.target.value)} style={{ width: "100%" }}>
                      <option value="" />
                      {CEFR_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  ) : f.kind === "emp" ? (
                    <Select label={label} value={String(it[f.key] ?? "")} onChange={(e) => set(i, f.key, e.target.value)} style={{ width: "100%" }}>
                      <option value="">{t("cvWeb.emp.none")}</option>
                      {EMPLOYMENT_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {t(`cvWeb.emp.${o}`)}
                        </option>
                      ))}
                    </Select>
                  ) : f.kind === "csv" || f.kind === "lines" ? (
                    <ListField key={`${rev}-${aiRev}-${i}-${f.key}`} label={label} value={it[f.key] ?? []} parse={f.kind === "csv" ? csv : lines} join={f.kind === "csv" ? ", " : "\n"} multiline={f.kind === "lines"} onChange={(v) => set(i, f.key, f.kind === "lines" ? v.map((x) => x.slice(0, 300)).slice(0, 8) : v)} />
                  ) : f.multiline ? (
                    <Textarea key={aiRev} label={label} rows={3} value={String(it[f.key] ?? "")} onChange={(e) => set(i, f.key, e.target.value)} />
                  ) : (
                    <Input label={label} value={String(it[f.key] ?? "")} onChange={(e) => set(i, f.key, e.target.value)} />
                  );
                return (
                  <div key={f.key} className="stack" style={{ minWidth: 0, gap: 6 }}>
                    {field}
                    {aiFor(def.ai, f, it, i)}
                  </div>
                );
              })}
          </div>
          <EntryTools i={i} n={items.length} label={t("cvWeb.editor.entry", { title, n: i + 1 })} onMove={(to) => move(i, to)} onRemove={() => onChange(items.filter((_, j) => j !== i), true)} />
        </fieldset>
      ))}
      <div className="row">
        <Button size="sm" variant="secondary" disabled={items.length >= CV_SECTION_ITEMS_MAX} onClick={() => onChange([...items, def.make()], false)}>
          <Icon name="add" size="sm" />
          {t("career.cv.add")}
        </Button>
      </div>
    </div>
  );
}

function SkillsEditor({ skills, rev, onChange }: { skills: CvData["skills"]; rev: number; onChange: (next: CvData["skills"], structural: boolean) => void }) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<CvData["skills"][number]> & { level?: number | undefined }) =>
    onChange(
      skills.map((s, j) => {
        if (j !== i) return s;
        const next: Record<string, unknown> = { ...s, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        return next as CvData["skills"][number];
      }),
      false,
    );
  return (
    <div className="stack">
      {skills.map((s, i) => (
        <fieldset key={`${rev}-${i}`} className="stack" style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
          <legend className="um-sr-only">{t("cvWeb.editor.entry", { title: t("career.cv.section.skills"), n: i + 1 })}</legend>
          <div className="grid-auto">
            <Input label={t("cvWeb.field.skillName")} value={s.name} maxLength={50} onChange={(e) => set(i, { name: e.target.value })} />
            <Select label={t("cvWeb.field.skillKind")} value={s.kind ?? ""} onChange={(e) => set(i, { kind: (e.target.value || undefined) as (typeof CV_SKILL_KINDS)[number] | undefined })} style={{ width: "100%" }}>
              <option value="">{t("cvWeb.skill.none")}</option>
              {CV_SKILL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`cvWeb.skill.${k}`)}
                </option>
              ))}
            </Select>
            <Select label={t("cvWeb.field.skillLevel")} value={s.level ? String(s.level) : ""} onChange={(e) => set(i, { level: e.target.value ? Number(e.target.value) : undefined })} style={{ width: "100%" }}>
              <option value="">{t("cvWeb.skill.none")}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <EntryTools
            i={i}
            n={skills.length}
            label={t("cvWeb.editor.entry", { title: t("career.cv.section.skills"), n: i + 1 })}
            onMove={(to) => onChange(moveItem(skills, i, to), true)}
            onRemove={() => onChange(skills.filter((_, j) => j !== i), true)}
          />
        </fieldset>
      ))}
      <div className="row">
        <Button size="sm" variant="secondary" disabled={skills.length >= CV_SECTION_ITEMS_MAX} onClick={() => onChange([...skills, { name: "" }], false)}>
          <Icon name="add" size="sm" />
          {t("career.cv.add")}
        </Button>
      </div>
    </div>
  );
}

export interface CvFormProps {
  cv: CvData;
  language: CvLanguage;
  uid: string;
  rev: number;
  order: CvDesignSection[];
  hidden: CvDesignSection[];
  exportBlocked: boolean;
  /** structural = remove/move/AI/import: inputs holding local text are remounted. */
  update: (fn: (cv: CvData) => CvData, structural?: boolean) => void;
  setOrder: (order: CvDesignSection[]) => void;
  setHidden: (hidden: CvDesignSection[]) => void;
  onPhotoUploaded: (path: string) => void;
}

const sectionCount = (cv: CvData, k: CvDesignSection): number => (k === "summary" ? (cv.summary.trim() ? 1 : 0) : (cv[k] as unknown[]).length);

export function CvForm({ cv, language, uid, rev, order, hidden, exportBlocked, update, setOrder, setHidden, onPhotoUploaded }: CvFormProps) {
  const { t } = useI18n();
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [drag, setDrag] = useState<CvDesignSection | null>(null);
  const [over, setOver] = useState<CvDesignSection | null>(null);
  const isOpen = (k: string) => !closed.has(k);
  const flip = (k: string) => setClosed((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set(s).add(k)));
  const setPersonal = (k: keyof CvData["personal"], v: string) => update((c) => ({ ...c, personal: { ...c.personal, [k]: v } }));
  const setSocials = (v: CvData["personal"]["socials"]) => update((c) => ({ ...c, personal: { ...c.personal, socials: v } }), true);
  const setSection = (k: CvDesignSection) => (next: Obj[], structural: boolean) => update((c) => ({ ...c, [k]: next }) as CvData, structural);
  const personalKeys = ["fullName", "headline", "email", "phone", "city", "address", "linkedin", "github", "portfolio", "website", "idNumber", "birthDate", "nationality", "gender"] as const;
  const labelOf = (k: (typeof personalKeys)[number]): MessageKey => (k === "github" || k === "portfolio" ? (`cvWeb.field.${k}` as MessageKey) : (`career.cv.field.${k}` as MessageKey));

  const body = (k: CvDesignSection) => {
    if (k === "summary")
      return (
        <div className="stack">
          <Textarea key={rev} label={t("career.cv.field.summary")} rows={4} maxLength={1500} value={cv.summary} onChange={(e) => update((c) => ({ ...c, summary: e.target.value }))} />
          <AiWrite key={`ai-${rev}`} kind="summary" language={language} context={{ title: cv.personal.headline, skills: cv.skills.map((s) => s.name).join(", ") }} current={cv.summary} onText={(text) => update((c) => ({ ...c, summary: text }), true)} />
        </div>
      );
    if (k === "skills") return <SkillsEditor skills={cv.skills} rev={rev} onChange={(next, st) => update((c) => ({ ...c, skills: next }), st)} />;
    const def = ENTRY_SECTIONS.find((s) => s.key === k)!;
    return <EntryList title={t(`career.cv.section.${k}`)} def={def} items={cv[def.key] as Obj[]} rev={rev} language={language} onChange={setSection(k)} />;
  };

  return (
    <div className="stack">
      <Card>
        <div className="stack">
          <h2>{t("career.cv.section.personal")}</h2>
          <div className="grid-auto">
            {personalKeys.map((k) => {
              const req = k === "fullName" || k === "email" || k === "phone";
              return (
                <Input
                  key={`${rev}-${k}`}
                  label={req ? `${t(labelOf(k))} *` : t(labelOf(k))}
                  value={cv.personal[k]}
                  type={k === "email" ? "email" : k === "phone" ? "tel" : "text"}
                  required={req}
                  hint={req && exportBlocked && !cv.personal[k].trim() ? t("career.cv.required") : undefined}
                  onChange={(e) => setPersonal(k, e.target.value)}
                />
              );
            })}
          </div>
          <CvPhoto
            uid={uid}
            url={cv.personal.photoUrl}
            path={cv.personal.photoPath}
            onChange={(p) => {
              if (p.photoPath) onPhotoUploaded(p.photoPath);
              update((c) => ({ ...c, personal: { ...c.personal, ...p } }), true);
            }}
          />
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}>
            <legend>{t("career.cv.field.socials")}</legend>
            {cv.personal.socials.map((so, i) => (
              <div key={`${rev}-${i}`} className="stack" style={{ gap: 8 }}>
                <div className="grid-auto">
                  <Input label={t("career.cv.field.platform")} list="cv-social-platforms" value={so.platform} onChange={(e) => update((c) => ({ ...c, personal: { ...c.personal, socials: c.personal.socials.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)) } }))} />
                  <Input label={t("career.cv.field.socialValue")} value={so.value} onChange={(e) => update((c) => ({ ...c, personal: { ...c.personal, socials: c.personal.socials.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) } }))} />
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

      {order.map((k) => {
        const open = isOpen(k);
        const isHidden = hidden.includes(k);
        const name = t(`career.cv.section.${k}`);
        const n = sectionCount(cv, k);
        return (
          <div
            key={k}
            onDragOver={(e) => {
              if (drag) {
                e.preventDefault();
                setOver(k);
              }
            }}
            onDragLeave={() => setOver((o) => (o === k ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              if (drag && drag !== k) setOrder(dropSection(order, drag, k));
              setDrag(null);
              setOver(null);
            }}
            style={{ opacity: drag === k ? 0.5 : 1, outline: over === k && drag !== k ? "2px dashed var(--primary)" : "none", borderRadius: "var(--radius-lg)" }}
          >
            <Card>
              <div className="stack">
                <div className="row row--between" style={{ flexWrap: "wrap" }}>
                  <div className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span
                      draggable
                      role="img"
                      aria-label={t("cvWeb.editor.moveSection")}
                      title={t("cvWeb.editor.moveSection")}
                      onDragStart={(e) => {
                        setDrag(k);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", k);
                      }}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                      style={{ cursor: "grab", padding: "6px 4px", userSelect: "none", color: "var(--text-muted)" }}
                    >
                      ⋮⋮
                    </span>
                    <h2 style={{ overflowWrap: "anywhere" }}>{name}</h2>
                    {n ? <Badge>{n}</Badge> : null}
                    {isHidden ? <Badge tone="warning">{t("cvWeb.editor.hiddenBadge")}</Badge> : null}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" variant="secondary" disabled={order[0] === k} aria-label={`${t("cvWeb.editor.moveUp")}: ${name}`} onClick={() => setOrder(moveSectionBy(order, k, -1))}>
                      <Icon name="arrow-up" size="sm" />
                    </Button>
                    <Button size="sm" variant="secondary" disabled={order[order.length - 1] === k} aria-label={`${t("cvWeb.editor.moveDown")}: ${name}`} onClick={() => setOrder(moveSectionBy(order, k, 1))}>
                      <span style={{ display: "inline-block", transform: "rotate(180deg)" }}>
                        <Icon name="arrow-up" size="sm" />
                      </span>
                    </Button>
                    <Button size="sm" variant="secondary" aria-pressed={isHidden} onClick={() => setHidden(toggleHidden(hidden, k))}>
                      <Icon name={isHidden ? "eye-off" : "eye"} size="sm" />
                      {isHidden ? t("cvWeb.editor.show") : t("cvWeb.editor.hide")}
                    </Button>
                    <Button size="sm" variant="ghost" aria-expanded={open} aria-label={`${open ? t("cvWeb.editor.collapse") : t("cvWeb.editor.expand")}: ${name}`} onClick={() => flip(k)}>
                      {open ? t("cvWeb.editor.collapse") : t("cvWeb.editor.expand")}
                    </Button>
                  </div>
                </div>
                {open ? body(k) : null}
              </div>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
