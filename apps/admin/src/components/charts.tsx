"use client";

import { useI18n } from "@unimate/i18n/react";
import { useId, type ReactNode } from "react";
import type { MeterTone } from "../lib/ai-config";
import { DataTable } from "./kit";

/**
 * Small dependency-free SVG charts. Every chart has a text alternative: the SVG is an image with a title and the same
 * numbers are available in a real table inside a disclosure ("Show as table"). Colours come from theme variables.
 */
const COLORS = ["var(--primary)", "var(--accent)", "var(--warning)"] as const;

export interface Series {
  label: string;
  values: number[];
}

export function LineChart({ title, labels, series, format }: { title: string; labels: string[]; series: Series[]; format?: (n: number) => string }) {
  const { t, number } = useI18n();
  const id = useId();
  const fmt = format ?? ((n: number) => number(n));
  const W = 640;
  const H = 220;
  const L = 48;
  const B = 26;
  const n = labels.length;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => L + (n <= 1 ? (W - L - 10) / 2 : (i * (W - L - 10)) / (n - 1));
  const y = (v: number) => H - B - (v / max) * (H - B - 14);
  const ticks = [0, max / 2, max];
  const rows = labels.map((label, i) => ({ label, i }));
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${id}-t`} style={{ width: "100%", height: "auto", maxHeight: 280 }}>
        <title id={`${id}-t`}>{title}</title>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={L} x2={W - 10} y1={y(tk)} y2={y(tk)} stroke="var(--border)" strokeWidth={1} />
            <text x={L - 6} y={y(tk) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {fmt(Math.round(tk))}
            </text>
          </g>
        ))}
        {n > 0 ? (
          <>
            <text x={L} y={H - 6} fontSize={11} fill="var(--text-muted)">
              {labels[0]}
            </text>
            <text x={W - 10} y={H - 6} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {labels[n - 1]}
            </text>
          </>
        ) : null}
        {series.map((s, si) => (
          <g key={s.label}>
            <polyline fill="none" stroke={COLORS[si % COLORS.length]} strokeWidth={2.5} strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {n <= 40 ? s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={COLORS[si % COLORS.length]} />) : null}
          </g>
        ))}
      </svg>
      <figcaption className="row legend">
        <strong>{title}</strong>
        {series.map((s, si) => (
          <span key={s.label} className="row" style={{ gap: 6 }}>
            <span aria-hidden="true" className="legend__swatch" style={{ background: COLORS[si % COLORS.length] }} />
            {s.label}
          </span>
        ))}
      </figcaption>
      <details className="chart__table">
        <summary>{t("admin.chart.showTable")}</summary>
        <DataTable
          caption={title}
          rows={rows}
          rowKey={(r) => r.label}
          columns={[{ key: "x", header: t("admin.chart.colLabel"), cell: (r) => r.label }, ...series.map((s, si) => ({ key: `s${si}`, header: s.label, cell: (r: { i: number }) => fmt(s.values[r.i] ?? 0) }))]}
        />
      </details>
    </figure>
  );
}

export interface BarItem {
  label: string;
  value: number;
  display: string;
}
/** Horizontal bars. The list items carry the numbers as text, so the bars are decoration (aria-hidden). */
export function BarList({ title, items }: { title: string; items: BarItem[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="group-title" style={{ marginTop: 0 }}>
        {title}
      </figcaption>
      <ul className="barlist" aria-label={title}>
        {items.map((it) => (
          <li key={it.label}>
            <span className="barlist__label">{it.label}</span>
            <span className="barlist__track" aria-hidden="true">
              <span className="barlist__fill" style={{ width: `${(it.value / max) * 100}%` }} />
            </span>
            <span className="barlist__value">{it.display}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Utilisation bar with a meter role; the percentage is always also printed as text next to it. */
export function Meter({ label, pct, tone, children }: { label: string; pct: number | null; tone: MeterTone; children?: ReactNode }) {
  const shown = pct === null ? 100 : Math.max(0, Math.min(100, pct));
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown)}>
      <span className="meter__fill" data-tone={tone} style={{ width: `${shown}%` }} />
      {children}
    </div>
  );
}
