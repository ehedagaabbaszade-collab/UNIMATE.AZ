"use client";

import { Badge, Button } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { Async, DataTable, PageHead, Pager, TabPanel, TabsNav, useActDialog, useAdminApi, type Column } from "../../components/kit";
import type { JobFailureRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

const STATES = ["failed", "dead"] as const;
type State = (typeof STATES)[number];
const KINDS = ["extract_text", "chunk", "embed", "summarize", "generate_quiz", "generate_flashcards"] as const;
const JOB_STATES = ["queued", "running", "succeeded", "failed", "dead"] as const;

export function JobsPage() {
  const { t, number, dateTime } = useI18n();
  const api = useAdminApi();
  const [tab, setTab] = useState<State>("failed");
  const [page, setPage] = useState(0);
  const summary = useAsync(() => api.jobsByState(), []);
  const list = useAsync(() => api.processingFailures(tab, page), [tab, page]);
  const { open, dialog } = useActDialog(() => {
    list.reload();
    summary.reload();
  });

  const requeue = (j: JobFailureRow) =>
    open({
      title: t("admin.jobs.requeueTitle"),
      body: t("admin.jobs.requeueBody"),
      confirm: t("admin.jobs.requeue"),
      run: async (reason) => void (await api.requeueJob(j.id, reason)),
    });

  const columns: Column<JobFailureRow>[] = [
    { key: "kind", header: t("admin.jobs.colKind"), cell: (j) => <strong>{t(`admin.jobs.kind.${j.kind as (typeof KINDS)[number]}`)}</strong> },
    { key: "doc", header: t("admin.jobs.colDocument"), cell: (j) => <span className="mono">{j.document_id.slice(0, 8)}</span> },
    { key: "att", header: t("admin.jobs.colAttempts"), cell: (j) => `${number(j.attempts)} / ${number(j.max_attempts)}` },
    { key: "err", header: t("admin.jobs.colError"), cell: (j) => (j.last_error ? <span className="mono">{j.last_error}</span> : t("admin.common.none")) },
    { key: "upd", header: t("admin.jobs.colUpdated"), cell: (j) => dateTime(j.updated_at, { dateStyle: "medium", timeStyle: "short" }) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (j) => (
        <Button size="sm" variant="secondary" onClick={() => requeue(j)}>
          {t("admin.jobs.requeue")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHead title={t("admin.jobs.title")} subtitle={t("admin.jobs.subtitle")} />
      <p className="hint-box">{t("admin.jobs.privacyNote")}</p>
      <h2 className="group-title">{t("admin.jobs.byState")}</h2>
      <Async state={summary} isEmpty={(d) => d.length === 0}>
        {(d) => (
          <DataTable
            caption={t("admin.jobs.byState")}
            rows={KINDS.filter((k) => d.some((r) => r.kind === k))}
            rowKey={(k) => k}
            columns={[
              { key: "k", header: t("admin.jobs.colKind"), cell: (k) => <strong>{t(`admin.jobs.kind.${k}`)}</strong> },
              ...JOB_STATES.map((s) => ({
                key: s,
                header: t(`admin.jobs.state.${s}`),
                cell: (k: (typeof KINDS)[number]) => {
                  const n = d.filter((r) => r.kind === k && r.state === s).reduce((a, r) => a + r.n, 0);
                  return n > 0 && (s === "failed" || s === "dead") ? <Badge tone="danger">{number(n)}</Badge> : number(n);
                },
              })),
            ]}
          />
        )}
      </Async>

      <h2 className="group-title">{t("admin.jobs.failures")}</h2>
      <TabsNav
        label={t("admin.jobs.failures")}
        items={STATES.map((s) => ({ id: s, label: s === "dead" ? t("admin.jobs.deadLetter") : t("admin.jobs.state.failed") }))}
        active={tab}
        onChange={(s) => {
          setTab(s);
          setPage(0);
        }}
      />
      <TabPanel id={tab}>
        <Async state={list} isEmpty={(d) => d.rows.length === 0}>
          {(d) => (
            <>
              <DataTable caption={t("admin.jobs.failures")} columns={columns} rows={d.rows} rowKey={(j) => j.id} />
              <Pager page={page} total={d.total} onPage={setPage} />
            </>
          )}
        </Async>
      </TabPanel>
      {dialog}
    </>
  );
}
