"use client";

import { Badge, Button, Input, Textarea } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { useState } from "react";
import { Async, DataTable, PageHead, Pager, ReasonDialog, useActDialog, useActionToast, useAdminApi, type Column } from "../../components/kit";
import type { PromptRow } from "../../lib/rpc";
import { fieldErrors, promptSchema } from "../../lib/schemas";
import { useAsync } from "../../lib/use-async";

export function PromptsPage() {
  const { t, dateTime } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<PromptRow | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const state = useAsync(() => api.prompts(page), [page]);
  const { open, dialog } = useActDialog(state.reload);

  const activate = (p: PromptRow) =>
    open({
      title: t("admin.prompts.activateTitle"),
      body: `${p.name} v${p.version}. ${t("admin.prompts.activateBody")}`,
      confirm: t("admin.prompts.activate"),
      hideReason: true,
      run: async () => void (await api.activatePrompt(p.id)),
    });

  const columns: Column<PromptRow>[] = [
    { key: "name", header: t("admin.prompts.colName"), cell: (p) => <strong>{p.name}</strong> },
    { key: "ver", header: t("admin.prompts.colVersion"), cell: (p) => `v${p.version}` },
    { key: "model", header: t("admin.prompts.colModel"), cell: (p) => p.model ?? t("admin.common.none") },
    { key: "active", header: t("admin.prompts.colActive"), cell: (p) => <Badge tone={p.is_active ? "success" : "neutral"}>{p.is_active ? t("admin.prompts.active") : t("admin.prompts.inactive")}</Badge> },
    { key: "created", header: t("admin.prompts.colCreated"), cell: (p) => dateTime(p.created_at, { dateStyle: "medium", timeStyle: "short" }) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (p) => (
        <span className="row">
          <Button size="sm" variant="ghost" onClick={() => setViewing(p)}>
            {t("admin.prompts.view")}
          </Button>
          {p.is_active ? null : (
            <Button size="sm" variant="secondary" onClick={() => activate(p)}>
              {t("admin.prompts.activate")}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title={t("admin.prompts.title")}
        subtitle={t("admin.prompts.subtitle")}
        actions={
          <Button
            onClick={() => {
              setErrors({});
              setCreating(true);
            }}
          >
            {t("admin.prompts.newTitle")}
          </Button>
        }
      />
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.prompts.title")} columns={columns} rows={d.rows} rowKey={(p) => p.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      {dialog}
      <ReasonDialog
        open={creating}
        title={t("admin.prompts.newTitle")}
        confirmLabel={t("admin.common.create")}
        onClose={() => setCreating(false)}
        validate={(fd) => {
          const r = promptSchema.safeParse({ name: fd.get("name"), template: String(fd.get("template") ?? ""), model: fd.get("model") ?? "", activate: fd.get("activate") === "on", reason: "valid" });
          const e = r.success ? {} : fieldErrors(r.error);
          setErrors(e);
          return r.success ? null : e;
        }}
        onConfirm={async (reason, fd) => {
          const v = promptSchema.parse({ name: fd.get("name"), template: String(fd.get("template") ?? ""), model: fd.get("model") ?? "", activate: fd.get("activate") === "on", reason });
          await api.createPrompt(v);
          toast.ok();
          state.reload();
        }}
      >
        <Input name="name" label={t("admin.prompts.name")} hint={t("admin.prompts.nameHint")} error={errors.name && t(errors.name)} />
        <Textarea name="template" label={t("admin.prompts.template")} rows={8} maxLength={50000} error={errors.template && t(errors.template)} />
        <Input name="model" label={t("admin.prompts.model")} error={errors.model && t(errors.model)} />
        <label className="row">
          <input type="checkbox" name="activate" />
          <span>{t("admin.prompts.activateNow")}</span>
        </label>
      </ReasonDialog>
      <ReasonDialog open={viewing !== null} hideReason title={viewing ? `${viewing.name} v${viewing.version}` : ""} confirmLabel={t("admin.common.back")} onClose={() => setViewing(null)} onConfirm={async () => undefined}>
        <pre className="source-box" tabIndex={0}>
          {viewing?.template}
        </pre>
      </ReasonDialog>
    </>
  );
}
