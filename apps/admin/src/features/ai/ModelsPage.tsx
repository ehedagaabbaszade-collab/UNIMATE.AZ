"use client";

import { Badge, Button, Input, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { useState } from "react";
import { Async, DataTable, PageHead, ReasonDialog, useActionToast, useAdminApi, type Column } from "../../components/kit";
import { AI_TIERS, PROVIDER_KINDS, formatUsd, providerEnvName, microToUsdString, routeIssues, type ModelLite } from "../../lib/ai-config";
import { modelSchema, providerSchema } from "../../lib/ai-schemas";
import type { ModelRow, ProviderRow, RouteRow } from "../../lib/rpc";
import { fieldErrors } from "../../lib/schemas";
import { useAsync } from "../../lib/use-async";

const flag = (fd: FormData, k: string) => fd.get(k) === "on";
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** Would the edited model break an existing route (a fallback priced above its primary, or a lost approval)? */
function breaksRoute(edited: ModelLite, models: ModelRow[], routes: RouteRow[]): boolean {
  const list: ModelLite[] = models.map((m) => (m.id === edited.id ? edited : m));
  const by = new Map(list.map((m) => [m.id, m]));
  return routes.some((r) => (r.primary_model_id === edited.id || r.fallback_model_ids.includes(edited.id)) && routeIssues(by.get(r.primary_model_id), r.fallback_model_ids.flatMap((f) => by.get(f) ?? [])).some((k) => k === "admin.routes.errCostlier" || k === "admin.routes.errNotApproved"));
}

export function ModelsPage() {
  const { t, number } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const providers = useAsync(() => api.providers(), []);
  const models = useAsync(() => api.models(), []);
  const routes = useAsync(() => api.routes(), []);
  const [provForm, setProvForm] = useState<ProviderRow | "new" | null>(null);
  const [modelForm, setModelForm] = useState<ModelRow | "new" | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const reload = () => {
    providers.reload();
    models.reload();
    routes.reload();
  };
  const provName = (id: string) => providers.data?.find((p) => p.id === id)?.name ?? id;
  const enabledBadge = (on: boolean) => <Badge tone={on ? "success" : "neutral"}>{on ? t("admin.ai.enabled") : t("admin.ai.disabled")}</Badge>;
  const usd = (n: number) => formatUsd(n);

  const provCols: Column<ProviderRow>[] = [
    { key: "name", header: t("admin.providers.colName"), cell: (p) => <strong>{p.name}</strong> },
    { key: "kind", header: t("admin.providers.colKind"), cell: (p) => t(`admin.ai.kind.${p.kind}`) },
    { key: "label", header: t("admin.providers.colLabel"), cell: (p) => p.base_url_label ?? t("admin.common.none") },
    { key: "env", header: t("admin.providers.colEnv"), cell: (p) => <code className="mono">{providerEnvName(p.kind)}</code> },
    { key: "on", header: t("admin.providers.colEnabled"), cell: (p) => enabledBadge(p.enabled) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (p) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setErrors({});
            setProvForm(p);
          }}
        >
          {t("admin.common.edit")}
        </Button>
      ),
    },
  ];
  const modelCols: Column<ModelRow>[] = [
    { key: "model", header: t("admin.models.colModel"), cell: (m) => <strong>{m.model}</strong> },
    { key: "prov", header: t("admin.models.colProvider"), cell: (m) => provName(m.provider_id) },
    { key: "tier", header: t("admin.models.colTier"), cell: (m) => t(`admin.ai.tier.${m.tier}`) },
    { key: "in", header: t("admin.models.colInput"), cell: (m) => usd(m.input_micro_usd_per_mtok) },
    { key: "out", header: t("admin.models.colOutput"), cell: (m) => usd(m.output_micro_usd_per_mtok) },
    { key: "cached", header: t("admin.models.colCached"), cell: (m) => usd(m.cached_input_micro_usd_per_mtok) },
    { key: "max", header: t("admin.models.colMax"), cell: (m) => number(m.max_output_tokens) },
    {
      key: "flags",
      header: t("admin.models.colFlags"),
      cell: (m) => (
        <span className="row" style={{ gap: 4 }}>
          {enabledBadge(m.enabled)}
          {m.approved_fallback ? <Badge tone="info">{t("admin.ai.approved")}</Badge> : null}
        </span>
      ),
    },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (m) => (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setErrors({});
            setModelForm(m);
          }}
        >
          {t("admin.common.edit")}
        </Button>
      ),
    },
  ];

  const pf = provForm === "new" ? null : provForm;
  const mf = modelForm === "new" ? null : modelForm;
  const parseProvider = (fd: FormData, reason: string) => providerSchema.safeParse({ name: text(fd, "name"), kind: text(fd, "kind"), enabled: flag(fd, "enabled"), baseUrlLabel: text(fd, "label"), reason });
  const modelInput = (fd: FormData) => ({ providerId: text(fd, "provider"), model: text(fd, "model"), tier: text(fd, "tier"), input: text(fd, "input"), output: text(fd, "output"), cached: text(fd, "cached"), maxOutputTokens: text(fd, "max"), enabled: flag(fd, "enabled"), approvedFallback: flag(fd, "approved") });

  return (
    <>
      <PageHead title={t("admin.models.pageTitle")} subtitle={t("admin.models.pageSubtitle")} />
      <p className="hint-box">{t("admin.providers.envNote")}</p>

      <h2 className="group-title">{t("admin.providers.title")}</h2>
      <div className="row" style={{ marginBottom: "var(--space-3)" }}>
        <Button
          onClick={() => {
            setErrors({});
            setProvForm("new");
          }}
        >
          {t("admin.providers.new")}
        </Button>
      </div>
      <Async state={providers} isEmpty={(d) => d.length === 0}>
        {(d) => <DataTable caption={t("admin.providers.title")} columns={provCols} rows={d} rowKey={(p) => p.id} />}
      </Async>

      <h2 className="group-title">{t("admin.models.title")}</h2>
      <div className="row" style={{ marginBottom: "var(--space-3)" }}>
        <Button
          disabled={(providers.data?.length ?? 0) === 0}
          onClick={() => {
            setErrors({});
            setModelForm("new");
          }}
        >
          {t("admin.models.new")}
        </Button>
        <span className="um-muted">{t("admin.models.unit")}</span>
      </div>
      <Async state={models} isEmpty={(d) => d.length === 0}>
        {(d) => <DataTable caption={t("admin.models.title")} columns={modelCols} rows={d} rowKey={(m) => m.id} />}
      </Async>

      <ReasonDialog
        open={provForm !== null}
        title={pf ? t("admin.providers.edit") : t("admin.providers.new")}
        confirmLabel={t("admin.common.save")}
        onClose={() => setProvForm(null)}
        validate={(fd) => {
          const r = parseProvider(fd, "valid");
          const e = r.success ? {} : fieldErrors(r.error);
          setErrors(e);
          return r.success ? null : e;
        }}
        onConfirm={async (reason, fd) => {
          const v = providerSchema.parse({ name: text(fd, "name"), kind: text(fd, "kind"), enabled: flag(fd, "enabled"), baseUrlLabel: text(fd, "label") });
          await api.setProvider({ ...v, reason });
          toast.ok();
          reload();
        }}
      >
        <div className="stack" key={pf?.id ?? "new"}>
          <Input name="name" label={t("admin.providers.name")} hint={t("admin.providers.nameHint")} defaultValue={pf?.name ?? ""} readOnly={pf !== null} error={errors.name && t(errors.name)} />
          <Select name="kind" label={t("admin.providers.kind")} defaultValue={pf?.kind ?? "openai"}>
            {PROVIDER_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`admin.ai.kind.${k}`)}
              </option>
            ))}
          </Select>
          <Input name="label" label={t("admin.providers.label")} hint={t("admin.providers.labelHint")} defaultValue={pf?.base_url_label ?? ""} maxLength={100} error={errors.baseUrlLabel && t(errors.baseUrlLabel)} />
          <label className="row">
            <input type="checkbox" name="enabled" defaultChecked={pf?.enabled ?? true} />
            <span>{t("admin.ai.enabled")}</span>
          </label>
        </div>
      </ReasonDialog>

      <ReasonDialog
        open={modelForm !== null}
        title={mf ? t("admin.models.edit") : t("admin.models.new")}
        body={t("admin.models.priceHint")}
        confirmLabel={t("admin.common.save")}
        onClose={() => setModelForm(null)}
        validate={(fd) => {
          const r = modelSchema.safeParse(modelInput(fd));
          const e: Record<string, MessageKey> = r.success ? {} : fieldErrors(r.error);
          if (r.success && mf) {
            const edited: ModelLite = { id: mf.id, model: r.data.model, tier: r.data.tier, input_micro_usd_per_mtok: r.data.input, output_micro_usd_per_mtok: r.data.output, cached_input_micro_usd_per_mtok: r.data.cached, enabled: r.data.enabled, approved_fallback: r.data.approvedFallback };
            if (breaksRoute(edited, models.data ?? [], routes.data ?? [])) e.input = "admin.models.errBreaksRoute";
          }
          setErrors(e);
          return Object.keys(e).length > 0 ? e : null;
        }}
        onConfirm={async (reason, fd) => {
          const v = modelSchema.parse(modelInput(fd));
          await api.setModel({ ...v, reason });
          toast.ok();
          reload();
        }}
      >
        <div className="stack" key={mf?.id ?? "new"}>
          <Select name="provider" label={t("admin.models.provider")} defaultValue={mf?.provider_id ?? providers.data?.[0]?.id ?? ""} disabled={mf !== null}>
            {(providers.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {/* A disabled select is not submitted: keep the provider in the form for edits. */}
          {mf ? <input type="hidden" name="provider" value={mf.provider_id} /> : null}
          <Input name="model" label={t("admin.models.model")} defaultValue={mf?.model ?? ""} readOnly={mf !== null} maxLength={200} error={errors.model && t(errors.model)} />
          <Select name="tier" label={t("admin.models.tier")} defaultValue={mf?.tier ?? "standard"}>
            {AI_TIERS.map((k) => (
              <option key={k} value={k}>
                {t(`admin.ai.tier.${k}`)}
              </option>
            ))}
          </Select>
          <div className="form-grid">
            <Input name="input" label={t("admin.models.input")} inputMode="decimal" defaultValue={mf ? microToUsdString(mf.input_micro_usd_per_mtok) : ""} error={errors.input && t(errors.input)} />
            <Input name="output" label={t("admin.models.output")} inputMode="decimal" defaultValue={mf ? microToUsdString(mf.output_micro_usd_per_mtok) : ""} error={errors.output && t(errors.output)} />
            <Input name="cached" label={t("admin.models.cached")} inputMode="decimal" defaultValue={mf ? microToUsdString(mf.cached_input_micro_usd_per_mtok) : ""} error={errors.cached && t(errors.cached)} />
          </div>
          <Input name="max" label={t("admin.models.maxTokens")} inputMode="numeric" defaultValue={mf ? String(mf.max_output_tokens) : "4096"} error={errors.maxOutputTokens && t(errors.maxOutputTokens)} />
          <label className="row">
            <input type="checkbox" name="enabled" defaultChecked={mf?.enabled ?? true} />
            <span>{t("admin.ai.enabled")}</span>
          </label>
          <label className="row">
            <input type="checkbox" name="approved" defaultChecked={mf?.approved_fallback ?? false} />
            <span>{t("admin.models.approved")}</span>
          </label>
        </div>
      </ReasonDialog>
    </>
  );
}
