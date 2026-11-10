"use client";

import { Badge, Button, Card, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import Link from "next/link";
import { useState } from "react";
import { Async, DataTable, PageHead, Pager, useActDialog, useAdminApi, useActionToast, type Column } from "../../components/kit";
import type { ExpiringRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

const WINDOWS = [7, 14, 30, 90] as const;

export function SubscriptionsPage() {
  const { t, number, dateTime } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const [days, setDays] = useState<number>(14);
  const [page, setPage] = useState(0);
  const state = useAsync(() => api.expiring(days, page), [days, page]);
  const byPlan = useAsync(() => api.subscriptionsByPlan(), []);
  const reload = () => {
    state.reload();
    byPlan.reload();
  };
  const { open, dialog } = useActDialog(reload);

  const sweep = () =>
    open({
      title: t("admin.subscriptions.sweepTitle"),
      body: t("admin.subscriptions.sweepBody"),
      confirm: t("admin.subscriptions.sweep"),
      danger: true,
      hideReason: true,
      run: async () => {
        const n = await api.runExpiry();
        // The generic success toast follows; the count is reported separately and is not optimistic (it is the RPC result).
        toast.ok(t("admin.subscriptions.sweepDone", { n }));
      },
    });

  const columns: Column<ExpiringRow>[] = [
    {
      key: "user",
      header: t("admin.subscriptions.colUser"),
      cell: (r) => (
        <Link href={`/users/${r.user_id}`}>
          <strong>{r.display_name ?? t("admin.users.unnamed")}</strong>
        </Link>
      ),
    },
    { key: "plan", header: t("admin.subscriptions.colPlan"), cell: (r) => `${t(`admin.users.planName.${r.plan}`)} · ${t(`admin.users.source.${r.source}`)}` },
    { key: "ends", header: t("admin.subscriptions.colEnds"), cell: (r) => dateTime(r.current_period_end, { dateStyle: "medium", timeStyle: "short" }) },
    { key: "state", header: t("admin.subscriptions.colState"), cell: (r) => <Badge tone={r.overdue ? "danger" : "warning"}>{r.overdue ? t("admin.subscriptions.overdue") : t("admin.subscriptions.upcoming")}</Badge> },
  ];

  return (
    <>
      <PageHead title={t("admin.subscriptions.title")} subtitle={t("admin.subscriptions.subtitle")} actions={<Button variant="danger" onClick={sweep}>{t("admin.subscriptions.sweep")}</Button>} />
      <div className="grid-2">
        <Card>
          <h2 className="group-title" style={{ marginTop: 0 }}>
            {t("admin.subscriptions.byPlan")}
          </h2>
          <Async state={byPlan} isEmpty={(d) => d.length === 0}>
            {(rows) => (
              <ul className="list">
                {rows.map((r) => (
                  <li key={`${r.plan}-${r.source}`} className="list-item">
                    <span>
                      {t(`admin.users.planName.${r.plan}`)} · {r.source === "manual" ? t("admin.users.source.manual") : t("admin.users.source.paid")}
                    </span>
                    <Badge tone="primary">{number(r.n)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Async>
        </Card>
      </div>
      <div style={{ maxWidth: 260, margin: "var(--space-5) 0 var(--space-4)" }}>
        <Select
          label={t("admin.subscriptions.window")}
          value={String(days)}
          onChange={(e) => {
            setDays(Number(e.target.value));
            setPage(0);
          }}
        >
          {WINDOWS.map((d) => (
            <option key={d} value={d}>
              {number(d)}
            </option>
          ))}
        </Select>
      </div>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.subscriptions.title")} columns={columns} rows={d.rows} rowKey={(r) => r.subscription_id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      {dialog}
    </>
  );
}
