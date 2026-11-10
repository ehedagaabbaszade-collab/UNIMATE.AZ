"use client";

import { Badge, Card } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Async, PageHead, useAdminApi } from "../../components/kit";
import { useStaff } from "../../components/staff";
import { atLeast } from "../../lib/guard";
import { useAsync } from "../../lib/use-async";

function Stat({ label, value, href, tone }: { label: string; value: number | undefined; href?: string; tone?: "danger" | "warning" }) {
  const { number } = useI18n();
  const body = (
    <Card>
      <span className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
        {label}
      </span>
      <span className="stat" style={tone === "danger" && (value ?? 0) > 0 ? { color: "var(--danger)" } : tone === "warning" && (value ?? 0) > 0 ? { color: "var(--warning)" } : undefined}>
        {value === undefined ? "–" : number(value)}
      </span>
    </Card>
  );
  return href ? (
    <Link href={href} className="link-reset">
      {body}
    </Link>
  ) : (
    body
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="group-title">{title}</h2>
      <div className="grid-stats">{children}</div>
    </section>
  );
}

export function Dashboard() {
  const { t, number } = useI18n();
  const api = useAdminApi();
  const staff = useStaff();
  const isAdmin = atLeast(staff.role, "admin");
  const counters = useAsync(() => api.counters(), []);
  const docs = useAsync(() => api.documentsByStatus(), [], isAdmin);
  const jobs = useAsync(() => api.jobsByState(), [], isAdmin);

  const jobTotal = (state: string) => (jobs.data ?? []).filter((j) => j.state === state).reduce((a, j) => a + j.n, 0);
  const failedJobs = jobTotal("failed") + jobTotal("dead");

  return (
    <>
      <PageHead title={t("admin.dashboard.title")} subtitle={t("admin.dashboard.subtitle")} />
      <p className="hint-box" style={{ marginBottom: "var(--space-4)" }}>
        {t("admin.mfaNote")}
      </p>
      <Async state={counters}>
        {(c) => (
          <div className="stack-lg">
            <Group title={t("admin.dashboard.moderationGroup")}>
              <Stat label={t("admin.dashboard.openReports")} value={c.open_reports} href="/moderation" tone="danger" />
              <Stat label={t("admin.dashboard.openTakedowns")} value={c.open_takedowns} href="/moderation" tone="danger" />
              <Stat label={t("admin.dashboard.pendingResources")} value={c.pending_resources} href="/moderation" tone="warning" />
              <Stat label={t("admin.dashboard.pendingEvents")} value={c.pending_events} href="/moderation" tone="warning" />
            </Group>
            {isAdmin ? (
              <>
                <Group title={t("admin.dashboard.platform")}>
                  <Stat label={t("admin.dashboard.users")} value={c.users_total} href="/users" />
                  <Stat label={t("admin.dashboard.usersSuspended")} value={c.users_suspended} href="/users" tone="warning" />
                </Group>
                <Group title={t("admin.dashboard.billingGroup")}>
                  <Stat label={t("admin.dashboard.expiring")} value={c.expiring_subscriptions_7d} href="/subscriptions" tone="warning" />
                  <Stat label={t("admin.dashboard.overdue")} value={c.overdue_subscriptions} href="/subscriptions" tone="danger" />
                </Group>
                <Group title={t("admin.dashboard.dataGroup")}>
                  <Stat label={t("admin.dashboard.unverified")} value={c.unverified_institutions} href="/academic" tone="warning" />
                </Group>
              </>
            ) : (
              <p className="um-muted">{t("admin.dashboard.moderationOnly")}</p>
            )}
          </div>
        )}
      </Async>
      {isAdmin ? (
        <div className="grid-2" style={{ marginTop: "var(--space-5)" }}>
          <Card>
            <h2 className="group-title" style={{ marginTop: 0 }}>
              {t("admin.dashboard.documents")}
            </h2>
            <Async state={docs} isEmpty={(d) => d.length === 0}>
              {(rows) => (
                <ul className="list">
                  {rows.map((r) => (
                    <li key={r.status} className="list-item">
                      <span>{t(`admin.docStatus.${r.status as "ready"}`)}</span>
                      <Badge tone={r.status === "failed" ? "danger" : r.status === "ready" ? "success" : "neutral"}>{number(r.n)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Async>
          </Card>
          <Card>
            <h2 className="group-title" style={{ marginTop: 0 }}>
              {t("admin.dashboard.queue")}
            </h2>
            <Async state={jobs}>
              {() => (
                <ul className="list">
                  <li className="list-item">
                    <span>{t("admin.dashboard.queued")}</span>
                    <Badge>{number(jobTotal("queued"))}</Badge>
                  </li>
                  <li className="list-item">
                    <span>{t("admin.dashboard.running")}</span>
                    <Badge tone="info">{number(jobTotal("running"))}</Badge>
                  </li>
                  <li className="list-item">
                    <span>{t("admin.dashboard.failedJobs")}</span>
                    <Badge tone={failedJobs > 0 ? "danger" : "neutral"}>{number(failedJobs)}</Badge>
                  </li>
                </ul>
              )}
            </Async>
          </Card>
        </div>
      ) : null}
    </>
  );
}
