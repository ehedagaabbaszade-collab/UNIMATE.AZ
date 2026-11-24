"use client";

import type { CvData } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Dialog, Skeleton, useToast } from "@unimate/ui";
import { useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { mergeProfileImport, type ImportChoice, type ProfileImport } from "./cv-import";

async function readProfile(uid: string, email: string): Promise<ProfileImport> {
  const sb = getBrowserClient();
  const p = await sb.from("profiles").select("display_name,university_id,major_id").eq("id", uid).maybeSingle<{ display_name: string | null; university_id: string | null; major_id: string | null }>();
  if (p.error) throw new Error(p.error.message);
  const [uni, major] = await Promise.all([
    p.data?.university_id ? sb.from("universities").select("name").eq("id", p.data.university_id).maybeSingle<{ name: string }>() : Promise.resolve({ data: null }),
    p.data?.major_id ? sb.from("majors").select("name").eq("id", p.data.major_id).maybeSingle<{ name: string }>() : Promise.resolve({ data: null }),
  ]);
  return { fullName: p.data?.display_name ?? "", email, university: uni.data?.name ?? "", major: major.data?.name ?? "" };
}

/** Lists what the profile can offer; copies only the ticked items into the CV (empty fields only unless "overwrite"). Never writes the profile. */
export function ImportDialog({ open, cv, onClose, onApply }: { open: boolean; cv: CvData; onClose: () => void; onApply: (next: CvData) => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const user = useUser();
  const src = useAsync(() => readProfile(user.id, user.email ?? ""), [user.id, user.email], open);
  const [c, setC] = useState<ImportChoice>({ name: true, email: true, education: true, overwrite: false });
  const p = src.data;
  const rows: Array<{ k: "name" | "email" | "education"; label: string; value: string }> = p
    ? [
        { k: "name" as const, label: t("cvWeb.imp.name"), value: p.fullName },
        { k: "email" as const, label: t("cvWeb.imp.email"), value: p.email },
        { k: "education" as const, label: t("cvWeb.imp.education"), value: [p.university, p.major].filter(Boolean).join(" / ") },
      ].filter((r) => r.value.trim())
    : [];
  const apply = () => {
    if (!p) return;
    const r = mergeProfileImport(cv, p, { ...c, name: c.name && rows.some((x) => x.k === "name"), email: c.email && rows.some((x) => x.k === "email"), education: c.education && rows.some((x) => x.k === "education") });
    if (r.changed) {
      onApply(r.data);
      toast(t("cvWeb.imp.done"), "success");
    } else toast(t("cvWeb.imp.unchanged"), "info");
    onClose();
  };
  return (
    <Dialog
      open={open}
      title={t("cvWeb.imp.title")}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!rows.length} onClick={apply}>
            {t("cvWeb.imp.apply")}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="um-muted">{t("cvWeb.imp.body")}</p>
        {src.loading && !p ? <Skeleton height={80} /> : null}
        {src.error ? (
          <p className="err-box" role="alert">
            {t("cvWeb.imp.failed")}
          </p>
        ) : null}
        {p && rows.length === 0 ? <p>{t("cvWeb.imp.nothing")}</p> : null}
        {rows.map((r) => (
          <label key={r.k} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={c[r.k]} onChange={(e) => setC({ ...c, [r.k]: e.target.checked })} />
            <span style={{ overflowWrap: "anywhere" }}>{t("cvWeb.imp.value", { label: r.label, value: r.value })}</span>
          </label>
        ))}
        {rows.length ? (
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={c.overwrite} onChange={(e) => setC({ ...c, overwrite: e.target.checked })} />
            {t("cvWeb.imp.overwrite")}
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}
