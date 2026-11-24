"use client";

import { cvMissingRequired, renderCvBodyHtml } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, EmptyState, ErrorState, Skeleton } from "@unimate/ui";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { getCv } from "./api";
import { CV_PHOTO_URL_TTL_S } from "./cv-parts";
import { cvFontUrl, cvLabels } from "./cv-preview";

/**
 * Print-to-PDF page: the CV rendered by the shared, escaping renderer (same as the live preview) with its design, the bundled
 * fonts and the CV's own language. The tab title is the CV title, so it becomes the PDF file name. `mode=ats` prints the plain
 * ATS version. print() runs only after the fonts are ready; `autoprint=1` starts it by itself once.
 */
export function CvPrint({ id, mode, autoprint }: { id: string; mode: "designed" | "ats"; autoprint: boolean }) {
  const { t } = useI18n();
  const doc = useAsync(async () => {
    const sb = getBrowserClient();
    const cv = await getCv(sb, id);
    const path = cv?.data.personal.photoPath;
    const photo = path ? (await sb.storage.from("cv-photos").createSignedUrl(path, CV_PHOTO_URL_TTL_S)).data?.signedUrl : undefined;
    return cv && { ...cv, photo: photo ?? cv.data.personal.photoUrl };
  }, [id]);
  const printed = useRef(false);
  const data = doc.data;
  const blocked = data ? cvMissingRequired(data.data).length > 0 : true;

  const print = async () => {
    await document.fonts.ready;
    const prev = document.title;
    if (data) document.title = data.title;
    const restore = () => {
      document.title = prev;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  };
  useEffect(() => {
    if (autoprint && data && !blocked && !printed.current) {
      printed.current = true;
      void print();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when the CV has loaded
  }, [data, blocked, autoprint]);

  const back = (
    <p className="cv-print-chrome">
      <Link href={`/career/cv/${id}`}>← {t("career.cv.printBack")}</Link>
    </p>
  );
  if (doc.loading && !data) return <Skeleton height={400} />;
  if (doc.error) return <ErrorState title={t("career.loadFailed")} description={doc.error} action={<Button onClick={doc.reload}>{t("common.retry")}</Button>} />;
  if (!data) return <EmptyState title={t("career.notFound")} />;
  const design = mode === "ats" ? { ...data.design, mode: "ats" as const } : data.design;
  const html = renderCvBodyHtml(data.data, {
    template: data.template,
    design,
    language: data.language,
    labels: cvLabels(data.language),
    fonts: cvFontUrl,
    assets: { logoSrc: "/brand/full-logo.png", photoSrc: data.photo || undefined },
  });
  const missing = cvMissingRequired(data.data).map((k) => t(`career.cv.field.${k}`));
  return (
    <div className="stack-lg">
      {back}
      <div className="row cv-print-chrome">
        <Button disabled={missing.length > 0} onClick={() => void print()}>
          {t("career.cv.print")}
        </Button>
        <span className="um-muted">{t("career.cv.exportHintWeb")}</span>
      </div>
      {missing.length ? (
        <p className="err-box cv-print-chrome" role="alert">
          {`${missing.join(", ")}: ${t("career.cv.required")}`}
        </p>
      ) : null}
      {/* the renderer escapes every user field and only links https URLs (unit-tested in packages/core) */}
      <div className="cv-print-area" lang={data.language} style={{ background: "#fff", color: "#000", padding: 0 }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
