"use client";

import { Button, Card, Dialog, Input, useToast } from "@unimate/ui";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { LocaleSwitcher, ThemeToggle } from "@/components/prefs";
import type { ThemePref } from "@/lib/theme";
import { useUser } from "@/components/user";
import { useI18n } from "@unimate/i18n/react";
import { profileNameSchema } from "@/lib/schemas";
import { getBrowserClient } from "@/lib/supabase/browser";
import { EXPORT_TABLES, OWNER_COLUMN, buildExport } from "./export";

const LEGAL = ["privacy", "terms", "aiDisclaimer", "community", "retention"] as const;
const LEGAL_SLUG: Record<(typeof LEGAL)[number], string> = { privacy: "privacy", terms: "terms", aiDisclaimer: "ai-disclaimer", community: "community-guidelines", retention: "data-retention" };

export function Settings({ theme }: { theme: ThemePref }) {
  const { t } = useI18n();
  const user = useUser();
  const { toast } = useToast();
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function saveName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = profileNameSchema.safeParse({ displayName: new FormData(e.currentTarget).get("displayName") });
    if (!parsed.success) return setNameError(t("validation.required"));
    setNameError(null);
    setSaving(true);
    const { error } = await getBrowserClient().from("profiles").update({ display_name: parsed.data.displayName }).eq("id", user.id);
    setSaving(false);
    toast(error ? t("planner.saveFailed", { reason: error.message }) : t("settings.profileSaved"), error ? "error" : "success");
  }

  async function exportData() {
    setExporting(true);
    try {
      const sb = getBrowserClient();
      const results = await Promise.all(
        EXPORT_TABLES.map(async (table) => {
          const owner = OWNER_COLUMN[table];
          const q = sb.from(table).select("*");
          const { data, error } = await (owner ? q.eq(owner, user.id) : q);
          return { table, rows: (data as unknown[] | null) ?? null, error: error?.message ?? null };
        }),
      );
      const bundle = buildExport(user.id, results, new Date());
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `unimate-export-${bundle.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(t("settings.exportDone"), "success");
    } catch (e) {
      toast(t("settings.exportFailed", { reason: e instanceof Error ? e.message : "" }), "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("settings.title")}</h1>
        {user.email ? <p>{t("settings.signedInAs", { email: user.email })}</p> : null}
      </div>

      <Card>
        <h2>{t("settings.appearance")}</h2>
        <div className="stack" style={{ marginTop: "var(--space-4)" }}>
          <ThemeToggle initial={theme} />
          <div style={{ maxWidth: 280 }}>
            <LocaleSwitcher />
          </div>
        </div>
      </Card>

      <Card>
        <h2>{t("settings.profile")}</h2>
        <form onSubmit={saveName} noValidate className="stack" style={{ marginTop: "var(--space-4)", maxWidth: 420 }}>
          <Input name="displayName" label={t("settings.displayName")} defaultValue={user.displayName ?? ""} error={nameError ?? undefined} />
          <div>
            <Button type="submit" loading={saving}>{t("settings.saveProfile")}</Button>
          </div>
        </form>
      </Card>

      <Card>
        <h2>{t("settings.privacy")}</h2>
        <nav className="legal-nav" aria-label={t("settings.legalLinks")} style={{ marginTop: "var(--space-4)" }}>
          {LEGAL.map((k) => (
            <Link key={k} href={`/legal/${LEGAL_SLUG[k]}`}>{t(`legal.${k}`)}</Link>
          ))}
        </nav>
      </Card>

      <Card>
        <h2>{t("settings.exportTitle")}</h2>
        <p className="um-muted" style={{ margin: "var(--space-2) 0 var(--space-4)" }}>{t("settings.exportBody")}</p>
        <Button variant="secondary" onClick={exportData} loading={exporting}>{t("settings.exportCta")}</Button>
      </Card>

      <Card>
        <h2>{t("settings.deleteTitle")}</h2>
        <p className="warn-box" style={{ margin: "var(--space-3) 0" }}>{t("settings.deleteUnavailable")}</p>
        <Button variant="danger" onClick={() => setDeleteOpen(true)}>{t("settings.deleteDialogTitle")}</Button>
        <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t("settings.deleteDialogTitle")} actions={<Button onClick={() => setDeleteOpen(false)}>{t("common.close")}</Button>}>
          <p>{t("settings.deleteBody")}</p>
        </Dialog>
      </Card>
    </div>
  );
}
