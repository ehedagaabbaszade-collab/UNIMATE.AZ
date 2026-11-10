"use client";

import { courseLabel, type NoteListItem } from "@unimate/core";
import { Badge, Card, Icon } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import Link from "next/link";

/** Read-only star row. */
export function Stars({ value, count }: { value: number; count?: number }) {
  const { t, number } = useI18n();
  const rounded = Math.round(value);
  const empty = (count ?? 1) === 0;
  const avg = number(value, { maximumFractionDigits: 1 });
  return (
    <span className="row" style={{ gap: 6, flexWrap: "nowrap" }} role="img" aria-label={empty ? t("notes.noRating") : t("notes.ratingValue", { n: avg })}>
      <span className="row" style={{ gap: 2, flexWrap: "nowrap", color: "var(--color-warning, #D97706)" }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} style={{ opacity: !empty && i <= rounded ? 1 : 0.3 }}>
            <Icon name="rating" size="sm" />
          </span>
        ))}
      </span>
      <span className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
        {empty ? t("notes.noRating") : `${avg}${count !== undefined ? ` · ${t("notes.ratingCount", { n: count })}` : ""}`}
      </span>
    </span>
  );
}

/** 1-5 stars as a radio group (keyboard: arrow keys / space). */
export function StarInput({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div role="radiogroup" aria-label={t("notes.reviews.yourRating")} className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <label key={i} style={{ cursor: disabled ? "default" : "pointer", color: "var(--color-warning, #D97706)", opacity: i <= value ? 1 : 0.3 }}>
          <input
            type="radio"
            name="note-rating"
            className="um-sr-only"
            value={i}
            checked={i === value}
            disabled={disabled}
            aria-label={t("notes.reviews.ratingStar", { n: i })}
            onChange={() => onChange(i)}
          />
          <Icon name="rating" size="lg" />
        </label>
      ))}
    </div>
  );
}

export function NoteCard({ item }: { item: NoteListItem }) {
  const { t, date } = useI18n();
  const course = courseLabel({ code: item.courseCode, title: item.courseTitle });
  return (
    <Card className="doc-card">
      <div className="row row--between">
        <Badge tone="info">{t(`notes.kind.${item.kind}`)}</Badge>
        {item.saved ? <Icon name="saved" size="sm" label={t("notes.tabs.saved")} /> : null}
      </div>
      <h3>
        <Link href={`/notes/${item.id}`}>{item.title}</Link>
      </h3>
      {course ? <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>{course}</p> : null}
      <Stars value={item.avgRating} count={item.ratingCount} />
      <p className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
        {[t("notes.by", { name: item.uploaderName ?? t("notes.anonymous") }), date(item.createdAt)].join(" · ")}
      </p>
    </Card>
  );
}
