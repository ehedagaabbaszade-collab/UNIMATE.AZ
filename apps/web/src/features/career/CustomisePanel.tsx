"use client";

import { CV_COLUMNS, CV_FONTS, CV_FONT_SIZES, CV_HEADING_SCALE, CV_MARGINS, CV_MODES, CV_PHOTO_SHAPES, CV_SPACINGS, type CvDesign, type CvResolvedDesign } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Button, Input, Select } from "@unimate/ui";
import { useEffect, useState } from "react";
import { BACKGROUND_PRESETS, CV_COLOR_PRESETS, normalizeHex } from "./cv-colors";
import { Chips } from "./parts";

type ColorKey = "primary" | "accent" | "background";

function ColorPicker({ label, value, presets, onChange }: { label: string; value: string; presets: readonly string[]; onChange: (hex: string) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value);
    setBad(false);
  }, [value]);
  const apply = (v: string) => {
    setText(v);
    const hex = normalizeHex(v);
    setBad(v.trim() !== "" && !hex);
    if (hex) onChange(hex);
  };
  return (
    <div className="stack" style={{ gap: 6 }} role="group" aria-label={label}>
      <strong style={{ fontSize: "var(--text-sm)" }}>{label}</strong>
      <div className="row" style={{ gap: 6 }}>
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={t("cvWeb.customise.preset", { name: c })}
            aria-pressed={c.toLowerCase() === value.toLowerCase()}
            onClick={() => apply(c)}
            className="cv-swatch"
            style={{ background: c, border: c.toLowerCase() === value.toLowerCase() ? "3px solid var(--primary)" : "1px solid var(--border-strong)" }}
          />
        ))}
      </div>
      <Input label={t("cvWeb.customise.hex")} value={text} maxLength={7} error={bad ? t("cvWeb.customise.hexInvalid") : undefined} onChange={(e) => apply(e.target.value)} />
    </div>
  );
}

/** Design controls. `resolved` = template defaults + the user's choices; every change calls onChange with one key (the editor stores it in design). */
export function CustomisePanel({ resolved, onChange, onReset }: { resolved: CvResolvedDesign; onChange: (patch: CvDesign) => void; onReset: () => void }) {
  const { t } = useI18n();
  const opt = <T extends string>(values: readonly T[]) => values.map((v) => ({ value: v, label: t(`cvWeb.customise.${v}` as MessageKey) }));
  const colors: Array<[ColorKey, MessageKey, readonly string[]]> = [
    ["primary", "cvWeb.customise.primary", CV_COLOR_PRESETS],
    ["accent", "cvWeb.customise.accent", CV_COLOR_PRESETS],
    ["background", "cvWeb.customise.background", BACKGROUND_PRESETS],
  ];
  return (
    <div className="stack">
      <Select label={t("cvWeb.customise.font")} value={resolved.font} onChange={(e) => onChange({ font: e.target.value as CvResolvedDesign["font"] })} style={{ width: "100%" }}>
        {CV_FONTS.map((f) => (
          <option key={f} value={f}>
            {t(`cvWeb.customise.${f}`)}
          </option>
        ))}
      </Select>
      <Chips label={t("cvWeb.customise.fontSize")} value={resolved.fontSize} onChange={(v) => onChange({ fontSize: v })} options={opt(CV_FONT_SIZES)} />
      <label className="stack" style={{ gap: 4 }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>{`${t("cvWeb.customise.headingScale")}: ${Math.round(resolved.headingScale * 100)}%`}</span>
        <input type="range" min={CV_HEADING_SCALE.min} max={CV_HEADING_SCALE.max} step={0.05} value={resolved.headingScale} onChange={(e) => onChange({ headingScale: Math.round(Number(e.target.value) * 100) / 100 })} />
      </label>
      {colors.map(([k, label, presets]) => (
        <ColorPicker key={k} label={t(label)} value={resolved[k]} presets={presets} onChange={(hex) => onChange({ [k]: hex })} />
      ))}
      <Chips label={t("cvWeb.customise.spacing")} value={resolved.spacing} onChange={(v) => onChange({ spacing: v })} options={opt(CV_SPACINGS)} />
      <Chips label={t("cvWeb.customise.margins")} value={resolved.margins} onChange={(v) => onChange({ margins: v })} options={opt(CV_MARGINS)} />
      <Chips label={t("cvWeb.customise.columns")} value={resolved.columns} onChange={(v) => onChange({ columns: v })} options={CV_COLUMNS.map((c) => ({ value: c, label: t(`cvWeb.customise.${c}`) }))} />
      <span className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
        {t("cvWeb.customise.twoNote")}
      </span>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={resolved.showPhoto} onChange={(e) => onChange({ showPhoto: e.target.checked })} />
        {t("cvWeb.customise.showPhoto")}
      </label>
      <Chips label={t("cvWeb.customise.photoShape")} value={resolved.photoShape} onChange={(v) => onChange({ photoShape: v })} options={opt(CV_PHOTO_SHAPES)} />
      <Chips label={t("cvWeb.customise.mode")} value={resolved.mode} onChange={(v) => onChange({ mode: v })} options={opt(CV_MODES)} />
      <div className="row">
        <Button size="sm" variant="secondary" onClick={onReset}>
          {t("cvWeb.customise.reset")}
        </Button>
      </div>
    </div>
  );
}
