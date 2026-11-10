"use client";

import { Badge, Button, Input, Select, Textarea } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { useState } from "react";
import { Async, DataTable, PageHead, Pager, ReasonDialog, SearchBox, TabPanel, TabsNav, useActionToast, useAdminApi, type Column } from "../../components/kit";
import type { OpportunityRow, OrganizationRow } from "../../lib/rpc";
import { fieldErrors, formObject, LANGS, OPPORTUNITY_KINDS, opportunitySchema, organizationSchema } from "../../lib/schemas";
import { useAsync } from "../../lib/use-async";

type Tab = "organizations" | "opportunities";

export function CareerPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("opportunities");
  const items = [
    { id: "opportunities", label: t("admin.career.opportunities") },
    { id: "organizations", label: t("admin.career.organizations") },
  ] as const;
  return (
    <>
      <PageHead title={t("admin.career.title")} />
      <TabsNav label={t("admin.career.tabs")} items={items} active={tab} onChange={setTab} />
      <TabPanel id={tab}>{tab === "organizations" ? <Organizations /> : <Opportunities />}</TabPanel>
    </>
  );
}

function Organizations() {
  const { t } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<OrganizationRow | "new" | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const state = useAsync(() => api.organizations(search, page), [search, page]);
  const editing = edit && edit !== "new" ? edit : null;
  const columns: Column<OrganizationRow>[] = [
    { key: "name", header: t("admin.common.name"), cell: (r) => <strong>{r.name}</strong> },
    { key: "web", header: t("admin.career.website"), cell: (r) => (r.website ? <a href={r.website} target="_blank" rel="noopener noreferrer">{r.website}</a> : t("admin.common.none")) },
    { key: "ver", header: t("admin.career.colVerified"), cell: (r) => <Badge tone={r.verified ? "success" : "neutral"}>{r.verified ? t("admin.common.yes") : t("admin.common.no")}</Badge> },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <Button size="sm" variant="ghost" onClick={() => { setErrors({}); setEdit(r); }}>
          {t("admin.common.edit")}
        </Button>
      ),
    },
  ];
  return (
    <>
      <div className="row row--between">
        <SearchBox label={t("admin.common.search")} value={search} onSearch={(v) => { setSearch(v); setPage(0); }} />
        <Button onClick={() => { setErrors({}); setEdit("new"); }}>{t("admin.career.newOrganization")}</Button>
      </div>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.career.organizations")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      <ReasonDialog
        open={edit !== null}
        hideReason
        title={editing ? t("admin.career.editOrganization") : t("admin.career.newOrganization")}
        confirmLabel={t("admin.common.save")}
        onClose={() => setEdit(null)}
        validate={(fd) => {
          const r = organizationSchema.safeParse(formObject(fd, ["verified"]));
          const e = r.success ? {} : fieldErrors(r.error);
          setErrors(e);
          return r.success ? null : e;
        }}
        onConfirm={async (_reason, fd) => {
          const v = organizationSchema.parse(formObject(fd, ["verified"]));
          await api.upsertOrganization({ id: editing?.id ?? null, ...v });
          toast.ok();
          state.reload();
        }}
      >
        <Input name="name" label={t("admin.common.name")} defaultValue={editing?.name ?? ""} error={errors.name && t(errors.name)} />
        <Textarea name="description" label={t("admin.career.description")} rows={3} maxLength={4000} defaultValue={editing?.description ?? ""} error={errors.description && t(errors.description)} />
        <Input name="website" type="url" label={t("admin.career.website")} defaultValue={editing?.website ?? ""} error={errors.website && t(errors.website)} />
        <label className="row">
          <input type="checkbox" name="verified" defaultChecked={editing?.verified ?? false} />
          <span>{t("admin.career.verified")}</span>
        </label>
      </ReasonDialog>
    </>
  );
}

