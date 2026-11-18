"use client";

import { CV_TEMPLATES } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Dialog, Icon } from "@unimate/ui";
import { useState } from "react";

type Template = (typeof CV_TEMPLATES)[number];

export function TemplatePicker({ value, onChange }: { value: string; onChange: (v: Template) => void }) {
  const { t } = useI18n();
  const [big, setBig] = useState<Template | null>(null);
  return (
    <div className="stack">
      <p className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
        {t("career.cv.previewNote")}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 120px), 1fr))", gap: 12 }}>
        {CV_TEMPLATES.map((id) => {
          const on = id === value;
          const name = t(`career.cv.templates.${id}`);
          return (
            <div key={id} style={{ display: "grid", gap: 6, minWidth: 0 }}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onChange(id)}
                style={{
                  position: "relative",
                  display: "grid",
                  gap: 6,
                  padding: 6,
                  textAlign: "start",
                  cursor: "pointer",
                  background: "var(--surface, transparent)",
                  color: "inherit",
                  border: `2px solid ${on ? "var(--primary)" : "var(--border)"}`,
                  borderRadius: "var(--radius-md)",
                  minWidth: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/cv-templates/${id}.png`} alt={name} loading="lazy" style={{ width: "100%", aspectRatio: "400 / 566", objectFit: "cover", borderRadius: "var(--radius-sm)", display: "block" }} />
                <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--text-sm)", fontWeight: on ? 600 : 400, overflowWrap: "anywhere" }}>
                  {on ? <Icon name="check" size="sm" /> : null}
                  {name}
                </span>
              </button>
              <Button variant="secondary" onClick={() => setBig(id)}>
                {t("career.cv.previewOpen")}
              </Button>
            </div>
          );
        })}
      </div>
      <Dialog open={big !== null} title={big ? t(`career.cv.templates.${big}`) : ""} onClose={() => setBig(null)} actions={<Button onClick={() => setBig(null)}>{t("common.close")}</Button>}>
        {big ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/cv-templates/${big}.png`} alt={t(`career.cv.templates.${big}`)} style={{ width: "100%", maxWidth: 400, height: "auto", display: "block", margin: "0 auto" }} />
        ) : null}
      </Dialog>
    </div>
  );
}
