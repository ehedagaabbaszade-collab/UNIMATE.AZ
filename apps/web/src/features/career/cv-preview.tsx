"use client";

import { CV_PRINT_LABEL_KEYS, escapeHtml, renderCvBodyHtml, resolveCvDesign, type CvData, type CvLanguage, type CvPrintLabels } from "@unimate/core";
import { t as translate, type MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { CV_PHOTO_URL_TTL_S } from "./cv-parts";

export const A4_W = 794; // 210mm at 96dpi
export const A4_H = 1123; // 297mm
const MM = 96 / 25.4;
const MARGIN_MM = { narrow: 10, normal: 15, wide: 25 } as const;

/** Print labels in the CV's own language (shared by the preview and the print page). */
export const cvLabels = (language: CvLanguage): CvPrintLabels =>
  Object.fromEntries(CV_PRINT_LABEL_KEYS.map((k) => [k, translate(language, `career.cv.sectionPrint.${k}` as MessageKey)])) as CvPrintLabels;
/** Font file -> URL for the renderer (the woff2 files live in apps/web/public/cv-fonts; CSP font-src 'self'). */
export const cvFontUrl = (file: string): string => `/cv-fonts/${file}`;

/** The cv-photos object (private bucket) as a short-lived signed URL, refreshed before it expires; legacy https links pass through. */
export function useCvPhotoUrl(path: string, legacyUrl: string): string {
  const [signed, setSigned] = useState("");
  useEffect(() => {
    if (!path) return setSigned("");
    let live = true;
    const load = () => void getBrowserClient().storage.from("cv-photos").createSignedUrl(path, CV_PHOTO_URL_TTL_S).then((r) => live && setSigned(r.data?.signedUrl ?? ""));
    load();
    const timer = setInterval(load, (CV_PHOTO_URL_TTL_S - 60) * 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path]);
  return path ? signed : legacyUrl;
}

/** A complete document for the preview frame (same renderer as the PDF). */
export function previewDocument(cv: CvData, o: { template: string; design: unknown; language: CvLanguage; photoSrc?: string | undefined }): { html: string; marginMm: number; band: boolean } {
  const d = resolveCvDesign(o.template, o.design);
  const body = renderCvBodyHtml(cv, { template: o.template, design: o.design, language: o.language, labels: cvLabels(o.language), fonts: cvFontUrl, assets: { logoSrc: "/brand/full-logo.png", photoSrc: o.photoSrc || undefined } });
  const band = / hb"/.test(body);
  const m = MARGIN_MM[d.margins];
  const bg = d.mode === "ats" ? "#FFFFFF" : d.background;
  const pad = o.template === "europass" ? "12mm" : band ? `${m}mm 0` : `${m}mm`;
  const html = `<!doctype html><html lang="${escapeHtml(o.language)}"><head><meta charset="utf-8"><style>html{background:${bg}}html,body{margin:0}body{padding:${pad};color:#111}</style></head><body>${body}</body></html>`;
  return { html, marginMm: m, band };
}

export type CvZoom = "fit" | number;
/** Live A4 preview: the renderer output in a sandboxed srcdoc frame (same-origin about:srcdoc, so the page CSP applies and fonts load from /cv-fonts). */
export function CvPreview({ cv, template, design, language, photoSrc, zoom = "fit", maxWidth }: { cv: CvData; template: string; design: unknown; language: CvLanguage; photoSrc?: string | undefined; zoom?: CvZoom; maxWidth?: number }) {
  const { t } = useI18n();
  const doc = useMemo(() => previewDocument(cv, { template, design, language, photoSrc }), [cv, template, design, language, photoSrc]);
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const [h, setH] = useState(A4_H);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => observer.current?.disconnect(), []);
  const measure = () => {
    const d = frame.current?.contentDocument;
    if (d?.body) setH(Math.max(A4_H, Math.ceil(d.body.getBoundingClientRect().height)));
  };
  const onLoad = () => {
    measure();
    const d = frame.current?.contentDocument;
    observer.current?.disconnect();
    if (d?.body) {
      observer.current = new ResizeObserver(measure);
      observer.current.observe(d.body);
    }
    void d?.fonts?.ready.then(measure);
  };
  const limit = maxWidth ? Math.min(avail, maxWidth) : avail;
  const z = zoom === "fit" ? Math.max(0.2, Math.min(1, (limit - 4) / A4_W)) : zoom;
  const pageH = (297 - 2 * doc.marginMm) * MM;
  const guides = Math.max(0, Math.ceil((h - doc.marginMm * MM) / pageH) - 1);
  return (
    <div ref={box} style={{ width: "100%", minWidth: 0, overflow: zoom === "fit" ? "hidden" : "auto" }}>
      <div style={{ position: "relative", width: A4_W * z, height: h * z, margin: "0 auto", boxShadow: "0 2px 14px rgba(17,21,43,.22)", background: "#fff" }}>
        <iframe
          ref={frame}
          title={t("cvWeb.editor.live")}
          sandbox="allow-same-origin"
          srcDoc={doc.html}
          onLoad={onLoad}
          scrolling="no"
          style={{ position: "absolute", left: 0, top: 0, width: A4_W, height: h, border: 0, transform: `scale(${z})`, transformOrigin: "0 0", background: "#fff" }}
        />
        {Array.from({ length: guides }, (_, i) => (
          <div
            key={i}
            aria-hidden="true"
            style={{ position: "absolute", left: 0, right: 0, top: (doc.marginMm * MM + (i + 1) * pageH) * z, borderTop: "1px dashed rgba(79,70,229,.55)", pointerEvents: "none", fontSize: 11, color: "#4F46E5", textAlign: "end", paddingInlineEnd: 6 }}
          >
            {t("cvWeb.editor.page", { n: i + 2 })}
          </div>
        ))}
      </div>
    </div>
  );
}
