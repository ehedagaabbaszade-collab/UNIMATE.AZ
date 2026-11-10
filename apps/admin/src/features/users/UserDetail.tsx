"use client";

import { Badge, Button, Card, Input, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import Link from "next/link";
import { useState } from "react";
import { Async, DataTable, PageHead, ReasonDialog, useActionToast, useAdminApi, type Column } from "../../components/kit";
import { useStaff } from "../../components/staff";
import { APP_ROLES, canChangeRoles } from "../../lib/guard";
import type { SubscriptionRow } from "../../lib/rpc";
import { fieldErrors, grantPlanSchema, PLANS, roleChangeSchema } from "../../lib/schemas";
import { useAsync } from "../../lib/use-async";
import { RoleBadge } from "./UsersPage";

type Dialog = "suspend" | "restore" | "role" | "plan" | null;

export function UserDetail({ userId }: { userId: string }) {
  const { t, date, dateTime } = useI18n();
  const api = useAdminApi();
  const me = useStaff();
  const toast = useActionToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const user = useAsync(async () => (await api.listUsers(userId, 0)).rows.find((u) => u.id === userId) ?? null, [userId]);
  const subs = useAsync(() => api.userSubscriptions(userId), [userId]);
  const reloadAll = () => {
    user.reload();
    subs.reload();
  };
  const isSelf = userId === me.id;

  const subColumns: Column<SubscriptionRow>[] = [
    { key: "plan", header: t("admin.users.plan"), cell: (s) => t(`admin.users.planName.${s.plan}`) },
    { key: "status", header: t("admin.common.status"), cell: (s) => <Badge tone={s.status === "active" || s.status === "trialing" ? "success" : "neutral"}>{t(`admin.users.subStatus.${s.status}`)}</Badge> },
    { key: "source", header: t("admin.users.colSource"), cell: (s) => t(`admin.users.source.${s.source}`) },
    { key: "ends", header: t("admin.users.colEnds"), cell: (s) => (s.current_period_end ? dateTime(s.current_period_end, { dateStyle: "medium", timeStyle: "short" }) : t("admin.common.none")) },
    { key: "reason", header: t("admin.users.colReason"), cell: (s) => s.grant_reason ?? t("admin.common.none") },
  ];

  return (
    <>
      <p>
        <Link href="/users">← {t("admin.users.title")}</Link>
      </p>
      <Async state={user} isEmpty={(u) => u === null}>
        {(u) =>
          u && (
            <div className="stack-lg">
              <PageHead title={u.display_name ?? t("admin.users.unnamed")} subtitle={t("admin.users.detailTitle")} />
              <Card>
                <dl className="kv">
                  <dt>{t("admin.users.id")}</dt>
                  <dd>
                    <code>{u.id}</code>
                  </dd>
                  <dt>{t("admin.users.username")}</dt>
                  <dd>{u.username ?? t("admin.common.none")}</dd>
                  <dt>{t("admin.users.colRole")}</dt>
                  <dd>
                    <RoleBadge role={u.role} />
                  </dd>
                  <dt>{t("admin.users.colUniversity")}</dt>
                  <dd>{u.university_name ?? t("admin.common.none")}</dd>
                  <dt>{t("admin.users.effectivePlan")}</dt>
                  <dd>
                    <Badge tone={u.plan === "free" ? "neutral" : "success"}>{t(`admin.users.planName.${u.plan}`)}</Badge>
                  </dd>
                  <dt>{t("admin.users.colCreated")}</dt>
                  <dd>{date(u.created_at, { dateStyle: "medium" })}</dd>
                  <dt>{t("admin.users.colStatus")}</dt>
                  <dd>
                    <Badge tone={u.suspended ? "danger" : "success"}>{u.suspended ? t("admin.users.suspended") : t("admin.users.active")}</Badge>
                  </dd>
                </dl>
              </Card>

              <Card>
                <h2 className="group-title" style={{ marginTop: 0 }}>
                  {t("admin.users.roleSection")}
                </h2>
                {canChangeRoles(me.role) && !isSelf ? (
                  <Button variant="secondary" onClick={() => setDialog("role")}>
                    {t("admin.users.roleChange")}
                  </Button>
                ) : (
                  <p className="um-muted">{t("admin.users.roleOnlySuper")}</p>
                )}
              </Card>

              <Card>
                <h2 className="group-title" style={{ marginTop: 0 }}>
                  {t("admin.users.planSection")}
                </h2>
                <div className="row">
                  <Button variant="secondary" onClick={() => setDialog("plan")}>
                    {t("admin.users.grantPlan")}
                  </Button>
                  {u.role === "student" && !isSelf ? (
                    u.suspended ? (
                      <Button variant="secondary" onClick={() => setDialog("restore")}>
                        {t("admin.users.restore")}
                      </Button>
                    ) : (
                      <Button variant="danger" onClick={() => setDialog("suspend")}>
                        {t("admin.users.suspend")}
                      </Button>
                    )
                  ) : null}
                </div>
              </Card>

              <section>
                <h2 className="group-title">{t("admin.users.subscriptions")}</h2>
                <Async state={subs} isEmpty={(d) => d.length === 0}>
                  {(rows) => <DataTable caption={t("admin.users.subscriptions")} columns={subColumns} rows={rows} rowKey={(s) => s.id} />}
                </Async>
              </section>

              <ReasonDialog
                open={dialog === "suspend" || dialog === "restore"}
                title={dialog === "restore" ? t("admin.users.restoreTitle") : t("admin.users.suspendTitle")}
                body={dialog === "restore" ? t("admin.users.restoreBody") : t("admin.users.suspendBody")}
                confirmLabel={dialog === "restore" ? t("admin.users.restore") : t("admin.users.suspend")}
                danger={dialog === "suspend"}
                onClose={() => setDialog(null)}
                onConfirm={async (reason) => {
                  await api.setSuspended(userId, dialog === "suspend", reason);
                  toast.ok();
                  reloadAll();
                }}
              />
              <ReasonDialog
                open={dialog === "role"}
                title={t("admin.users.roleTitle")}
                body={t("admin.users.roleBody")}
                confirmLabel={t("admin.users.roleChange")}
                danger
                onClose={() => setDialog(null)}
                validate={(fd) => {
                  const r = roleChangeSchema.safeParse({ role: fd.get("role"), reason: "valid" });
                  return r.success ? null : fieldErrors(r.error);
                }}
                onConfirm={async (reason, fd) => {
                  const parsed = roleChangeSchema.parse({ role: fd.get("role"), reason });
                  await api.setRole(userId, parsed.role, parsed.reason);
                  toast.ok();
                  reloadAll();
                }}
              >
                <Select name="role" label={t("admin.users.newRole")} defaultValue={u.role}>
                  {APP_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`admin.role.${r}`)}
                    </option>
                  ))}
                </Select>
              </ReasonDialog>
              <GrantPlanDialog
                open={dialog === "plan"}
                onClose={() => setDialog(null)}
                onGrant={async (v) => {
                  await api.grantPlan(userId, v.plan, v.until, v.reason);
                  toast.ok();
                  reloadAll();
                }}
              />
            </div>
          )
        }
      </Async>
    </>
  );
}

