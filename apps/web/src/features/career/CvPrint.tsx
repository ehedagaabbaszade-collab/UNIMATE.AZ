"use client";

import { CV_SECTIONS, renderCvBodyHtml, type CvPrintLabels } from "@unimate/core";
import { t as translate, type MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Button, EmptyState, ErrorState, Skeleton } from "@unimate/ui";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { getCv } from "./api";

/**
 * Print-to-PDF page: the CV rendered by the shared, escaping renderCvBodyHtml in the CV's own language. The browser's print
 * dialog ("Save as PDF") produces the file; everything except the CV is hidden in print.
 */
export function CvPrint({ id }: { id: string }) {
  const { t } = useI18n();
  const doc = useAsync(() => getCv(getBrowserClient(), id), [id]);
  const back = (
    <p className="cv-print-chrome">
      <Link href={`/career/cv/${id}`}>← {t("career.cv.printBack")}</Link>
    </p>
  );
  if (doc.loading && !doc.data) return <Skeleton height={400} />;
  if (doc.error) return <ErrorState title={t("career.loadFailed")} description={doc.error} action={<Button onClick={doc.reload}>{t("common.retry")}</Button>} />;
  if (!doc.data) return <EmptyState title={t("career.notFound")} />;
  const labels = Object.fromEntries([...CV_SECTIONS, "present"].map((k) => [k, translate(doc.data!.language, `career.cv.sectionPrint.${k}` as MessageKey)])) as CvPrintLabels;
  const html = renderCvBodyHtml(doc.data.data, { template: doc.data.template, labels });
  return (
    <div className="stack-lg">
      {back}
      <div className="row cv-print-chrome">
        <Button onClick={() => window.print()}>{t("career.cv.print")}</Button>
        <span className="um-muted">{t("career.cv.exportHintWeb")}</span>
      </div>
      {/* renderCvBodyHtml escapes every user field and only links https URLs (unit-tested) */}
      <div className="cv-print-area" lang={doc.data.language} style={{ background: "#fff", color: "#000", padding: 24, borderRadius: 8 }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
