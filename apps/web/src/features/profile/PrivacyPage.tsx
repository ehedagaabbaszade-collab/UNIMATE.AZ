"use client";

import { useI18n } from "@unimate/i18n/react";
import { Button, Card, Dialog, useToast } from "@unimate/ui";
import Link from "next/link";
import { useState } from "react";
import { LEGAL_SLUGS, type LegalSlug } from "@/content/legal";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";

const LEGAL_LABEL: Record<LegalSlug, "privacy" | "terms" | "aiDisclaimer" | "community" | "retention"> = {
  privacy: "privacy",
  terms: "terms",
  "ai-disclaimer": "aiDisclaimer",
  "community-guidelines": "community",
  "data-retention": "retention",
};

/** Privacy and legal: policies, data export and account deletion request (14-day grace period, cancellable). */
export function PrivacyPage() {
  const { t, date } = useI18n();
  const user = useUser();
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const info = useAsync(async () => {
    const del = await getBrowserClient().from("account_deletion_requests").select("scheduled_for").eq("status", "pending").maybeSingle<{ scheduled_for: string }>();
    return { deletionAt: del.data?.scheduled_for ?? null };
  }, [user.id]);

  /** export_my_data() returns the user's own data as JSON (RLS + explicit owner filters). */
  async function exportData() {
    setExporting(true);
    try {
      const json = JSON.stringify(unwrap(await getBrowserClient().rpc("export_my_data")), null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `unimate-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t("settings.exportDone"), "success");
    } catch (e) {
      toast(t("settings.exportFailed", { reason: e instanceof Error ? e.message : "" }), "error");
    } finally {
      setExporting(false);
    }
  }

  async function deletion(fn: "request_account_deletion" | "cancel_account_deletion", ok: "mobile.profile.deletionRequested" | "mobile.profile.deletionCancelled") {
    setBusy(true);
    const { error } = await getBrowserClient().rpc(fn);
    setBusy(false);
    setDeleteOpen(false);
    toast(error ? t("common.genericError") : t(ok), error ? "error" : "success");
    info.reload();
  }

  const deletionAt = info.data?.deletionAt;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("settings.privacy")}</h1>
      </div>
      <Card>
        <nav className="stack" aria-label={t("legal.title")}>
          {LEGAL_SLUGS.map((s) => (
            <Link key={s} href={`/legal/${s}`}>{t(`legal.${LEGAL_LABEL[s]}`)}</Link>
          ))}
        </nav>
      </Card>
      <Card>
        <div className="stack">
          <h2>{t("settings.exportTitle")}</h2>
          <p className="um-hint">{t("settings.exportBody")}</p>
          <div>
            <Button variant="secondary" onClick={() => void exportData()} loading={exporting}>{t("settings.exportCta")}</Button>
          </div>
        </div>
      </Card>
      <Card>
        <div className="stack">
          <h2>{t("settings.deleteTitle")}</h2>
          {deletionAt ? (
            <>
              <p className="warn-box">{t("mobile.profile.deletionPending", { date: date(deletionAt) })}</p>
              <div>
                <Button variant="secondary" loading={busy} onClick={() => void deletion("cancel_account_deletion", "mobile.profile.deletionCancelled")}>{t("mobile.profile.cancelDeletion")}</Button>
              </div>
            </>
          ) : (
            <>
              <p className="um-hint">{t("mobile.profile.deleteBody")}</p>
              <div>
                <Button variant="danger" onClick={() => setDeleteOpen(true)}>{t("settings.deleteDialogTitle")}</Button>
              </div>
            </>
          )}
        </div>
      </Card>
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t("settings.deleteDialogTitle")}
        actions={
          <>
            <Button variant="danger" loading={busy} onClick={() => void deletion("request_account_deletion", "mobile.profile.deletionRequested")}>{t("mobile.profile.deleteConfirm")}</Button>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>{t("common.cancel")}</Button>
          </>
        }
      >
        <p>{t("mobile.profile.deleteBody")}</p>
      </Dialog>
    </div>
  );
}
