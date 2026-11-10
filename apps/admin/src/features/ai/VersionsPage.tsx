"use client";

import { Badge, Button } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { Async, DataTable, PageHead, Pager, ReasonDialog, useActDialog, useAdminApi, type Column } from "../../components/kit";
import { diffSnapshots, type DiffEntry } from "../../lib/ai-config";
import { PAGE_SIZE, type ConfigVersionRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

interface Item {
  row: ConfigVersionRow;
  diff: DiffEntry[] | null;
}
const short = (id: string) => id.slice(0, 8);

export function VersionsPage() {
  const { t, dateTime, number } = useI18n();
  const api = useAdminApi();
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<Item | null>(null);
  const state = useAsync(() => api.configVersions(page), [page]);
  const { open, dialog } = useActDialog(state.reload);

  const revert = (v: ConfigVersionRow) =>
    open({
      title: t("admin.versions.revertTitle", { v: number(v.version) }),
      body: t("admin.versions.revertBody"),
      confirm: t("admin.versions.revert"),
      danger: true,
      run: async (reason) => void (await api.revertConfig(v.version, reason)),
    });

  const columns: Column<Item>[] = [
    { key: "v", header: t("admin.versions.colVersion"), cell: ({ row }) => <strong>#{number(row.version)}</strong> },
    { key: "at", header: t("admin.versions.colWhen"), cell: ({ row }) => dateTime(row.created_at, { dateStyle: "medium", timeStyle: "short" }) },
    { key: "action", header: t("admin.versions.colAction"), cell: ({ row }) => <code className="mono">{row.action}</code> },
    { key: "actor", header: t("admin.versions.colActor"), cell: ({ row }) => (row.actor_id ? <span className="mono">{short(row.actor_id)}</span> : t("admin.common.none")) },
    { key: "reason", header: t("admin.common.reason"), cell: ({ row }) => row.reason ?? t("admin.common.none") },
    {
      key: "diff",
      header: t("admin.versions.colChanges"),
      cell: ({ diff }) => {
        if (diff === null) return <Badge>{t("admin.versions.baseline")}</Badge>;
        const c = (k: DiffEntry["change"]) => diff.filter((d) => d.change === k).length;
        return t("admin.versions.summary", { changed: number(c("changed")), added: number(c("added")), removed: number(c("removed")) });
      },
    },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (it) => (
        <span className="row">
          <Button size="sm" variant="ghost" onClick={() => setDetail(it)} disabled={!it.diff || it.diff.length === 0}>
            {t("admin.versions.details")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => revert(it.row)}>
            {t("admin.versions.revert")}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHead title={t("admin.versions.title")} subtitle={t("admin.versions.subtitle")} />
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => {
          // The query fetched one extra (older) row so every visible version can be compared with its predecessor.
          const items: Item[] = d.rows.slice(0, PAGE_SIZE).map((row, i) => {
            const prev = d.rows[i + 1];
            return { row, diff: prev ? diffSnapshots(prev.snapshot, row.snapshot) : null };
          });
          return (
            <>
              <DataTable caption={t("admin.versions.title")} columns={columns} rows={items} rowKey={(it) => String(it.row.version)} />
              <Pager page={page} total={d.total} onPage={setPage} />
            </>
          );
        }}
      </Async>
      {dialog}
      <ReasonDialog open={detail !== null} hideReason title={detail ? t("admin.versions.detailTitle", { v: number(detail.row.version) }) : ""} confirmLabel={t("admin.common.back")} onClose={() => setDetail(null)} onConfirm={async () => undefined}>
        <ul className="stack">
          {(detail?.diff ?? []).map((d) => (
            <li key={`${d.entity}:${d.id}`}>
              <Badge tone={d.change === "removed" ? "danger" : d.change === "added" ? "success" : "warning"}>{t(`admin.versions.change.${d.change}`)}</Badge> <strong>{t(`admin.versions.entity.${d.entity}`)}</strong> <span className="mono">{short(d.id)}</span>
              {d.fields.length > 0 ? <span className="um-muted"> — {d.fields.join(", ")}</span> : null}
            </li>
          ))}
        </ul>
      </ReasonDialog>
    </>
  );
}
