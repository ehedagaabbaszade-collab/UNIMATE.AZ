"use client";

import { Card, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { BarList, LineChart } from "../../components/charts";
import { Async, DataTable, PageHead, useAdminApi, type Column } from "../../components/kit";
import { ratePct } from "../../lib/ai-config";
import type { CohortRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

const DAYS = [7, 30, 90] as const;

interface Cohort {
  week: string;
  size: number;
  active: Map<number, number>;
}
function groupCohorts(rows: CohortRow[]): Cohort[] {
  const m = new Map<string, Cohort>();
  for (const r of rows) {
    const c = m.get(r.cohort_week) ?? { week: r.cohort_week, size: r.cohort_size, active: new Map<number, number>() };
    c.active.set(r.week_offset, r.active);
    m.set(r.cohort_week, c);
  }
  return [...m.values()].sort((a, b) => (a.week < b.week ? 1 : -1));
}

export function AnalyticsPage() {
  const { t, number, date } = useI18n();
  const api = useAdminApi();
  const [days, setDays] = useState<number>(30);
  const active = useAsync(() => api.activeUsers(days), [days]);
  const learning = useAsync(() => api.learningMetrics(days), [days]);
  const docs = useAsync(() => api.documentsByStatus(), []);
  const cohorts = useAsync(() => api.retention(8), []);
  const day = (iso: string) => date(`${iso}T00:00:00`, { month: "short", day: "numeric" });

  return (
    <>
      <PageHead title={t("admin.analytics.title")} subtitle={t("admin.analytics.subtitle")} />
      <p className="hint-box">{t("admin.analytics.aggregateNote")}</p>
      <div style={{ maxWidth: 240, margin: "var(--space-4) 0" }}>
        <Select label={t("admin.analytics.window")} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {DAYS.map((d) => (
            <option key={d} value={d}>
              {t("admin.analytics.lastDays", { n: number(d) })}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid-2">
        <Card>
          <h2 className="group-title" style={{ marginTop: 0 }}>
            {t("admin.analytics.activeUsers")}
          </h2>
          <p className="um-muted">{t("admin.analytics.activeDef")}</p>
          <Async state={active} isEmpty={(d) => d.length === 0}>
            {(d) => {
              const rows = [...d].sort((a, b) => (a.day < b.day ? -1 : 1));
              return (
                <LineChart
                  title={t("admin.analytics.activeUsers")}
                  labels={rows.map((r) => day(r.day))}
                  series={[
                    { label: t("admin.analytics.dau"), values: rows.map((r) => r.dau) },
                    { label: t("admin.analytics.wau"), values: rows.map((r) => r.wau) },
                  ]}
                />
              );
            }}
          </Async>
        </Card>
        <Card>
          <h2 className="group-title" style={{ marginTop: 0 }}>
            {t("admin.analytics.learning")}
          </h2>
          <p className="um-muted">{t("admin.analytics.learningDef")}</p>
          <Async state={learning} isEmpty={(d) => d.length === 0}>
            {(d) => (
              <div className="stack-lg">
                <LineChart
                  title={t("admin.analytics.quizzesAndCards")}
                  labels={d.map((r) => day(r.day))}
                  series={[
                    { label: t("admin.analytics.quizzes"), values: d.map((r) => r.quizzes_taken) },
                    { label: t("admin.analytics.flashcards"), values: d.map((r) => r.flashcards_reviewed) },
                    { label: t("admin.analytics.uploads"), values: d.map((r) => r.documents_uploaded) },
                  ]}
                />
                <LineChart title={t("admin.analytics.studyMinutes")} labels={d.map((r) => day(r.day))} series={[{ label: t("admin.analytics.studyMinutes"), values: d.map((r) => r.study_minutes) }]} />
              </div>
            )}
          </Async>
        </Card>
      </div>

      <h2 className="group-title">{t("admin.analytics.docsByStatus")}</h2>
      <Async state={docs} isEmpty={(d) => d.length === 0}>
        {(d) => <BarList title={t("admin.analytics.docsByStatus")} items={d.map((r) => ({ label: t(`admin.docStatus.${r.status as "pending_upload" | "uploaded" | "processing" | "ready" | "failed"}`), value: r.n, display: number(r.n) }))} />}
      </Async>

      <h2 className="group-title">{t("admin.analytics.retention")}</h2>
      <p className="um-muted">{t("admin.analytics.retentionDef")}</p>
      <Async state={cohorts} isEmpty={(d) => d.length === 0}>
        {(d) => {
          const groups = groupCohorts(d);
          const maxOffset = Math.max(0, ...d.map((r) => r.week_offset));
          const cols: Column<Cohort>[] = [
            { key: "w", header: t("admin.analytics.cohortWeek"), cell: (c) => <strong>{date(`${c.week}T00:00:00`, { dateStyle: "medium" })}</strong> },
            { key: "size", header: t("admin.analytics.cohortSize"), cell: (c) => number(c.size) },
            ...Array.from({ length: maxOffset + 1 }, (_, k) => ({
              key: `o${k}`,
              header: t("admin.analytics.weekN", { n: number(k) }),
              cell: (c: Cohort) => {
                const a = c.active.get(k);
                return a === undefined ? t("admin.common.none") : `${number(ratePct(a, c.size))}% (${number(a)})`;
              },
            })),
          ];
          return <DataTable caption={t("admin.analytics.retention")} columns={cols} rows={groups} rowKey={(c) => c.week} />;
        }}
      </Async>
    </>
  );
}
