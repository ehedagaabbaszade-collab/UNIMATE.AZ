"use client";

import { Badge, Button, Card, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { BarList, LineChart, Meter } from "../../components/charts";
import { Async, DataTable, PageHead, TabPanel, TabsNav, useActDialog, useActionToast, useAdminApi, type Column } from "../../components/kit";
import { AI_TASKS, formatUsd, meterTone, ratePct, utilisationPct, type AiTask } from "../../lib/ai-config";
import type { CostBucketRow, FailureRateRow, StuckRow, TopSpenderRow, UtilisationRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

const TASK_SET = new Set<string>(AI_TASKS);

const GROUPS = ["model", "provider", "task", "plan"] as const;
type Group = (typeof GROUPS)[number];
const DAYS = [7, 30, 90] as const;
const STUCK_MINUTES = [15, 30, 60, 120] as const;

export function CostPage() {
  const { t, number } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const [days, setDays] = useState<number>(30);
  const [group, setGroup] = useState<Group>("model");
  const [stuckMin, setStuckMin] = useState<number>(30);
  const byDay = useAsync(() => api.costBreakdown(days, "day"), [days]);
  const byGroup = useAsync(() => api.costBreakdown(days, group), [days, group]);
  const top = useAsync(() => api.topSpenders(days), [days]);
  const util = useAsync(() => api.budgetUtilisation(), []);
  const fail = useAsync(() => api.failureRates(days), [days]);
  const stuck = useAsync(() => api.stuckReservations(stuckMin), [stuckMin]);
  const { open, dialog } = useActDialog(() => {
    stuck.reload();
    util.reload();
  });

  const sweep = () =>
    open({
      title: t("admin.cost.sweepTitle"),
      body: t("admin.cost.sweepBody", { m: number(stuckMin) }),
      confirm: t("admin.cost.sweep"),
      danger: true,
      run: async (reason) => {
        const n = await api.sweepReservations(stuckMin, reason);
        toast.ok(t("admin.cost.sweepDone", { n }));
      },
    });

  const tryTask = (b: string) => (TASK_SET.has(b) ? t(`admin.ai.task.${b as AiTask}`) : b);
  const bucketLabel = (b: string) => (group === "task" ? tryTask(b) : b);
  const totalCost = (byDay.data ?? []).reduce((a, r) => a + r.cost_micro_usd, 0);
  const totalReq = (byDay.data ?? []).reduce((a, r) => a + r.requests, 0);
  const totalTok = (byDay.data ?? []).reduce((a, r) => a + r.input_tokens + r.output_tokens, 0);

  const groupCols: Column<CostBucketRow>[] = [
    { key: "b", header: t(`admin.cost.group.${group}`), cell: (r) => <strong>{bucketLabel(r.bucket)}</strong> },
    { key: "req", header: t("admin.cost.colRequests"), cell: (r) => number(r.requests) },
    { key: "in", header: t("admin.cost.colInput"), cell: (r) => number(r.input_tokens) },
    { key: "out", header: t("admin.cost.colOutput"), cell: (r) => number(r.output_tokens) },
    { key: "cached", header: t("admin.cost.colCached"), cell: (r) => number(r.cached_input_tokens) },
    { key: "cost", header: t("admin.cost.colCost"), cell: (r) => formatUsd(r.cost_micro_usd) },
  ];
  const topCols: Column<TopSpenderRow>[] = [
    { key: "id", header: t("admin.cost.colUserId"), cell: (r) => <span className="mono">{r.user_id}</span> },
    { key: "req", header: t("admin.cost.colRequests"), cell: (r) => number(r.requests) },
    { key: "cost", header: t("admin.cost.colCost"), cell: (r) => formatUsd(r.cost_micro_usd) },
  ];
  const failCols: Column<FailureRateRow>[] = [
    { key: "task", header: t("admin.cost.group.task"), cell: (r) => <strong>{tryTask(r.task)}</strong> },
    { key: "req", header: t("admin.cost.colRequests"), cell: (r) => number(r.requests) },
    { key: "fb", header: t("admin.cost.colFailBilled"), cell: (r) => `${number(r.failed_billable)} (${number(ratePct(r.failed_billable, r.requests))}%)` },
    { key: "fu", header: t("admin.cost.colFailUnbilled"), cell: (r) => `${number(r.failed_unbilled)} (${number(ratePct(r.failed_unbilled, r.requests))}%)` },
    { key: "fall", header: t("admin.cost.colFallback"), cell: (r) => `${number(r.fallback_used)} (${number(ratePct(r.fallback_used, r.requests))}%)` },
  ];
  const stuckCols: Column<StuckRow>[] = [
    { key: "req", header: t("admin.cost.colRequestId"), cell: (r) => <span className="mono">{r.request_id}</span> },
    { key: "user", header: t("admin.cost.colUserId"), cell: (r) => <span className="mono">{r.user_id}</span> },
    { key: "task", header: t("admin.cost.group.task"), cell: (r) => (r.task ? tryTask(r.task) : t("admin.common.none")) },
    { key: "est", header: t("admin.cost.colEstimate"), cell: (r) => formatUsd(r.estimate_micro_usd) },
    { key: "age", header: t("admin.cost.colAge"), cell: (r) => t("admin.cost.minutes", { n: number(r.age_minutes) }) },
  ];
  const utilRow = (r: UtilisationRow) => {
    const pct = utilisationPct(r.spent_micro_usd, r.reserved_micro_usd, r.hard_limit_micro_usd);
    const label = `${t(`admin.ai.scope.${r.scope}`)} · ${r.key === "*" ? t("admin.budgets.allKey") : r.key.length > 12 ? r.key.slice(0, 8) : r.key} · ${t(`admin.ai.period.${r.period}`)}`;
    return (
      <li key={`${r.scope}:${r.key}:${r.period}`} className="row row--between" style={{ gap: "var(--space-4)" }}>
        <span>{label}</span>
        <span className="row" style={{ flex: 1, minWidth: 200 }}>
          <span style={{ flex: 1 }}>
            <Meter label={label} pct={pct} tone={meterTone(pct)} />
          </span>
          <span>{pct === null ? t("admin.budgets.blocked") : `${number(pct, { maximumFractionDigits: 2 })}%`}</span>
        </span>
      </li>
    );
  };

  return (
    <>
      <PageHead title={t("admin.cost.title")} subtitle={t("admin.cost.subtitle")} />
      <div style={{ maxWidth: 240, marginBottom: "var(--space-4)" }}>
        <Select label={t("admin.analytics.window")} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {t("admin.analytics.lastDays", { n: number(d) })}
            </option>
          ))}
        </Select>
      </div>

      <Async state={byDay}>
        {(d) => (
          <div className="stack-lg">
            <div className="grid-stats">
              <Card>
                <span className="um-muted">{t("admin.cost.totalCost")}</span>
                <span className="stat">{formatUsd(totalCost)}</span>
              </Card>
              <Card>
                <span className="um-muted">{t("admin.cost.colRequests")}</span>
                <span className="stat">{number(totalReq)}</span>
              </Card>
              <Card>
                <span className="um-muted">{t("admin.cost.totalTokens")}</span>
                <span className="stat">{number(totalTok)}</span>
              </Card>
            </div>
            <Card>
              <LineChart title={t("admin.cost.byDay")} labels={d.map((r) => r.bucket.slice(5))} series={[{ label: t("admin.cost.colCost"), values: d.map((r) => r.cost_micro_usd) }]} format={formatUsd} />
            </Card>
          </div>
        )}
      </Async>

      <h2 className="group-title">{t("admin.cost.breakdown")}</h2>
      <TabsNav label={t("admin.cost.breakdown")} items={GROUPS.map((g) => ({ id: g, label: t(`admin.cost.group.${g}`) }))} active={group} onChange={setGroup} />
      <TabPanel id={group}>
        <Async state={byGroup} isEmpty={(d) => d.length === 0}>
          {(d) => (
            <div className="stack">
              <BarList title={t(`admin.cost.group.${group}`)} items={[...d].sort((a, b) => b.cost_micro_usd - a.cost_micro_usd).map((r) => ({ label: bucketLabel(r.bucket), value: r.cost_micro_usd, display: formatUsd(r.cost_micro_usd) }))} />
              <DataTable caption={t(`admin.cost.group.${group}`)} columns={groupCols} rows={d} rowKey={(r) => r.bucket} />
            </div>
          )}
        </Async>
      </TabPanel>

      <h2 className="group-title">{t("admin.cost.budgetStatus")}</h2>
      <Async state={util} isEmpty={(d) => d.length === 0}>
        {(d) => (
          <Card>
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {d.map(utilRow)}
            </ul>
          </Card>
        )}
      </Async>

      <h2 className="group-title">{t("admin.cost.failures")}</h2>
      <Async state={fail} isEmpty={(d) => d.length === 0}>
        {(d) => <DataTable caption={t("admin.cost.failures")} columns={failCols} rows={d} rowKey={(r) => r.task} />}
      </Async>

      <h2 className="group-title">{t("admin.cost.topSpenders")}</h2>
      <p className="um-muted">{t("admin.cost.topNote")}</p>
      <Async state={top} isEmpty={(d) => d.length === 0}>
        {(d) => <DataTable caption={t("admin.cost.topSpenders")} columns={topCols} rows={d} rowKey={(r) => r.user_id} />}
      </Async>

      <h2 className="group-title">{t("admin.cost.stuck")}</h2>
      <div className="row" style={{ alignItems: "flex-end", marginBottom: "var(--space-3)" }}>
        <div style={{ minWidth: 200 }}>
          <Select label={t("admin.cost.olderThan")} value={String(stuckMin)} onChange={(e) => setStuckMin(Number(e.target.value))}>
            {STUCK_MINUTES.map((m) => (
              <option key={m} value={m}>
                {t("admin.cost.minutes", { n: number(m) })}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="danger" onClick={sweep} disabled={(stuck.data?.length ?? 0) === 0}>
          {t("admin.cost.sweep")}
        </Button>
        {stuck.data && stuck.data.length > 0 ? <Badge tone="warning">{number(stuck.data.length)}</Badge> : null}
      </div>
      <Async state={stuck} isEmpty={(d) => d.length === 0}>
        {(d) => <DataTable caption={t("admin.cost.stuck")} columns={stuckCols} rows={d} rowKey={(r) => r.request_id} />}
      </Async>
      {dialog}
    </>
  );
}