function Opportunities() {
  const { t, dateTime } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<OpportunityRow | "new" | null>(null);
  const [statusFor, setStatusFor] = useState<{ row: OpportunityRow; to: OpportunityRow["status"] } | null>(null);
  const [del, setDel] = useState<OpportunityRow | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const state = useAsync(() => api.opportunities(status, page), [status, page]);
  const orgs = useAsync(() => api.organizationOptions(), []);
  const editing = edit && edit !== "new" ? edit : null;
  const parse = (fd: FormData) => opportunitySchema.safeParse(formObject(fd, ["remote"], ["languages"]));

  const columns: Column<OpportunityRow>[] = [
    { key: "title", header: t("admin.career.titleField"), cell: (r) => <strong>{r.title}</strong> },
    { key: "org", header: t("admin.career.colOrganization"), cell: (r) => r.organizations?.name ?? t("admin.common.none") },
    { key: "kind", header: t("admin.career.kindLabel"), cell: (r) => (Object.hasOwn(KIND_SET, r.kind) ? t(`admin.career.kind.${r.kind as (typeof OPPORTUNITY_KINDS)[number]}`) : r.kind) },
    { key: "dl", header: t("admin.career.colDeadline"), cell: (r) => (r.deadline ? dateTime(`${r.deadline}T00:00:00`, { dateStyle: "medium" }) : t("admin.common.none")) },
    { key: "st", header: t("admin.common.status"), cell: (r) => <Badge tone={r.status === "published" ? "success" : r.status === "draft" ? "warning" : "neutral"}>{t(`admin.career.status.${r.status}`)}</Badge> },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          <Button size="sm" variant="ghost" onClick={() => { setErrors({}); setEdit(r); }}>{t("admin.common.edit")}</Button>
          {r.status !== "published" ? <Button size="sm" onClick={() => setStatusFor({ row: r, to: "published" })}>{t("admin.career.publish")}</Button> : <Button size="sm" variant="secondary" onClick={() => setStatusFor({ row: r, to: "draft" })}>{t("admin.career.toDraft")}</Button>}
          {r.status !== "archived" ? <Button size="sm" variant="secondary" onClick={() => setStatusFor({ row: r, to: "archived" })}>{t("admin.career.archive")}</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => setDel(r)}>{t("admin.common.delete")}</Button>
        </span>
      ),
    },
  ];

  const orgList = orgs.data ?? [];
  return (
    <>
      <div className="row row--between" style={{ alignItems: "flex-end", marginBottom: "var(--space-4)" }}>
        <div style={{ minWidth: 200 }}>
          <Select label={t("admin.common.status")} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="">{t("admin.common.all")}</option>
            {(["draft", "published", "archived"] as const).map((s) => (
              <option key={s} value={s}>{t(`admin.career.status.${s}`)}</option>
            ))}
          </Select>
        </div>
        <Button disabled={orgList.length === 0} onClick={() => { setErrors({}); setEdit("new"); }}>{t("admin.career.newOpportunity")}</Button>
      </div>
      {orgs.data && orgList.length === 0 ? <p className="hint-box" style={{ marginBottom: "var(--space-4)" }}>{t("admin.career.needOrganization")}</p> : null}
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.career.opportunities")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>

      <ReasonDialog
        open={edit !== null}
        hideReason
        title={editing ? t("admin.career.editOpportunity") : t("admin.career.newOpportunity")}
        confirmLabel={t("admin.common.save")}
        onClose={() => setEdit(null)}
        validate={(fd) => {
          const r = parse(fd);
          const e = r.success ? {} : fieldErrors(r.error);
          setErrors(e);
          return r.success ? null : e;
        }}
        onConfirm={async (_reason, fd) => {
          const v = opportunitySchema.parse(formObject(fd, ["remote"], ["languages"]));
          await api.upsertOpportunity({ id: editing?.id ?? null, ...v });
          toast.ok();
          state.reload();
        }}
      >
        <Select name="organizationId" label={t("admin.career.organization")} defaultValue={editing?.organization_id ?? ""} error={errors.organizationId && t(errors.organizationId)}>
          <option value="">{t("admin.common.selectPlaceholder")}</option>
          {orgList.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </Select>
        <Select name="kind" label={t("admin.career.kindLabel")} defaultValue={editing?.kind ?? "internship"}>
          {OPPORTUNITY_KINDS.map((k) => (
            <option key={k} value={k}>{t(`admin.career.kind.${k}`)}</option>
          ))}
        </Select>
        <Input name="title" label={t("admin.career.titleField")} defaultValue={editing?.title ?? ""} error={errors.title && t(errors.title)} />
        <Textarea name="description" label={t("admin.career.description")} rows={4} maxLength={10000} defaultValue={editing?.description ?? ""} error={errors.description && t(errors.description)} />
        <Textarea name="requirements" label={t("admin.career.requirements")} rows={3} maxLength={4000} defaultValue={editing?.requirements ?? ""} error={errors.requirements && t(errors.requirements)} />
        <Input name="location" label={t("admin.career.location")} defaultValue={editing?.location ?? ""} error={errors.location && t(errors.location)} />
        <label className="row">
          <input type="checkbox" name="remote" defaultChecked={editing?.remote ?? false} />
          <span>{t("admin.career.remote")}</span>
        </label>
        <Input name="deadline" type="date" label={t("admin.career.deadline")} defaultValue={editing?.deadline ?? ""} error={errors.deadline && t(errors.deadline)} />
        <Input name="applyUrl" type="url" label={t("admin.career.applyUrl")} defaultValue={editing?.apply_url ?? ""} error={errors.applyUrl && t(errors.applyUrl)} />
        <Input name="skills" label={t("admin.career.skills")} defaultValue={editing?.skills.join(", ") ?? ""} error={errors.skills && t(errors.skills)} />
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="um-label">{t("admin.career.languages")}</legend>
          <div className="checks">
            {LANGS.map((l) => (
              <label key={l}>
                <input type="checkbox" name="languages" value={l} defaultChecked={editing?.languages.includes(l) ?? false} />
                <span>{l.toUpperCase()}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Input name="sourceNote" label={t("admin.career.sourceNote")} defaultValue={editing?.source_note ?? ""} error={errors.sourceNote && t(errors.sourceNote)} />
      </ReasonDialog>

      <ReasonDialog
        open={statusFor !== null}
        reasonRequired={false}
        title={t("admin.career.statusTitle")}
        body={statusFor ? `${statusFor.row.title} → ${t(`admin.career.status.${statusFor.to}`)}` : undefined}
        confirmLabel={statusFor ? t(statusFor.to === "published" ? "admin.career.publish" : statusFor.to === "archived" ? "admin.career.archive" : "admin.career.toDraft") : ""}
        onClose={() => setStatusFor(null)}
        onConfirm={async (reason) => {
          if (!statusFor) return;
          await api.setOpportunityStatus(statusFor.row.id, statusFor.to, reason || null);
          toast.ok();
          state.reload();
        }}
      />
      <ReasonDialog
        open={del !== null}
        title={t("admin.career.deleteTitle")}
        body={del ? `${del.title}. ${t("admin.career.deleteBody")}` : undefined}
        confirmLabel={t("admin.common.delete")}
        danger
        onClose={() => setDel(null)}
        onConfirm={async (reason) => {
          if (!del) return;
          await api.deleteOpportunity(del.id, reason);
          toast.ok();
          state.reload();
        }}
      />
    </>
  );
}

const KIND_SET: Record<string, true> = Object.fromEntries(OPPORTUNITY_KINDS.map((k) => [k, true]));
