"use client";

import { Button, Card, Input, ProgressRing, Select } from "@unimate/ui";
import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/provider";
import { LETTERS, computeGpa, type BandInput, type GpaRow, type ScaleMode } from "./compute";

let counter = 0;
const uid = () => `r${++counter}`;
const emptyRow = (): GpaRow => ({ id: uid(), name: "", credits: "", score: "", letter: "" });
const defaultBands = (): BandInput[] => [
  { id: uid(), min: "90", letter: "A", points: "4" },
  { id: uid(), min: "70", letter: "B", points: "3" },
  { id: uid(), min: "50", letter: "C", points: "2" },
  { id: uid(), min: "0", letter: "F", points: "0" },
];

export function GpaCalculator() {
  const { t, number } = useI18n();
  const [mode, setMode] = useState<ScaleMode>("az");
  const [bands, setBands] = useState<BandInput[]>(defaultBands);
  const [rows, setRows] = useState<GpaRow[]>(() => [emptyRow(), emptyRow(), emptyRow()]);

  const outcome = useMemo(() => computeGpa(mode, bands, rows), [mode, bands, rows]);
  const patchRow = (id: string, p: Partial<GpaRow>) => setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const patchBand = (id: string, p: Partial<BandInput>) => setBands((cur) => cur.map((b) => (b.id === id ? { ...b, ...p } : b)));
  const maxPoints = 4;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("gpa.title")}</h1>
        <p>{t("gpa.subtitle")}</p>
      </div>

      <Card>
        <div className="stack">
          <Select label={t("gpa.scale")} value={mode} onChange={(e) => setMode(e.target.value as ScaleMode)}>
            <option value="az">{t("gpa.scaleAz")}</option>
            <option value="letter">{t("gpa.scaleLetter")}</option>
            <option value="custom">{t("gpa.scaleCustom")}</option>
          </Select>
          <p className="um-hint">{t("gpa.assumption")}</p>
          {mode === "custom" ? (
            <div className="stack">
              {bands.map((b) => (
                <div key={b.id} className="form-grid">
                  <Input label={t("gpa.bandMin")} inputMode="decimal" value={b.min} onChange={(e) => patchBand(b.id, { min: e.target.value })} />
                  <Input label={t("gpa.bandLetter")} value={b.letter} onChange={(e) => patchBand(b.id, { letter: e.target.value })} />
                  <Input label={t("gpa.bandPoints")} inputMode="decimal" value={b.points} onChange={(e) => patchBand(b.id, { points: e.target.value })} />
                  <Button variant="ghost" size="sm" onClick={() => setBands((c) => c.filter((x) => x.id !== b.id))} disabled={bands.length <= 1}>
                    {t("gpa.removeBand")}
                  </Button>
                </div>
              ))}
              <div>
                <Button variant="secondary" size="sm" onClick={() => setBands((c) => [...c, { id: uid(), min: "", letter: "", points: "" }])}>
                  {t("gpa.addBand")}
                </Button>
              </div>
              {!outcome.ok && outcome.reason === "scale" ? <p className="err-box" role="alert">{t("gpa.scaleInvalid")}</p> : null}
            </div>
          ) : null}
        </div>
      </Card>

      <div className="stack">
        {rows.map((r, i) => {
          const err = outcome.rowErrors[r.id];
          return (
            <div key={r.id} className="gpa-row" role="group" aria-label={`${t("gpa.course")} ${i + 1}`}>
              <div className="span-2">
                <Input label={t("gpa.course")} value={r.name} onChange={(e) => patchRow(r.id, { name: e.target.value })} />
              </div>
              <Input label={t("gpa.credits")} inputMode="decimal" value={r.credits} error={err === "validation.credits" ? t(err) : undefined} onChange={(e) => patchRow(r.id, { credits: e.target.value })} />
              {mode === "letter" ? (
                <Select label={t("gpa.letter")} value={r.letter} error={err === "validation.required" ? t(err) : undefined} onChange={(e) => patchRow(r.id, { letter: e.target.value })}>
                  <option value="">{t("common.select")}</option>
                  {LETTERS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </Select>
              ) : (
                <Input label={t("gpa.score")} inputMode="decimal" value={r.score} error={err === "validation.score" ? t(err) : undefined} onChange={(e) => patchRow(r.id, { score: e.target.value })} />
              )}
              <Button variant="ghost" size="sm" onClick={() => setRows((c) => (c.length > 1 ? c.filter((x) => x.id !== r.id) : c))} disabled={rows.length <= 1}>
                {t("gpa.removeCourse")}
              </Button>
            </div>
          );
        })}
        <div>
          <Button variant="secondary" onClick={() => setRows((c) => [...c, emptyRow()])}>{t("gpa.addCourse")}</Button>
        </div>
      </div>

      <Card>
        <div className="gpa-result" role="status" aria-live="polite">
          {outcome.ok && outcome.gpa !== null ? (
            <>
              <ProgressRing value={outcome.gpa} max={maxPoints} size={110} label={`${t("gpa.result")}: ${outcome.gpa}`}>
                <span className="stat" style={{ fontSize: "var(--text-xl)" }}>{number(outcome.gpa, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </ProgressRing>
              <div>
                <h2>{t("gpa.result")}</h2>
                <p className="um-muted">{t("gpa.totalCredits", { n: number(outcome.totalCredits) })}</p>
              </div>
            </>
          ) : !outcome.ok && outcome.reason === "rows" ? (
            <p className="err-box">{t("gpa.invalid")}</p>
          ) : (
            <p className="um-muted">{t("gpa.resultNone")}</p>
          )}
        </div>
      </Card>
    </div>
  );
}
