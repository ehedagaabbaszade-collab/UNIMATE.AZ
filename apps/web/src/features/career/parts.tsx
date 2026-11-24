"use client";

import { deadlineView, todayInBaku, type OpportunityKind, type OpportunityListItem, type TrackStatus } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Card, Icon, type BadgeTone, type IconName } from "@unimate/ui";
import Link from "next/link";

export const KIND_ICON: Record<OpportunityKind, IconName> = {
  internship: "internship",
  junior_job: "jobs",
  scholarship: "scholarship",
  exchange: "development",
  competition: "achievements",
  hackathon: "challenges",
  career_event: "event",
};
export const STATUS_TONE: Record<TrackStatus, BadgeTone> = { saved: "neutral", applied: "info", interview: "warning", offer: "success", rejected: "danger" };

/** Single-choice chip group (keyboard accessible buttons with aria-pressed). */
export function Chips<T extends string>({ label, value, onChange, options, className = "" }: { label: string; value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: string }>; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`row ${className}`.trim()} style={{ gap: 8 }}>
      {options.map((o) => (
        <button key={o.value} type="button" className="cite-chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Deadline text with a countdown, coloured by urgency. Dates are compared as calendar days in Azerbaijan (UTC+4). */
export function DeadlineLabel({ deadline }: { deadline: string | null }) {
  const { t } = useI18n();
  const v = deadlineView(deadline, todayInBaku());
  const text =
    v.state === "none" ? t("career.deadline.none") : v.state === "today" ? t("career.deadline.today") : v.state === "expired" ? t("career.deadline.passed", { n: v.days }) : t("career.deadline.left", { n: v.days });
  const color = v.state === "expired" ? "var(--danger)" : v.state === "today" || v.state === "soon" ? "var(--warning, #B45309)" : "var(--text-muted)";
  return <span style={{ color, fontSize: "var(--text-sm)", fontWeight: v.state === "soon" || v.state === "today" ? 700 : 400 }}>{text}</span>;
}

export function OpportunityCard({ item }: { item: OpportunityListItem }) {
  const { t } = useI18n();
  return (
    <Card className="doc-card">
      <div className="row">
        <Icon name={KIND_ICON[item.kind]} size="sm" />
        <Badge tone="info">{t(`career.kindOne.${item.kind}`)}</Badge>
        {item.remote ? <Badge>{t("career.card.remote")}</Badge> : null}
        {item.trackedStatus ? <Badge tone={STATUS_TONE[item.trackedStatus]}>{t("career.card.trackedAs", { status: t(`career.status.${item.trackedStatus}`) })}</Badge> : null}
      </div>
      <h3>
        <Link href={`/career/${item.id}`}>{item.title}</Link>
      </h3>
      <p className="row" style={{ gap: 6 }}>
        <span className="um-muted">{item.organizationName}</span>
        {item.organizationVerified ? <Icon name="success" size="sm" label={t("career.card.verified")} /> : null}
      </p>
      {item.location ? <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>{item.location}</p> : null}
      <DeadlineLabel deadline={item.deadline} />
    </Card>
  );
}
