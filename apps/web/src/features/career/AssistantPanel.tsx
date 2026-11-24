"use client";

import { CV_LANGUAGES, cvCompleteness, type CvData, type CvFeedback, type CvLanguage } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Icon, ProgressRing, Select } from "@unimate/ui";
import { useState } from "react";
import { EdgeNotice } from "@/components/EdgeNotice";
import type { EdgeError } from "@/lib/edge";
import { cvFeedback } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { myTracking } from "./api";
import { Chips } from "./parts";

/** "Review my CV" (cv-feedback): completeness, strengths, improvements, missing keywords; the rewritten summary is applied only after a preview + Accept. */
export function AssistantPanel({ cvId, cv, language, ensureSaved, onApplySummary }: { cvId: string; cv: CvData; language: CvLanguage; ensureSaved: () => Promise<boolean>; onApplySummary: (text: string) => void }) {
  const { t } = useI18n();
  const tracked = useAsync(() => myTracking(getBrowserClient()), []);
  const [target, setTarget] = useState("");
  const [lang, setLang] = useState<CvLanguage>(language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EdgeError | null>(null);
  const [out, setOut] = useState<{ feedback: CvFeedback; cached: boolean } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const listings = (tracked.data ?? []).filter((i) => i.listingState === "published" && i.opportunityId);
  const score = cvCompleteness(cv);
  const run = async () => {
    setBusy(true);
    setError(null);
    setPreviewing(false);
    if (!(await ensureSaved())) return setBusy(false);
    const r = await cvFeedback(cvId, { ...(target ? { opportunityId: target } : {}), outputLanguage: lang });
    setBusy(false);
    if (r.ok) setOut(r.data);
    else setError(r.error);
  };
  const fb = out?.feedback;
  return (
    <div className="stack">
      <div className="row" style={{ gap: 12 }}>
        <ProgressRing value={score.score} label={t("cvWeb.ai.score")}>{`${score.score}%`}</ProgressRing>
        <div className="stack" style={{ gap: 2, flex: 1, minWidth: 140 }}>
          <strong>{t("career.cv.scoreValue", { n: score.score })}</strong>
          {score.missing
            .filter((k): k is Exclude<typeof k, "personal" | "hobbies" | "honours" | "activities"> => k !== "personal" && k !== "hobbies" && k !== "honours" && k !== "activities")
            .slice(0, 2)
            .map((k) => (
              <span key={k} className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
                {t(`career.cv.tip.${k}`)}
              </span>
            ))}
        </div>
      </div>
      <h3 className="row" style={{ gap: 8 }}>
        <Icon name="ai-chat" /> {t("cvWeb.ai.reviewTitle")}
      </h3>
      <p className="um-muted">{t("cvWeb.ai.reviewBody")}</p>
      {listings.length ? (
        <Select label={t("career.ai.target")} hint={t("cvWeb.ai.targetNote")} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{t("career.ai.targetNone")}</option>
          {listings.map((l) => (
            <option key={l.id} value={l.opportunityId!}>
              {`${l.title} · ${l.organization}`}
            </option>
          ))}
        </Select>
      ) : (
        <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
          {t("cvWeb.ai.noTracked")}
        </p>
      )}
      <Chips label={t("career.ai.language")} value={lang} onChange={setLang} options={CV_LANGUAGES.map((l) => ({ value: l, label: t(`career.lang.${l}`) }))} />
      <div className="row">
        <Button loading={busy} onClick={() => void run()}>
          {busy ? t("career.ai.working") : t("cvWeb.ai.reviewAction")}
        </Button>
      </div>
      {error ? <EdgeNotice error={error} /> : null}
      {fb ? (
        <div className="stack" role="status">
          {out?.cached ? <p className="um-muted">{t("career.ai.cached")}</p> : null}
          <h3>{t("career.ai.overall")}</h3>
          <p>{fb.overall}</p>
          <h3>{t("career.ai.strengths")}</h3>
          <ul>
            {fb.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <h3>{t("career.ai.improvements")}</h3>
          <ul style={{ listStyle: "none", padding: 0 }} className="stack">
            {fb.improvements.map((s, i) => (
              <li key={i} className="stack">
                <Badge tone="info">{s.section === "general" ? t("career.ai.sectionGeneral") : t(`career.cv.section.${s.section}`)}</Badge>
                <span>{s.suggestion}</span>
              </li>
            ))}
          </ul>
          {fb.missingKeywords.length ? (
            <>
              <h3>{t("career.ai.keywords")}</h3>
              <div className="row">
                {fb.missingKeywords.map((k) => (
                  <Badge key={k} tone="warning">
                    {k}
                  </Badge>
                ))}
              </div>
            </>
          ) : null}
          {fb.rewrittenSummary ? (
            <>
              <h3>{t("career.ai.summary")}</h3>
              {previewing ? (
                <div className="stack" role="group" aria-label={t("cvWeb.ai.applyPreview")} style={{ padding: 10, border: "1px dashed var(--primary)", borderRadius: "var(--radius-md)" }}>
                  <strong style={{ fontSize: "var(--text-sm)" }}>{t("cvWeb.ai.applyPreview")}</strong>
                  <p style={{ overflowWrap: "anywhere" }}>{fb.rewrittenSummary}</p>
                  <div className="row">
                    <Button
                      size="sm"
                      onClick={() => {
                        onApplySummary(fb.rewrittenSummary);
                        setPreviewing(false);
                      }}
                    >
                      {t("cvWeb.ai.accept")}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setPreviewing(false)}>
                      {t("cvWeb.ai.discard")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="um-muted">{fb.rewrittenSummary}</p>
                  <div className="row">
                    <Button size="sm" variant="secondary" onClick={() => setPreviewing(true)}>
                      {t("cvWeb.ai.apply")}
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : null}
          <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
            {t("career.ai.disclaimer")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
