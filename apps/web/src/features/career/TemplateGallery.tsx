"use client";

import { CV_TEMPLATE_CATALOG, CV_TEMPLATE_CATEGORIES, type CvLanguage, type CvTemplate, type CvTemplateCategory, type CvTemplateMeta } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Dialog, Icon } from "@unimate/ui";
import { useEffect, useState } from "react";
import { CvPreview } from "./cv-preview";
import { SAMPLE_CV } from "./cv-sample";
import { Chips } from "./parts";

const PAGES_KEY = { "1": "cvWeb.gallery.pages1", "1-2": "cvWeb.gallery.pages12", "2+": "cvWeb.gallery.pages2" } as const;

function useNarrow(): boolean {
  const [n, setN] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 640px)");
    const on = () => setN(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return n;
}

/** Template gallery: category tabs, real PNG cards, full-screen live preview with sample data, and side-by-side compare. */
export function TemplateGallery({ value, language, busy, onPick }: { value?: string | undefined; language: CvLanguage; busy?: boolean; onPick: (id: CvTemplate) => void }) {
  const { t } = useI18n();
  const MAX_COMPARE = useNarrow() ? 2 : 3; // two A4 previews side by side do not fit a phone
  const [cat, setCat] = useState<CvTemplateCategory | "all">("all");
  const [big, setBig] = useState<CvTemplateMeta | null>(null);
  const [picked, setPicked] = useState<CvTemplate[]>([]);
  const [comparing, setComparing] = useState(false);
  const list = CV_TEMPLATE_CATALOG.filter((m) => cat === "all" || m.categories.includes(cat));
  const toggle = (id: CvTemplate) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_COMPARE ? p : [...p, id]));
  const shown = picked.slice(0, MAX_COMPARE);
  const compared = shown.map((id) => CV_TEMPLATE_CATALOG.find((m) => m.id === id)!).filter(Boolean);
  const use = (id: CvTemplate) => {
    setBig(null);
    setComparing(false);
    onPick(id);
  };
  return (
    <div className="stack cv-touch">
      <Chips
        className="cv-scroll"
        label={t("cvWeb.gallery.categories")}
        value={cat}
        onChange={setCat}
        options={[{ value: "all" as const, label: t("cvWeb.gallery.all") }, ...CV_TEMPLATE_CATEGORIES.map((c) => ({ value: c, label: t(`career.cv.templateCategory.${c}`) }))]}
      />
      <div className="row row--between">
        <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
          {t("cvWeb.gallery.compareHint", { n: MAX_COMPARE })}
        </p>
        <Button size="sm" variant="secondary" disabled={shown.length < 2} onClick={() => setComparing(true)}>
          {t("cvWeb.gallery.compareOpen", { n: shown.length })}
        </Button>
      </div>
      <div className="cv-gal">
        {list.map((m) => {
          const name = t(m.nameKey);
          const on = m.id === value;
          return (
            <div key={m.id} className="stack" style={{ gap: 8, minWidth: 0, padding: 8, border: `2px solid ${on ? "var(--primary)" : "var(--border)"}`, borderRadius: "var(--radius-md)", background: "var(--surface)" }}>
              <button type="button" onClick={() => setBig(m)} aria-label={`${t("cvWeb.gallery.preview")}: ${name}`} style={{ padding: 0, border: 0, background: "none", cursor: "pointer" }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- static template thumbnail */}
                <img src={`/cv-templates/${m.id}.png`} alt={name} loading="lazy" style={{ width: "100%", aspectRatio: "400 / 566", objectFit: "cover", borderRadius: "var(--radius-sm)", display: "block", border: "1px solid var(--border)" }} />
              </button>
              <strong style={{ overflowWrap: "anywhere" }}>
                {on ? <Icon name="check" size="sm" /> : null} {name}
              </strong>
              <span className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
                {t(m.descriptionKey)}
              </span>
              <div className="row" style={{ gap: 4 }}>
                {m.atsFriendly ? <Badge tone="success">{t("career.cv.atsFriendly")}</Badge> : null}
                <Badge>{m.supportsPhoto ? t("cvWeb.gallery.photo") : t("cvWeb.gallery.noPhoto")}</Badge>
                <Badge>{m.columns === 2 ? t("cvWeb.gallery.columns2") : t("cvWeb.gallery.columns1")}</Badge>
                <Badge>{t(PAGES_KEY[m.pages])}</Badge>
              </div>
              <label className="row" style={{ gap: 8, fontSize: "var(--text-sm)", minHeight: 44 }}>
                <input type="checkbox" checked={picked.includes(m.id)} disabled={!picked.includes(m.id) && picked.length >= MAX_COMPARE} onChange={() => toggle(m.id)} aria-label={t("cvWeb.gallery.pickTick", { name })} />
                {t("cvWeb.gallery.compare")}
              </label>
              <div className="row">
                <Button size="sm" variant="secondary" onClick={() => setBig(m)}>
                  {t("cvWeb.gallery.preview")}
                </Button>
                <Button size="sm" loading={busy && on} disabled={busy} onClick={() => use(m.id)}>
                  {t("cvWeb.gallery.use")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {picked.length >= MAX_COMPARE ? <p className="um-muted">{t("cvWeb.gallery.compareMax", { n: MAX_COMPARE })}</p> : null}

      <Dialog
        open={big !== null}
        title={big ? t(big.nameKey) : ""}
        onClose={() => setBig(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setBig(null)}>
              {t("cvWeb.gallery.close")}
            </Button>
            {big ? <Button onClick={() => use(big.id)}>{t("cvWeb.gallery.use")}</Button> : null}
          </>
        }
      >
        {big ? (
          <div className="cv-wide stack cv-touch">
            <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
              {big.atsFriendly ? `${t("career.cv.atsFriendly")}. ${t("cvWeb.gallery.atsNote")} ` : ""}
              {t("cvWeb.gallery.sampleNote")}
            </p>
            <CvPreview cv={SAMPLE_CV} template={big.id} design={{}} language={language} zoom="fit" maxWidth={794} />
          </div>
        ) : null}
      </Dialog>
      <Dialog
        open={comparing}
        title={t("cvWeb.gallery.compare")}
        onClose={() => setComparing(false)}
        actions={
          <Button variant="secondary" onClick={() => setComparing(false)}>
            {t("cvWeb.gallery.close")}
          </Button>
        }
      >
        {comparing ? (
          <div className="cv-wide cv-cmp cv-touch">
            {compared.map((m) => (
              <div key={m.id} className="stack" style={{ minWidth: 0 }}>
                <div className="row row--between">
                  <strong>{t(m.nameKey)}</strong>
                  <Button size="sm" onClick={() => use(m.id)}>
                    {t("cvWeb.gallery.use")}
                  </Button>
                </div>
                <CvPreview cv={SAMPLE_CV} template={m.id} design={{}} language={language} zoom="fit" />
              </div>
            ))}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
