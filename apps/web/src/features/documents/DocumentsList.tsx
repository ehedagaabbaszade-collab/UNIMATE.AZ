"use client";

import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, useToast, type BadgeTone } from "@unimate/ui";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/user";
import { UploadIcon } from "@/components/icons";
import type { MessageKey } from "@/i18n";
import { formatBytes } from "@/i18n";
import { useI18n } from "@/i18n/provider";
import type { DocStatus, DocumentRow } from "@/lib/db";
import { edgeErrorMessageKey } from "@/lib/edge";
import { processDocument } from "@/lib/edge-client";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { precheckFile, storagePathFor } from "./upload";
import { UsageMeter } from "./UsageMeter";

export const STATUS_TONE: Record<DocStatus, BadgeTone> = { pending_upload: "neutral", uploaded: "info", processing: "primary", ready: "success", failed: "danger" };
/** Polled states. pending_upload is excluded: an abandoned upload never changes by itself. */
export const isInFlight = (s: DocStatus) => s === "uploaded" || s === "processing";

export const DOC_COLUMNS = "id,title,original_filename,storage_path,mime_type,size_bytes,status,page_count,error,created_at";

export function DocumentsList() {
  const { t, date, locale } = useI18n();
  const user = useUser();
  const { toast } = useToast();
  const docs = useAsync<DocumentRow[]>(async () => unwrap(await getBrowserClient().from("documents").select(DOC_COLUMNS).order("created_at", { ascending: false })), []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Live status: poll while anything is still being processed (Realtime is not enabled for these tables).
  const anyInFlight = docs.data?.some((d) => isInFlight(d.status)) ?? false;
  const reload = docs.reload;
  useEffect(() => {
    if (!anyInFlight) return;
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
  }, [anyInFlight, reload]);

  async function onFile(file: File) {
    setUploadError(null);
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const check = precheckFile({ name: file.name, size: file.size, mimeType: file.type, head });
    if (!check.ok) {
      setUploadError(t(`documents.upload_errors.${check.error}` as MessageKey));
      return;
    }
    setUploading(true);
    const sb = getBrowserClient();
    const objectId = crypto.randomUUID();
    const path = storagePathFor(user.id, objectId, check.extension);
    try {
      const ins = await sb
        .from("documents")
        .insert({
          user_id: user.id,
          title: check.title,
          original_filename: file.name,
          storage_path: path,
          mime_type: check.mimeType,
          size_bytes: file.size,
          idempotency_key: crypto.randomUUID(),
        })
        .select("id")
        .single<{ id: string }>();
      if (ins.error) throw new Error(ins.error.message);
      const docId = ins.data.id;

      const up = await sb.storage.from("documents").upload(path, file, { contentType: check.mimeType, upsert: false });
      if (up.error) {
        await sb.from("documents").delete().eq("id", docId);
        throw new Error(up.error.message);
      }
      // pending_upload -> uploaded is the only status change the database lets a client make.
      const upd = await sb.from("documents").update({ status: "uploaded" }).eq("id", docId);
      if (upd.error) throw new Error(upd.error.message);

      const proc = await processDocument(docId);
      if (proc.ok) toast(t("documents.uploaded"), "success");
      else toast(t("documents.processStartFailed", { reason: t(edgeErrorMessageKey(proc.error), { message: proc.error.message ?? "" }) }), "error");
      docs.reload();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t("common.genericError"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(d: DocumentRow) {
    if (!window.confirm(t("documents.deleteConfirm"))) return;
    const sb = getBrowserClient();
    const del = await sb.from("documents").delete().eq("id", d.id);
    if (del.error) return toast(del.error.message, "error");
    await sb.storage.from("documents").remove([d.storage_path]);
    toast(t("documents.deleted"), "success");
    docs.reload();
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("documents.title")}</h1>
        <p>{t("documents.subtitle")}</p>
      </div>

      <UsageMeter />

      <div className="upload-zone">
        <div className="row">
          <UploadIcon />
          <div>
            <h2>{t("documents.upload")}</h2>
            <p className="um-muted">{t("documents.uploadHint")}</p>
          </div>
        </div>
        <input
          ref={fileRef}
          id="doc-file"
          className="um-sr-only"
          type="file"
          accept=".pdf,.docx,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          disabled={uploading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
        <div className="row">
          <Button loading={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? t("documents.uploading") : t("documents.dropTitle")}
          </Button>
        </div>
        {uploadError ? (
          <p className="err-box" role="alert">
            {uploadError}
          </p>
        ) : null}
      </div>

      {docs.loading && !docs.data ? (
        <div className="grid-auto">
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      ) : docs.error ? (
        <ErrorState title={t("documents.loadFailed")} description={docs.error} action={<Button onClick={docs.reload}>{t("common.retry")}</Button>} />
      ) : docs.data && docs.data.length === 0 ? (
        <EmptyState title={t("documents.empty")} description={t("documents.emptyBody")} />
      ) : (
        <>
          {anyInFlight ? <p className="um-muted" role="status">{t("documents.refreshing")}</p> : null}
          <div className="grid-auto">
            {docs.data?.map((d) => (
              <Card key={d.id} className="doc-card">
                <div className="row row--between">
                  <Badge tone={STATUS_TONE[d.status]}>{t(`documents.status.${d.status}`)}</Badge>
                  <span className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
                    {date(d.created_at)}
                  </span>
                </div>
                <h3>{d.title}</h3>
                <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
                  {[d.page_count != null ? t("documents.pages", { n: d.page_count }) : null, d.size_bytes != null ? formatBytes(locale, d.size_bytes) : null].filter(Boolean).join(" · ")}
                </p>
                {d.status === "failed" && d.error ? <p className="err-box">{d.error}</p> : null}
                <div className="row">
                  <Link className="um-btn um-btn--secondary um-btn--sm" href={`/documents/${d.id}`}>
                    {t("documents.open")}
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => remove(d)}>
                    {t("common.delete")}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
