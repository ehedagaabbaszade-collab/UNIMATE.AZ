"use client";

import { Badge, Button, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { Async, DataTable, PageHead, Pager, SearchBox, TabPanel, TabsNav, useActDialog, useAdminApi, type Column } from "../../components/kit";
import type { CommunityRow, PendingEventRow, PendingResourceRow, RemovedRow, ReportRow, TakedownRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

type Tab = "reports" | "takedowns" | "resources" | "events" | "removed" | "communities";

export function ModerationPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("reports");
  const items = [
    { id: "reports", label: t("admin.moderation.reports") },
    { id: "takedowns", label: t("admin.moderation.takedowns") },
    { id: "resources", label: t("admin.moderation.resources") },
    { id: "events", label: t("admin.moderation.events") },
    { id: "removed", label: t("admin.moderation.removed") },
    { id: "communities", label: t("admin.moderation.communities") },
  ] as const;
  return (
    <>
      <PageHead title={t("admin.moderation.title")} subtitle={t("admin.moderation.anonymityNote")} />
      <TabsNav label={t("admin.moderation.tabs")} items={items} active={tab} onChange={setTab} />
      <TabPanel id={tab}>
        {tab === "reports" ? <Reports /> : null}
        {tab === "takedowns" ? <Takedowns /> : null}
        {tab === "resources" ? <PendingResources /> : null}
        {tab === "events" ? <PendingEvents /> : null}
        {tab === "removed" ? <Removed /> : null}
        {tab === "communities" ? <Communities /> : null}
      </TabPanel>
    </>
  );
}

function Reports() {
  const { t, dateTime } = useI18n();
  const api = useAdminApi();
  const [status, setStatus] = useState<ReportRow["status"]>("open");
  const [page, setPage] = useState(0);
  const state = useAsync(() => api.reports(status, page), [status, page]);
  const { open, dialog } = useActDialog(state.reload);

  const resolve = (r: ReportRow, to: "reviewing" | "actioned" | "dismissed", confirm: string) =>
    open({ title: t("admin.moderation.resolveTitle"), confirm, run: async (reason) => void (await api.resolveReport(r.report_id, to, reason)) });
  const remove = (r: ReportRow) =>
    open({
      title: t("admin.moderation.removeTitle"),
      confirm: t("admin.moderation.removeContent"),
      danger: true,
      run: async (reason) => {
        await api.moderateContent(r.target_kind, r.target_id, "remove", reason);
        // Close the report too; if it was already resolved elsewhere the removal still stands.
        await api.resolveReport(r.report_id, "actioned", reason).catch(() => undefined);
      },
    });

  const columns: Column<ReportRow>[] = [
    { key: "kind", header: t("admin.moderation.colKind"), cell: (r) => <Badge tone="primary">{t(`admin.moderation.kind.${r.target_kind}`)}</Badge> },
    { key: "cat", header: t("admin.moderation.colCategory"), cell: (r) => r.category },
    { key: "excerpt", header: t("admin.moderation.colExcerpt"), cell: (r) => r.excerpt || t("admin.common.none") },
    { key: "reason", header: t("admin.moderation.colReason"), cell: (r) => r.reason },
    { key: "created", header: t("admin.common.created"), cell: (r) => dateTime(r.created_at, { dateStyle: "medium", timeStyle: "short" }) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) =>
        r.status === "open" || r.status === "reviewing" ? (
          <span className="row">
            {r.status === "open" ? (
              <Button size="sm" variant="ghost" onClick={() => resolve(r, "reviewing", t("admin.moderation.markReviewing"))}>
                {t("admin.moderation.markReviewing")}
              </Button>
            ) : null}
            {r.target_kind === "post" || r.target_kind === "comment" || r.target_kind === "resource" ? (
              <Button size="sm" variant="danger" onClick={() => remove(r)}>
                {t("admin.moderation.removeContent")}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => resolve(r, "actioned", t("admin.moderation.markActioned"))}>
              {t("admin.moderation.markActioned")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => resolve(r, "dismissed", t("admin.moderation.dismiss"))}>
              {t("admin.moderation.dismiss")}
            </Button>
          </span>
        ) : (
          <Badge>{t(`admin.moderation.reportStatus.${r.status}`)}</Badge>
        ),
    },
  ];
  return (
    <>
      <div style={{ maxWidth: 260, marginBottom: "var(--space-4)" }}>
        <Select
          label={t("admin.common.status")}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ReportRow["status"]);
            setPage(0);
          }}
        >
          {(["open", "reviewing", "actioned", "dismissed"] as const).map((s) => (
            <option key={s} value={s}>
              {t(`admin.moderation.reportStatus.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.moderation.reports")} columns={columns} rows={d.rows} rowKey={(r) => r.report_id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      {dialog}
    </>
  );
}

function Takedowns() {
  const { t, dateTime } = useI18n();
  const api = useAdminApi();
  const [page, setPage] = useState(0);
  const state = useAsync(() => api.takedowns(page), [page]);
  const { open, dialog } = useActDialog(state.reload);
  const decide = (r: TakedownRow, decision: "accepted" | "rejected", confirm: string, danger: boolean) =>
    open({ title: t("admin.moderation.takedownTitle"), confirm, danger, run: async (reason) => void (await api.resolveTakedown(r.id, decision, reason)) });
  const columns: Column<TakedownRow>[] = [
    { key: "res", header: t("admin.moderation.colResource"), cell: (r) => <strong>{r.resource?.title ?? t("admin.common.none")}</strong> },
    { key: "reason", header: t("admin.moderation.colReason"), cell: (r) => r.reason },
    { key: "req", header: t("admin.moderation.colRequested"), cell: (r) => dateTime(r.created_at, { dateStyle: "medium", timeStyle: "short" }) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          <Button size="sm" variant="danger" onClick={() => decide(r, "accepted", t("admin.moderation.acceptTakedown"), true)}>
            {t("admin.moderation.acceptTakedown")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => decide(r, "rejected", t("admin.moderation.rejectTakedown"), false)}>
            {t("admin.moderation.rejectTakedown")}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.moderation.takedowns")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      {dialog}
    </>
  );
}

function PendingResources() {
  const { t, dateTime } = useI18n();
  const api = useAdminApi();
  const [page, setPage] = useState(0);
  const state = useAsync(() => api.pendingResources(page), [page]);
  const { open, dialog } = useActDialog(state.reload);
  const review = (r: PendingResourceRow, action: "approve" | "reject", confirm: string) =>
    open({ title: t("admin.moderation.reviewTitle"), confirm, danger: action === "reject", run: async (reason) => void (await api.reviewContent("resource", r.id, action, reason)) });
  const columns: Column<PendingResourceRow>[] = [
    { key: "title", header: t("admin.moderation.colTitle"), cell: (r) => <strong>{r.title}</strong> },
    { key: "hold", header: t("admin.moderation.colHold"), cell: (r) => (r.takedown_hold ? <Badge tone="warning">{t("admin.common.yes")}</Badge> : t("admin.common.no")) },
    { key: "created", header: t("admin.common.created"), cell: (r) => dateTime(r.created_at, { dateStyle: "medium", timeStyle: "short" }) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          <Button size="sm" onClick={() => review(r, "approve", t("admin.moderation.approve"))}>
            {t("admin.moderation.approve")}
          </Button>
          <Button size="sm" variant="danger" onClick={() => review(r, "reject", t("admin.moderation.reject"))}>
            {t("admin.moderation.reject")}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.moderation.resources")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      {dialog}
    </>
  );
}

function PendingEvents() {
  const { t, dateTime } = useI18n();
  const api = useAdminApi();
  const [page, setPage] = useState(0);
  const state = useAsync(() => api.pendingEvents(page), [page]);
  const { open, dialog } = useActDialog(state.reload);
  // moderate_event takes no reason parameter: a plain confirmation (it is still audited by the database).
  const review = (r: PendingEventRow, approve: boolean, confirm: string) =>
    open({ title: t("admin.moderation.reviewTitle"), confirm, danger: !approve, hideReason: true, run: async () => void (await api.moderateEvent(r.id, approve)) });
  const columns: Column<PendingEventRow>[] = [
    { key: "title", header: t("admin.moderation.colTitle"), cell: (r) => <strong>{r.title}</strong> },
    { key: "starts", header: t("admin.moderation.kind.event"), cell: (r) => dateTime(r.starts_at, { dateStyle: "medium", timeStyle: "short" }) },
    { key: "created", header: t("admin.common.created"), cell: (r) => dateTime(r.created_at, { dateStyle: "medium", timeStyle: "short" }) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          <Button size="sm" onClick={() => review(r, true, t("admin.moderation.approve"))}>
            {t("admin.moderation.approve")}
          </Button>
          <Button size="sm" variant="danger" onClick={() => review(r, false, t("admin.moderation.reject"))}>
            {t("admin.moderation.reject")}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.moderation.events")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      {dialog}
    </>
  );
}

function Removed() {
  const { t, dateTime } = useI18n();
  const api = useAdminApi();
  const [kind, setKind] = useState<"resource" | "event">("resource");
  const [page, setPage] = useState(0);
  const state = useAsync(() => api.removed(kind, page), [kind, page]);
  const { open, dialog } = useActDialog(state.reload);
  const restore = (r: RemovedRow) =>
    open({ title: t("admin.moderation.restoreTitle"), body: t("admin.moderation.restoreBody"), confirm: t("admin.moderation.restore"), run: async (reason) => void (await api.moderateContent(kind, r.id, "restore", reason)) });
  const columns: Column<RemovedRow>[] = [
    { key: "title", header: t("admin.moderation.colTitle"), cell: (r) => <strong>{r.title}</strong> },
    { key: "upd", header: t("admin.moderation.colUpdated"), cell: (r) => dateTime(r.updated_at, { dateStyle: "medium", timeStyle: "short" }) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <Button size="sm" variant="secondary" onClick={() => restore(r)}>
          {t("admin.moderation.restore")}
        </Button>
      ),
    },
  ];
  return (
    <>
      <div style={{ maxWidth: 260, marginBottom: "var(--space-4)" }}>
        <Select
          label={t("admin.moderation.colKind")}
          value={kind}
          onChange={(e) => {
            setKind(e.target.value === "event" ? "event" : "resource");
            setPage(0);
          }}
        >
          <option value="resource">{t("admin.moderation.kind.resource")}</option>
          <option value="event">{t("admin.moderation.kind.event")}</option>
        </Select>
      </div>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.moderation.removed")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      {dialog}
    </>
  );
}

function Communities() {
  const { t, number, dateTime } = useI18n();
  const api = useAdminApi();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const state = useAsync(() => api.communities(search, page), [search, page]);
  const columns: Column<CommunityRow>[] = [
    { key: "name", header: t("admin.common.name"), cell: (r) => <strong>{r.name}</strong> },
    { key: "vis", header: t("admin.moderation.colVisibility"), cell: (r) => (r.visibility === "public" || r.visibility === "private" ? t(`admin.moderation.visibility.${r.visibility}`) : r.visibility) },
    { key: "mem", header: t("admin.moderation.colMembers"), cell: (r) => number(r.members) },
    { key: "rep", header: t("admin.moderation.colOpenReports"), cell: (r) => <Badge tone={r.open_reports > 0 ? "danger" : "neutral"}>{number(r.open_reports)}</Badge> },
    { key: "created", header: t("admin.common.created"), cell: (r) => dateTime(r.created_at, { dateStyle: "medium" }) },
  ];
  return (
    <>
      <SearchBox
        label={t("admin.common.search")}
        value={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(0);
        }}
      />
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.moderation.communities")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
    </>
  );
}
