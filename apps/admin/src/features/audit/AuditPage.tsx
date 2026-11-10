"use client";

import { Button, Input } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { useState, type FormEvent } from "react";
import { Async, DataTable, PageHead, Pager, ReasonDialog, useAdminApi, type Column } from "../../components/kit";
import { EMPTY_AUDIT_FILTER, auditCsv, parseAuditFilter } from "../../lib/audit-filter";
import { redact } from "../../lib/redact";
import type { AuditFilter, AuditRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

const short = (id: string) => id.slice(0, 8);

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditPage() {
  const { t, dateTime } = useI18n();
  const api = useAdminApi();
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_AUDIT_FILTER);
  const [errors, setErrors] = useState<Partial<Record<keyof AuditFilter, MessageKey>>>({});
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const state = useAsync(() => api.auditLogs(filter, page), [filter, page]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const g = (k: string) => String(fd.get(k) ?? "");
    const r = parseAuditFilter({ actor: g("actor"), action: g("action"), entityType: g("entityType"), entityId: g("entityId"), from: g("from"), to: g("to") });
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setPage(0);
    setFilter(r.filter);
  };
  const reset = (form: HTMLFormElement | null) => {
    form?.reset();
    setErrors({});
    setPage(0);
    setFilter(EMPTY_AUDIT_FILTER);
  };
  const exportCsv = () => {
    if (!state.data) return;
    const header = [t("admin.audit.colId"), t("admin.audit.colWhen"), t("admin.audit.colActor"), t("admin.audit.colAction"), t("admin.audit.colEntityType"), t("admin.audit.colEntityId"), t("admin.audit.colDetails")];
    download(`audit-${new Date().toISOString().slice(0, 10)}.csv`, auditCsv(state.data.rows, header));
  };

  const columns: Column<AuditRow>[] = [
    { key: "when", header: t("admin.audit.colWhen"), cell: (r) => dateTime(r.created_at, { dateStyle: "medium", timeStyle: "medium" }) },
    { key: "actor", header: t("admin.audit.colActor"), cell: (r) => (r.actor_id ? <span className="mono">{short(r.actor_id)}</span> : t("admin.common.none")) },
    { key: "action", header: t("admin.audit.colAction"), cell: (r) => <code className="mono">{r.action}</code> },
    { key: "target", header: t("admin.audit.colTarget"), cell: (r) => (r.entity_type ? <span className="mono">{`${r.entity_type}${r.entity_id ? `:${r.entity_id.length > 24 ? short(r.entity_id) : r.entity_id}` : ""}`}</span> : t("admin.common.none")) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
          {t("admin.audit.details")}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHead
        title={t("admin.audit.title")}
        subtitle={t("admin.audit.subtitle")}
        actions={
          <Button variant="secondary" onClick={exportCsv} disabled={!state.data || state.data.rows.length === 0}>
            {t("admin.audit.export")}
          </Button>
        }
      />
      <p className="hint-box">{t("admin.audit.appendOnly")}</p>
      <form className="form-grid" style={{ margin: "var(--space-4) 0" }} onSubmit={submit} onReset={() => setErrors({})} noValidate role="search" aria-label={t("admin.audit.filters")}>
        <Input name="actor" label={t("admin.audit.colActor")} hint={t("admin.audit.actorHint")} error={errors.actor && t(errors.actor)} />
        <Input name="action" label={t("admin.audit.colAction")} hint={t("admin.audit.actionHint")} error={errors.action && t(errors.action)} />
        <Input name="entityType" label={t("admin.audit.colEntityType")} error={errors.entityType && t(errors.entityType)} />
        <Input name="entityId" label={t("admin.audit.colEntityId")} error={errors.entityId && t(errors.entityId)} />
        <Input name="from" type="date" label={t("admin.audit.from")} error={errors.from && t(errors.from)} />
        <Input name="to" type="date" label={t("admin.audit.to")} error={errors.to && t(errors.to)} />
        <div className="row span-all">
          <Button type="submit">{t("admin.common.search")}</Button>
          <Button variant="ghost" onClick={(e) => reset(e.currentTarget.form)}>
            {t("admin.common.clear")}
          </Button>
        </div>
      </form>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.audit.title")} columns={columns} rows={d.rows} rowKey={(r) => String(r.id)} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      <ReasonDialog open={detail !== null} hideReason title={detail ? `#${detail.id} · ${detail.action}` : ""} body={t("admin.audit.redactedNote")} confirmLabel={t("admin.common.back")} onClose={() => setDetail(null)} onConfirm={async () => undefined}>
        <dl className="kv">
          <dt>{t("admin.audit.colWhen")}</dt>
          <dd>{detail ? dateTime(detail.created_at, { dateStyle: "medium", timeStyle: "medium" }) : ""}</dd>
          <dt>{t("admin.audit.colActor")}</dt>
          <dd className="mono">{detail?.actor_id ?? t("admin.common.none")}</dd>
          <dt>{t("admin.audit.colTarget")}</dt>
          <dd className="mono">{detail?.entity_type ? `${detail.entity_type}:${detail.entity_id ?? ""}` : t("admin.common.none")}</dd>
        </dl>
        <pre className="json-box" tabIndex={0}>
          {detail ? JSON.stringify(redact(detail.metadata), null, 2) : ""}
        </pre>
      </ReasonDialog>
    </>
  );
}