function GrantPlanDialog({ open, onClose, onGrant }: { open: boolean; onClose: () => void; onGrant: (v: { plan: string; until: string | null; reason: string }) => Promise<void> }) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<string>("plus");
  const [untilError, setUntilError] = useState<MessageKey | null>(null);
  return (
    <ReasonDialog
      open={open}
      title={t("admin.users.grantTitle")}
      body={t("admin.users.grantBody")}
      confirmLabel={t("admin.users.grantPlan")}
      onClose={onClose}
      validate={(fd) => {
        const r = grantPlanSchema().safeParse({ plan: fd.get("plan"), until: String(fd.get("until") ?? ""), reason: "valid" });
        if (r.success) {
          setUntilError(null);
          return null;
        }
        const errs = fieldErrors(r.error);
        setUntilError(errs.until ?? null);
        return errs;
      }}
      onConfirm={async (reason, fd) => {
        const parsed = grantPlanSchema().parse({ plan: fd.get("plan"), until: String(fd.get("until") ?? ""), reason });
        await onGrant(parsed);
      }}
    >
      <Select name="plan" label={t("admin.users.plan")} value={plan} onChange={(e) => setPlan(e.target.value)}>
        {PLANS.map((p) => (
          <option key={p} value={p}>
            {t(`admin.users.planName.${p}`)}
          </option>
        ))}
      </Select>
      {plan !== "free" ? <Input name="until" type="datetime-local" label={t("admin.users.until")} hint={t("admin.users.untilHint")} error={untilError ? t(untilError) : undefined} /> : null}
    </ReasonDialog>
  );
}
