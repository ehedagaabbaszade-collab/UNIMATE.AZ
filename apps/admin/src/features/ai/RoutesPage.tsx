"use client";

import { Badge, Button, Input, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { useState } from "react";
import { Async, DataTable, PageHead, ReasonDialog, useActDialog, useActionToast, useAdminApi, type Column } from "../../components/kit";
import { AI_PLANS, AI_TASKS, routeIssues, type AiTask } from "../../lib/ai-config";
import { routeSchema } from "../../lib/ai-schemas";
import type { RouteRow } from "../../lib/rpc";
import { fieldErrors } from "../../lib/schemas";
import { useAsync } from "../../lib/use-async";

type Plan = (typeof AI_PLANS)[number];
interface Target {
  task: AiTask;
  plan: Plan;
  route: RouteRow | null;
}
const FALLBACK_SLOTS = [1, 2, 3] as const;

export function RoutesPage() {
  const { t, number } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const routes = useAsync(() => api.routes(), []);
  const models = useAsync(() => api.models(), []);
  const [target, setTarget] = useState<Target | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const [issues, setIssues] = useState<MessageKey[]>([]);
  const reload = () => routes.reload();
  const { open, dialog } = useActDialog(reload);
  const byId = new Map((models.data ?? []).map((m) => [m.id, m]));
  const name = (id: string) => byId.get(id)?.model ?? id;
  const find = (task: AiTask, plan: Plan) => routes.data?.find((r) => r.task === task && r.plan === plan) ?? null;

  const edit = (task: AiTask, plan: Plan) => {
    setErrors({});
    setIssues([]);
    setTarget({ task, plan, route: find(task, plan) });
  };
  const remove = (task: AiTask, plan: Plan) =>
    open({
      title: t("admin.routes.deleteTitle"),
      body: t("admin.routes.deleteBody", { task: t(`admin.ai.task.${task}`), plan: t(`admin.users.planName.${plan}`) }),
      confirm: t("admin.common.delete"),
      danger: true,
      run: async (reason) => void (await api.deleteRoute(task, plan, reason)),
    });

  const columns: Column<AiTask>[] = [
    { key: "task", header: t("admin.routes.colTask"), cell: (task) => <strong>{t(`admin.ai.task.${task}`)}</strong> },
    ...AI_PLANS.map((plan) => ({
      key: plan,
      header: t(`admin.users.planName.${plan}`),
      cell: (task: AiTask) => {
        const r = find(task, plan);
        return (
          <div className="stack" style={{ gap: "var(--space-2)" }}>
            {r ? (
              <>
                <span>
                  <strong>{name(r.primary_model_id)}</strong>
                </span>
                <span className="um-muted">{r.fallback_model_ids.length > 0 ? `${t("admin.routes.fallbacks")}: ${r.fallback_model_ids.map(name).join(" → ")}` : t("admin.routes.noFallbacks")}</span>
                <span className="um-muted">{t("admin.routes.rate", { n: number(r.rate_limit_per_min) })}</span>
              </>
            ) : (
              <Badge tone="warning">{t("admin.routes.notConfigured")}</Badge>
            )}
            <span className="row">
              <Button size="sm" variant="secondary" onClick={() => edit(task, plan)} disabled={(models.data?.length ?? 0) === 0}>
                {r ? t("admin.common.edit") : t("admin.routes.configure")}
              </Button>
              {r ? (
                <Button size="sm" variant="ghost" onClick={() => remove(task, plan)}>
                  {t("admin.common.delete")}
                </Button>
              ) : null}
            </span>
          </div>
        );
      },
    })),
  ];

  const input = (fd: FormData) => ({
    task: target?.task,
    plan: target?.plan,
    primary: String(fd.get("primary") ?? ""),
    fallbacks: FALLBACK_SLOTS.map((i) => String(fd.get(`fb${i}`) ?? "")).filter(Boolean),
    rateLimit: String(fd.get("rate") ?? ""),
  });
  const enabledModels = (models.data ?? []).filter((m) => m.enabled);

  return (
    <>
      <PageHead title={t("admin.routes.title")} subtitle={t("admin.routes.subtitle")} />
      <p className="hint-box">{t("admin.routes.rule")}</p>
      <div style={{ marginTop: "var(--space-4)" }}>
        <Async state={routes}>{() => <DataTable caption={t("admin.routes.title")} columns={columns} rows={[...AI_TASKS]} rowKey={(x) => x} />}</Async>
      </div>
      {dialog}
      <ReasonDialog
        open={target !== null}
        title={target ? t("admin.routes.editTitle", { task: t(`admin.ai.task.${target.task}`), plan: t(`admin.users.planName.${target.plan}`) }) : ""}
        confirmLabel={t("admin.common.save")}
        onClose={() => setTarget(null)}
        validate={(fd) => {
          const v = input(fd);
          const r = routeSchema.safeParse(v);
          const e: Record<string, MessageKey> = r.success ? {} : fieldErrors(r.error);
          const found = routeIssues(byId.get(v.primary), v.fallbacks.flatMap((f) => byId.get(f) ?? []));
          if (v.fallbacks.length !== new Set(v.fallbacks).size) found.push("admin.routes.errDuplicate");
          setIssues([...new Set(found)]);
          if (found.length > 0) e.primary = found[0]!;
          setErrors(e);
          return Object.keys(e).length > 0 ? e : null;
        }}
        onConfirm={async (reason, fd) => {
          const v = routeSchema.parse(input(fd));
          await api.setRoute({ ...v, reason });
          toast.ok();
          reload();
        }}
      >
        <div className="stack" key={target ? `${target.task}-${target.plan}` : "none"}>
          <Select name="primary" label={t("admin.routes.primary")} defaultValue={target?.route?.primary_model_id ?? enabledModels[0]?.id ?? ""} error={errors.primary && t(errors.primary)}>
            {enabledModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.model}
              </option>
            ))}
          </Select>
          {FALLBACK_SLOTS.map((i) => (
            <Select key={i} name={`fb${i}`} label={t("admin.routes.fallbackN", { n: number(i) })} defaultValue={target?.route?.fallback_model_ids[i - 1] ?? ""}>
              <option value="">{t("admin.common.none")}</option>
              {enabledModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.model}
                  {m.approved_fallback ? "" : ` (${t("admin.routes.notApprovedShort")})`}
                </option>
              ))}
            </Select>
          ))}
          <Input name="rate" label={t("admin.routes.rateLimit")} hint={t("admin.routes.rateHint")} inputMode="numeric" defaultValue={String(target?.route?.rate_limit_per_min ?? 20)} error={errors.rateLimit && t(errors.rateLimit)} />
          {issues.length > 1 ? (
            <ul className="err-box" role="alert">
              {issues.map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </ReasonDialog>
    </>
  );
}
