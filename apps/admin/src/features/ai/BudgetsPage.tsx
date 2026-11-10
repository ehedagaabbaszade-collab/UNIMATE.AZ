"use client";

import { Badge, Button, Input, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { useState } from "react";
import { Meter } from "../../components/charts";
import { Async, DataTable, PageHead, ReasonDialog, useActDialog, useActionToast, useAdminApi, type Column } from "../../components/kit";
import { formatUsd, meterTone, microToUsdString, utilisationPct } from "../../lib/ai-config";
import { budgetSchema } from "../../lib/ai-schemas";
import type { UtilisationRow } from "../../lib/rpc";
import { fieldErrors } from "../../lib/schemas";
import { useAsync } from "../../lib/use-async";

const SCOPES = ["global", "plan", "user"] as const;
const PERIODS = ["day", "month"] as const;
type Form = { row: UtilisationRow | null } | null;

export function BudgetsPage() {
  const { t, number } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const state = useAsync(() => api.budgetUtilisation(), []);
  const [form, setForm] = useState<Form>(null);
  const [scope, setScope] = useState<(typeof SCOPES)[number]>("global");
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const { open, dialog } = useActDialog(state.reload);
  const edit = form?.row ?? null;

  const remove = (r: UtilisationRow) =>
    open({
      title: t("admin.budgets.deleteTitle"),
      body: t("admin.budgets.deleteBody"),
      confirm: t("admin.common.delete"),
      danger: true,
      run: async (reason) => void (await api.deleteBudget(r.scope, r.key, r.period, reason)),
    });

  const columns: Column<UtilisationRow>[] = [
    { key: "scope", header: t("admin.budgets.colScope"), cell: (r) => <strong>{t(`admin.ai.scope.${r.scope}`)}</strong> },
    { key: "key", header: t("admin.budgets.colKey"), cell: (r) => (r.key === "*" ? t("admin.budgets.allKey") : r.scope === "plan" ? t(`admin.users.planName.${r.key as "free" | "plus" | "pro"}`) : <span className="mono">{r.key}</span>) },
    { key: "period", header: t("admin.budgets.colPeriod"), cell: (r) => t(`admin.ai.period.${r.period}`) },
    { key: "limit", header: t("admin.budgets.colLimit"), cell: (r) => formatUsd(r.hard_limit_micro_usd) },
    { key: "spent", header: t("admin.budgets.colSpent"), cell: (r) => `${formatUsd(r.spent_micro_usd)} + ${formatUsd(r.reserved_micro_usd)}` },
    {
      key: "util",
      header: t("admin.budgets.colUtilisation"),
      cell: (r) => {
        const pct = utilisationPct(r.spent_micro_usd, r.reserved_micro_usd, r.hard_limit_micro_usd);
        return (
          <div className="stack" style={{ gap: 4, minWidth: 140 }}>
            <Meter label={t("admin.budgets.colUtilisation")} pct={pct} tone={meterTone(pct)} />
            <span>{pct === null ? <Badge tone="danger">{t("admin.budgets.blocked")}</Badge> : `${number(pct, { maximumFractionDigits: 2 })}%`}</span>
          </div>
        );
      },
    },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setErrors({});
              setScope(r.scope);
              setForm({ row: r });
            }}
          >
            {t("admin.common.edit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => remove(r)}>
            {t("admin.common.delete")}
          </Button>
        </span>
      ),
    },
  ];

  const input = (fd: FormData) => ({
    scope: edit ? edit.scope : String(fd.get("scope") ?? ""),
    key: edit ? edit.key : String(fd.get("key") ?? ""),
    period: edit ? edit.period : String(fd.get("period") ?? ""),
    limit: String(fd.get("limit") ?? ""),
  });

  return (
    <>
      <PageHead
        title={t("admin.budgets.title")}
        subtitle={t("admin.budgets.subtitle")}
        actions={
          <Button
            onClick={() => {
              setErrors({});
              setScope("global");
              setForm({ row: null });
            }}
          >
            {t("admin.budgets.new")}
          </Button>
        }
      />
      <p className="hint-box">{t("admin.budgets.userNote")}</p>
      <div style={{ marginTop: "var(--space-4)" }}>
        <Async state={state} isEmpty={(d) => d.length === 0}>
          {(d) => <DataTable caption={t("admin.budgets.title")} columns={columns} rows={d} rowKey={(r) => `${r.scope}:${r.key}:${r.period}`} />}
        </Async>
      </div>
      {dialog}
      <ReasonDialog
        open={form !== null}
        title={edit ? t("admin.budgets.editTitle") : t("admin.budgets.new")}
        body={t("admin.budgets.limitHint")}
        confirmLabel={t("admin.common.save")}
        onClose={() => setForm(null)}
        validate={(fd) => {
          const r = budgetSchema.safeParse(input(fd));
          const e = r.success ? {} : fieldErrors(r.error);
          setErrors(e);
          return r.success ? null : e;
        }}
        onConfirm={async (reason, fd) => {
          const v = budgetSchema.parse(input(fd));
          await api.setBudget({ ...v, reason });
          toast.ok();
          state.reload();
        }}
      >
        <div className="stack" key={edit ? `${edit.scope}:${edit.key}:${edit.period}` : "new"}>
          {edit ? null : (
            <>
              <Select name="scope" label={t("admin.budgets.colScope")} value={scope} onChange={(e) => setScope(e.target.value === "plan" ? "plan" : e.target.value === "user" ? "user" : "global")}>
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {t(`admin.ai.scope.${s}`)}
                  </option>
                ))}
              </Select>
              {scope === "plan" ? (
                <Select name="key" label={t("admin.budgets.colKey")}>
                  <option value="free">{t("admin.users.planName.free")}</option>
                  <option value="plus">{t("admin.users.planName.plus")}</option>
                  <option value="pro">{t("admin.users.planName.pro")}</option>
                </Select>
              ) : (
                <Input name="key" label={t("admin.budgets.colKey")} hint={scope === "global" ? t("admin.budgets.keyGlobalHint") : t("admin.budgets.keyUserHint")} defaultValue="*" error={errors.key && t(errors.key)} />
              )}
              <Select name="period" label={t("admin.budgets.colPeriod")}>
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {t(`admin.ai.period.${p}`)}
                  </option>
                ))}
              </Select>
            </>
          )}
          <Input name="limit" label={t("admin.budgets.limit")} inputMode="decimal" defaultValue={edit ? microToUsdString(edit.hard_limit_micro_usd) : ""} error={errors.limit && t(errors.limit)} />
        </div>
      </ReasonDialog>
    </>
  );
}
