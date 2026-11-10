"use client";

import { TRACK_STATUSES, matchSkills, safeExternalUrl, type TrackStatus } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, EmptyState, ErrorState, Icon, Skeleton, Textarea, useToast } from "@unimate/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { getOpportunity, myCvSkills, myTracking, removeTracking, trackOpportunity } from "./api";
import { Chips, DeadlineLabel, KIND_ICON } from "./parts";

export function OpportunityDetail({ id }: { id: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const detail = useAsync(() => getOpportunity(getBrowserClient(), id), [id]);
  const mine = useAsync(() => myTracking(getBrowserClient()), [id]);
  const cvSkills = useAsync(() => myCvSkills(getBrowserClient()), []);
  const entry = mine.data?.find((i) => i.opportunityId === id);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setNotes(entry?.notes ?? ""), [entry?.id, entry?.notes]);

  const back = (
    <p>
      <Link href="/career">← {t("career.title")}</Link>
    </p>
  );
  if (detail.loading && !detail.data) {
    return (
      <div className="stack-lg">
        {back}
        <Skeleton height={200} />
      </div>
    );
  }
  if (detail.error) {
    return (
      <div className="stack-lg">
        {back}
        <ErrorState title={t("career.loadFailed")} description={detail.error} action={<Button onClick={detail.reload}>{t("common.retry")}</Button>} />
      </div>
    );
  }
  const o = detail.data;
  if (!o) {
    return (
      <div className="stack-lg">
        {back}
        <EmptyState title={t("career.notFound")} description={t("career.notFoundBody")} />
      </div>
    );
  }
  const url = safeExternalUrl(o.applyUrl);
  const site = safeExternalUrl(o.organization.website);
  const match = matchSkills(cvSkills.data ?? [], o.skills);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      mine.reload();
    } catch {
      toast(t("career.detail.trackFailed"), "error");
    } finally {
      setBusy(false);
    }
  };
  const sb = getBrowserClient();

  return (
    <div className="stack-lg">
      {back}
      <Card>
        <div className="stack">
          <div className="row">
            <Icon name={KIND_ICON[o.kind]} size="sm" />
            <Badge tone="info">{t(`career.kindOne.${o.kind}`)}</Badge>
            {o.remote ? <Badge>{t("career.card.remote")}</Badge> : null}
          </div>
          <h1>{o.title}</h1>
          <p className="row" style={{ gap: 6 }}>
            <strong>{o.organization.name}</strong>
            {o.organization.verified ? <Icon name="success" size="sm" label={t("career.card.verified")} /> : null}
          </p>
          {o.location ? <p className="um-muted">{`${t("career.detail.location")}: ${o.location}`}</p> : null}
          <p>
            <DeadlineLabel deadline={o.deadline} />
            {o.deadline ? <span className="um-muted">{` · ${t("career.detail.deadline")}: ${o.deadline}`}</span> : null}
          </p>
          {o.languages.length ? <p className="um-muted">{`${t("career.detail.languages")}: ${o.languages.map((l) => t(`career.lang.${l as "az" | "tr" | "en" | "ru"}`)).join(", ")}`}</p> : null}
          <div className="row">
            {url ? (
              <a className="um-btn um-btn--primary" href={url} target="_blank" rel="noopener noreferrer">
                <Icon name="jobs" size="sm" />
                {t("career.detail.applyCta")}
              </a>
            ) : (
              <span className="um-muted">{t("career.detail.linkBlocked")}</span>
            )}
          </div>
          <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>
            {t("career.detail.applyNote")}
          </p>
        </div>
      </Card>

      <Card>
        <div className="stack">
          <h2>{t("career.detail.track")}</h2>
          {entry ? (
            <>
              <Chips label={t("career.detail.status")} value={entry.status} onChange={(s: TrackStatus) => void run(() => trackOpportunity(sb, id, s))} options={TRACK_STATUSES.map((s) => ({ value: s, label: t(`career.status.${s}`) }))} />
              <Textarea label={t("career.detail.notes")} placeholder={t("career.detail.notesPlaceholder")} rows={4} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <div className="row">
                <Button size="sm" disabled={busy || notes === entry.notes} onClick={() => void run(() => trackOpportunity(sb, id, entry.status, notes))}>
                  {t("career.detail.saveNotes")}
                </Button>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => removeTracking(sb, entry.id))}>
                  {t("career.detail.untrack")}
                </Button>
              </div>
            </>
          ) : (
            <div className="row">
              <Button variant="secondary" loading={busy} onClick={() => void run(() => trackOpportunity(sb, id, "saved"))}>
                <Icon name="saved" size="sm" />
                {t("career.detail.track")}
              </Button>
            </div>
          )}
        </div>
      </Card>

      {o.description ? (
        <Card>
          <h2>{t("career.detail.description")}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{o.description}</p>
        </Card>
      ) : null}
      {o.requirements ? (
        <Card>
          <h2>{t("career.detail.requirements")}</h2>
          <p style={{ whiteSpace: "pre-wrap" }}>{o.requirements}</p>
        </Card>
      ) : null}

      <Card>
        <div className="stack">
          <h2>{t("career.detail.match")}</h2>
          {o.skills.length === 0 ? (
            <p className="um-muted">{t("career.detail.matchNoSkills")}</p>
          ) : !cvSkills.data || cvSkills.data.length === 0 ? (
            <>
              <p className="um-muted">{t("career.detail.matchNoCv")}</p>
              <div className="row">
                {o.skills.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
            </>
          ) : (
            <>
              <p>{t("career.detail.matchBody", { matched: match.matched.length, total: match.matched.length + match.missing.length })}</p>
              {match.matched.length ? (
                <div className="stack">
                  <strong>{t("career.detail.have")}</strong>
                  <div className="row">
                    {match.matched.map((s) => (
                      <Badge key={s} tone="success">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {match.missing.length ? (
                <div className="stack">
                  <strong>{t("career.detail.missing")}</strong>
                  <div className="row">
                    {match.missing.map((s) => (
                      <Badge key={s} tone="warning">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </Card>

      {o.organization.description || site ? (
        <Card>
          <div className="stack">
            <h2>{t("career.detail.organization")}</h2>
            {o.organization.description ? <p style={{ whiteSpace: "pre-wrap" }}>{o.organization.description}</p> : null}
            {site ? (
              <p>
                <a href={site} target="_blank" rel="noopener noreferrer">
                  {t("career.detail.website")}
                </a>
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}
      {o.sourceNote ? <p className="um-muted">{`${t("career.detail.source")}: ${o.sourceNote}`}</p> : null}
    </div>
  );
}
