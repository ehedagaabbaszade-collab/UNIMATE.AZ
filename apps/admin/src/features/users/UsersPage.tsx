"use client";

import { Badge } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import Link from "next/link";
import { useState } from "react";
import { Async, DataTable, PageHead, Pager, SearchBox, useAdminApi, type Column } from "../../components/kit";
import type { UserRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

export function RoleBadge({ role }: { role: UserRow["role"] }) {
  const { t } = useI18n();
  return <Badge tone={role === "student" ? "neutral" : role === "super_admin" ? "danger" : "primary"}>{t(`admin.role.${role}`)}</Badge>;
}

export function UsersPage() {
  const { t, date } = useI18n();
  const api = useAdminApi();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const state = useAsync(() => api.listUsers(search, page), [search, page]);

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: t("admin.users.colName"),
      cell: (u) => (
        <Link href={`/users/${u.id}`}>
          <strong>{u.display_name ?? t("admin.users.unnamed")}</strong>
          {u.username ? <span className="um-muted"> @{u.username}</span> : null}
        </Link>
      ),
    },
    { key: "role", header: t("admin.users.colRole"), cell: (u) => <RoleBadge role={u.role} /> },
    { key: "uni", header: t("admin.users.colUniversity"), cell: (u) => u.university_name ?? t("admin.common.none") },
    { key: "plan", header: t("admin.users.colPlan"), cell: (u) => <Badge tone={u.plan === "free" ? "neutral" : "success"}>{t(`admin.users.planName.${u.plan}`)}</Badge> },
    { key: "created", header: t("admin.users.colCreated"), cell: (u) => date(u.created_at, { dateStyle: "medium" }) },
    { key: "status", header: t("admin.users.colStatus"), cell: (u) => <Badge tone={u.suspended ? "danger" : "success"}>{u.suspended ? t("admin.users.suspended") : t("admin.users.active")}</Badge> },
  ];

  return (
    <>
      <PageHead title={t("admin.users.title")} subtitle={t("admin.users.emailNote")} />
      <SearchBox
        label={t("admin.users.searchLabel")}
        value={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(0);
        }}
      />
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.users.title")} columns={columns} rows={d.rows} rowKey={(u) => u.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
    </>
  );
}
