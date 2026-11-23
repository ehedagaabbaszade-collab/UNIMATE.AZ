"use client";

import { Badge, Button, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import { useState } from "react";
import { Async, DataTable, PageHead, Pager, useActDialog, useAdminApi, type Column } from "../../components/kit";
import type { UniversityRequestRow } from "../../lib/rpc";
import { useAsync } from "../../lib/use-async";

const STATUSES = ["pending", "approved", "rejected"] as const;
const TONE = { pending: "warning", approved: "success", rejected: "danger", none: "neutral" } as const;

export function UniversitiesPage() {
  const { t, dateTime } = useI18n();
  const api = useAdminApi();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  const [page, setPage] = useState(0);
  const state = useAsync(() => api.universityRequests(status, page), [status, page]);
  const { open, dialog } = useActDialog(state.reload);

  // Reject needs a note (the student sees why); approve's note is optional. A 40001 (user changed university) surfaces via the dialog error.
  const review = (r: UniversityRequestRow, approve: boolean) =>
    open({
      title: approve ? t("admin.universities.approveTitle") : t("admin.universities.rejectTitle"),
      body: t("admin.universities.noteHint"),
      confirm: approve ? t("admin.universities.approve") : t("admin.universities.reject"),
      danger: !approve,
      reasonRequired: !approve,
      run: async (note) => {
        if (!r.university_id) return;
        await api.reviewUniversity(r.id, r.university_id, approve, note);
      },
    });

  const columns: Column<UniversityRequestRow>[] = [
    { key: "user", header: t("admin.universities.colUser"), cell: (r) => <strong>{r.display_name ?? r.username ?? r.id}</strong> },
    { key: "uni", header: t("admin.universities.colUniversity"), cell: (r) => r.university_name ?? t("admin.common.none") },
    { key: "claimed", header: t("admin.universities.colClaimed"), cell: (r) => dateTime(r.created_at, { dateStyle: "medium", timeStyle: "short" }) },
    { key: "status", header: t("admin.common.status"), cell: (r) => <Badge tone={TONE[r.university_status]}>{t(`admin.universities.status.${r.university_status}`)}</Badge> },
    { key: "note", header: t("admin.universities.colNote"), cell: (r) => r.university_review_note ?? t("admin.common.none") },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          {r.university_status !== "approved" ? (
            <Button size="sm" onClick={() => review(r, true)}>
              {t("admin.universities.approve")}
            </Button>
          ) : null}
          {r.university_status !== "rejected" ? (
            <Button size="sm" variant="danger" onClick={() => review(r, false)}>
              {t("admin.universities.reject")}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <>
      <PageHead title={t("admin.universities.title")} subtitle={t("admin.universities.subtitle")} />
      <div style={{ maxWidth: 260, marginBottom: "var(--space-4)" }}>
        <Select
          label={t("admin.common.status")}
          value={status}
          onChange={(e) => {
            setStatus(STATUSES.find((s) => s === e.target.value) ?? "pending");
            setPage(0);
          }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`admin.universities.status.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.universities.title")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      {dialog}
    </>
  );
}
