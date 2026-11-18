"use client";

import { checkBirthDate, todayInBaku } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Button, Dialog, Input } from "@unimate/ui";
import { useState } from "react";
import { legal, type LegalSlug } from "@/content/legal";

export type ConsentType = "terms" | "privacy_notice" | "ai_disclaimer" | "marketing";
export type Checked = Partial<Record<ConsentType, boolean>>;

const META: Record<ConsentType, { key: MessageKey; slug?: LegalSlug }> = {
  terms: { key: "consent.terms", slug: "terms" },
  privacy_notice: { key: "consent.privacy", slug: "privacy" },
  ai_disclaimer: { key: "consent.ai", slug: "ai-disclaimer" },
  marketing: { key: "consent.marketing" },
};

/** Client-side pre-check against today in Baku; the server re-validates. */
export function birthIssue(birth: string): MessageKey | null {
  if (!birth) return "consent.errBirthRequired";
  const r = checkBirthDate(birth, todayInBaku());
  return r === "ok" ? null : r === "underage" ? "consent.errUnderage" : r === "future" ? "consent.errFuture" : "consent.errInvalid";
}

/** Birth date (when `birth` is given) + required consent checkboxes + the optional marketing one. */
export function ConsentFields({ birth, onBirth, birthError, types, checked, onCheck, marketing }: { birth?: string; onBirth?: (v: string) => void; birthError?: string | undefined; types: ConsentType[]; checked: Checked; onCheck: (t: ConsentType, v: boolean) => void; marketing?: boolean }) {
  const { t, locale } = useI18n();
  const [doc, setDoc] = useState<LegalSlug | null>(null);
  const row = (type: ConsentType) => {
    const { key, slug } = META[type];
    const m = /^(.*?)\[(.+?)\](.*)$/s.exec(t(key));
    return (
      <label key={type} style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
        <input type="checkbox" checked={!!checked[type]} onChange={(e) => onCheck(type, e.target.checked)} style={{ marginTop: 4, flex: "none" }} />
        <span>
          {m && slug ? (
            <>
              {m[1]}
              <button type="button" onClick={() => setDoc(slug)} style={{ all: "unset", cursor: "pointer", textDecoration: "underline", color: "var(--color-primary, inherit)" }}>
                {m[2]}
              </button>
              {m[3]}
            </>
          ) : (
            t(key)
          )}
        </span>
      </label>
    );
  };
  const d = doc ? legal[locale][doc] : null;
  return (
    <div className="stack">
      {birth !== undefined && onBirth ? <Input name="birthDate" type="date" label={t("consent.birthDate")} value={birth} max={todayInBaku()} min="1900-01-01" autoComplete="bday" onChange={(e) => onBirth(e.target.value)} error={birthError} /> : null}
      {types.map(row)}
      {marketing ? (
        <div className="stack" style={{ borderTop: "1px solid var(--color-border, #8884)", paddingTop: "var(--space-3)" }}>
          <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>{t("consent.optionalLabel")}</p>
          {row("marketing")}
        </div>
      ) : null}
      <Dialog open={!!d} onClose={() => setDoc(null)} title={d?.title ?? ""} actions={<Button onClick={() => setDoc(null)}>{t("common.close")}</Button>}>
        <div className="prose" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {d?.sections.map((s) => (
            <section key={s.h}>
              <h3>{s.h}</h3>
              {s.p?.map((p, i) => <p key={i}>{p}</p>)}
              {s.ul ? <ul>{s.ul.map((li, i) => <li key={i}>{li}</li>)}</ul> : null}
            </section>
          ))}
        </div>
      </Dialog>
    </div>
  );
}
