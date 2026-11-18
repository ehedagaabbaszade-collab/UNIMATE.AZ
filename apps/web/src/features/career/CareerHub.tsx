"use client";

import {
  CV_DEFAULT_TEMPLATE,
  CV_LANGUAGES,
  CV_MAX_DOCUMENTS,
  OPPORTUNITY_KINDS,
  OPPORTUNITY_PAGE_SIZE,
  OPPORTUNITY_SORTS,
  TRACK_STATUSES,
  emptyCv,
  groupByStatus,
  safeExternalUrl,
  skillGap,
  todayInBaku,
  type CvLanguage,
  type CvTemplate,
  type OpportunityListItem,
  type TrackStatus,
  type TrackedItem,
} from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Icon, Input, Skeleton, Tabs, useOnlineStatus, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { TemplatePicker } from "./TemplatePicker";
import { InterviewPanel } from "./InterviewPanel";
import { DEFAULT_FILTERS, createCv, deleteCv, listCvs, myCvSkills, myTracking, removeTracking, searchOpportunities, updateTracking, type OpportunityFilters } from "./api";
import { Chips, DeadlineLabel, KIND_ICON, OpportunityCard, STATUS_TONE } from "./parts";

/** Feed with debounced search; keeps the last result visible when offline or on error. */
function Feed() {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const [f, setF] = useState<OpportunityFilters>(DEFAULT_FILTERS);
  const set = <K extends keyof OpportunityFilters>(k: K, v: OpportunityFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  const [items, setItems] = useState<OpportunityListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(f);

  const load = useCallback(
    async (offset: number) => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const rows = await searchOpportunities(getBrowserClient(), f, offset, todayInBaku());
        if (my !== seq.current) return;
        setItems((prev) => (offset === 0 ? rows : [...prev, ...rows]));
        setHasMore(rows.length === OPPORTUNITY_PAGE_SIZE);
        setError(null);
      } catch (e) {
        if (my === seq.current) setError(e instanceof Error ? e.message : "error");
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(() => {
    const id = setTimeout(() => void load(0), f.q || f.skills || f.location ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, f.q, f.skills, f.location]);

  const filtered = key !== JSON.stringify(DEFAULT_FILTERS);
  return (
    <div className="stack-lg">
      <Input label={t("career.search.label")} type="search" placeholder={t("career.search.placeholder")} value={f.q} onChange={(e) => set("q", e.target.value)} />
      <Chips label={t("career.tabs.opportunities")} value={f.kind} onChange={(v) => set("kind", v)} options={[{ value: "", label: t("career.kind.all") }, ...OPPORTUNITY_KINDS.map((k) => ({ value: k, label: t(`career.kind.${k}`) }))]} />
      <details>
        <summary>
          {t("career.filters.location")} · {t("career.filters.closing")} · {t("career.filters.skills")}
        </summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <div className="grid-auto">
            <Input label={t("career.filters.location")} placeholder={t("career.filters.locationPlaceholder")} value={f.location} onChange={(e) => set("location", e.target.value)} />
            <Input label={t("career.filters.skills")} placeholder={t("career.filters.skillsPlaceholder")} value={f.skills} onChange={(e) => set("skills", e.target.value)} />
          </div>
          <Chips label={t("career.filters.workMode")} value={f.remoteOnly ? "remote" : "any"} onChange={(v) => set("remoteOnly", v === "remote")} options={[{ value: "any", label: t("career.filters.anyMode") }, { value: "remote", label: t("career.filters.remoteOnly") }]} />
          <Chips
            label={t("career.filters.closing")}
            value={String(f.closingInDays) as "0" | "7" | "30"}
            onChange={(v) => set("closingInDays", Number(v) as 0 | 7 | 30)}
            options={[{ value: "0", label: t("career.filters.closingAny") }, { value: "7", label: t("career.filters.closing7") }, { value: "30", label: t("career.filters.closing30") }]}
          />
          <Chips label={t("career.filters.sort")} value={f.sort} onChange={(v) => set("sort", v)} options={OPPORTUNITY_SORTS.map((s) => ({ value: s, label: t(s === "deadline" ? "career.filters.sortDeadline" : "career.filters.sortNewest") }))} />
          <Chips label={t("career.filters.expired")} value={f.includeExpired ? "show" : "hide"} onChange={(v) => set("includeExpired", v === "show")} options={[{ value: "hide", label: t("career.filters.expiredHide") }, { value: "show", label: t("career.filters.expiredShow") }]} />
        </div>
      </details>
      {!online ? (
        <p className="um-muted" role="status">
          {t("career.offline")}
        </p>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="grid-auto">
          <Skeleton height={140} />
          <Skeleton height={140} />
        </div>
      ) : error && items.length === 0 ? (
        <ErrorState title={t("career.loadFailed")} description={online ? error : t("career.offline")} action={<Button onClick={() => void load(0)}>{t("common.retry")}</Button>} />
      ) : items.length === 0 ? (
        <EmptyState title={filtered ? t("career.empty.search") : t("career.empty.feed")} {...(filtered ? {} : { description: t("career.empty.feedBody") })} />
      ) : (
        <>
          {error ? (
            <p className="err-box" role="alert">
              {t("career.loadFailed")}
            </p>
          ) : null}
          <div className="grid-auto">
            {items.map((o) => (
              <OpportunityCard key={o.id} item={o} />
            ))}
          </div>
          {hasMore ? (
            <div className="row">
              <Button variant="secondary" loading={loading} onClick={() => void load(items.length)}>
                {t("career.loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function SkillGapCard({ tracked }: { tracked: TrackedItem[] }) {
  const { t } = useI18n();
  const skills = useAsync(() => myCvSkills(getBrowserClient()), []);
  const withSkills = tracked.filter((i) => i.skills.length > 0);
  const gap = skills.data ? skillGap(skills.data, withSkills, 8) : [];
  return (
    <Card>
      <div className="stack">
        <h2 className="row" style={{ gap: 8 }}>
          <Icon name="development" /> {t("career.gap.title")}
        </h2>
        <p className="um-muted">{t("career.gap.body")}</p>
        {skills.loading && !skills.data ? (
          <Skeleton height={48} />
        ) : skills.error ? (
          <p className="um-muted">{t("career.loadFailed")}</p>
        ) : !skills.data || skills.data.length === 0 ? (
          <p>{t("career.gap.noCv")}</p>
        ) : withSkills.length === 0 ? (
          <p>{t("career.gap.noTracked")}</p>
        ) : gap.length === 0 ? (
          <p>{t("career.gap.empty")}</p>
        ) : (
          <>
            <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
              {gap.map((g) => (
                <li key={g.skill} className="row row--between">
                  <Badge tone="warning">{g.skill}</Badge>
                  <span className="um-muted">{t("career.gap.count", { n: g.count })}</span>
                </li>
              ))}
            </ul>
            <p className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
              {t("career.gap.note")}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

function TrackerItem({ item, onChanged }: { item: TrackedItem; onChanged: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch {
      toast(t("career.detail.trackFailed"), "error");
      setBusy(false);
    }
  };
  const url = safeExternalUrl(item.applyUrl);
  return (
    <Card>
      <div className="stack">
        <div className="row">
          <Icon name={KIND_ICON[item.kind] ?? "jobs"} size="sm" />
          <Badge tone={STATUS_TONE[item.status]}>{t(`career.status.${item.status}`)}</Badge>
          {item.listingState === "removed" ? <Badge tone="danger">{t("career.tracker.removed")}</Badge> : item.listingState === "unavailable" ? <Badge tone="warning">{t("career.tracker.unavailable")}</Badge> : null}
        </div>
        <h3>{item.listingState === "published" && item.opportunityId ? <Link href={`/career/${item.opportunityId}`}>{item.title}</Link> : item.title}</h3>
        <p className="um-muted">{item.organization}</p>
        <DeadlineLabel deadline={item.deadline} />
        {item.notes ? <p className="um-muted">{item.notes}</p> : null}
        <Chips label={t("career.tracker.moveTo")} value={item.status} onChange={(s: TrackStatus) => void run(() => updateTracking(getBrowserClient(), item.id, { status: s }))} options={TRACK_STATUSES.map((s) => ({ value: s, label: t(`career.status.${s}`) }))} />
        <div className="row">
          {url && item.listingState === "published" ? (
            <a className="um-btn um-btn--secondary um-btn--sm" href={url} target="_blank" rel="noopener noreferrer">
              {t("career.detail.applyCta")}
            </a>
          ) : null}
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => removeTracking(getBrowserClient(), item.id))}>
            {t("career.tracker.remove")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Tracker() {
  const { t } = useI18n();
  const tracked = useAsync(() => myTracking(getBrowserClient()), []);
  if (tracked.loading && !tracked.data) return <Skeleton height={140} />;
  if (tracked.error && !tracked.data) return <ErrorState title={t("career.loadFailed")} description={tracked.error} action={<Button onClick={tracked.reload}>{t("common.retry")}</Button>} />;
  const items = tracked.data ?? [];
  return (
    <div className="stack-lg">
      <p className="um-muted">{t("career.tracker.intro")}</p>
      <SkillGapCard tracked={items} />
      {items.length === 0 ? (
        <EmptyState title={t("career.empty.tracker")} description={t("career.empty.trackerBody")} />
      ) : (
        groupByStatus(items)
          .filter((c) => c.items.length > 0)
          .map((col) => (
            <section key={col.status} className="stack" aria-label={t(`career.status.${col.status}`)}>
              <h2 className="row" style={{ gap: 8 }}>
                {t(`career.status.${col.status}`)} <span className="um-muted" style={{ fontSize: "var(--text-sm)", fontWeight: 400 }}>{t("career.tracker.count", { n: col.items.length })}</span>
              </h2>
              <div className="grid-auto">
                {col.items.map((i) => (
                  <TrackerItem key={i.id} item={i} onChanged={tracked.reload} />
                ))}
              </div>
            </section>
          ))
      )}
    </div>
  );
}

function CvList() {
  const { t, date, locale } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const user = useUser();
  const cvs = useAsync(() => listCvs(getBrowserClient()), []);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [del, setDel] = useState<{ id: string; title: string } | null>(null);
  const doDelete = async () => {
    const d = del;
    setDel(null);
    if (!d) return;
    try {
      await deleteCv(getBrowserClient(), d.id);
      toast(t("career.cv.deleted"), "success");
      cvs.reload();
    } catch {
      toast(t("career.cv.saveFailed"), "error");
    }
  };
  const [tpl, setTpl] = useState<CvTemplate>(CV_DEFAULT_TEMPLATE);
  const create = async () => {
    setBusy(true);
    const lang: CvLanguage = (CV_LANGUAGES as readonly string[]).includes(locale) ? (locale as CvLanguage) : "az";
    const r = await createCv(getBrowserClient(), user.id, { title: t("career.cv.untitled"), language: lang, template: tpl, data: emptyCv() });
    setBusy(false);
    if (r.ok) router.push(`/career/cv/${r.id}`);
    else toast(r.error === "limit" ? t("career.cv.limit") : t("career.cv.saveFailed"), "error");
  };
  if (cvs.loading && !cvs.data) return <Skeleton height={100} />;
  if (cvs.error && !cvs.data) return <ErrorState title={t("career.loadFailed")} description={cvs.error} action={<Button onClick={cvs.reload}>{t("common.retry")}</Button>} />;
  const list = cvs.data ?? [];
  return (
    <div className="stack-lg">
      <div className="row">
        <Button loading={busy} disabled={list.length >= CV_MAX_DOCUMENTS} onClick={() => setPicking(true)}>
          <Icon name="add" size="sm" />
          {t("career.cv.create")}
        </Button>
        {list.length >= CV_MAX_DOCUMENTS ? <span className="um-muted">{t("career.cv.limit")}</span> : null}
      </div>
      {picking ? (
        <Card>
          <div className="stack">
            <h3>{t("career.cv.pickTemplate")}</h3>
            <TemplatePicker value={tpl} onChange={setTpl} />
            <div className="row">
              <Button loading={busy} onClick={() => void create()}>
                {t("career.cv.createWithTemplate")}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setPicking(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      {list.length === 0 ? (
        <EmptyState title={t("career.empty.cvs")} description={t("career.empty.cvsBody")} />
      ) : (
        <div className="grid-auto">
          {list.map((c) => (
            <Card key={c.id} className="doc-card">
              <div className="row">
                <Icon name="cv" size="sm" />
                <Badge tone="info">{t(`career.lang.${c.language}`)}</Badge>
                <Badge>{t(`career.cv.templates.${c.template}`)}</Badge>
              </div>
              <h3>
                <Link href={`/career/cv/${c.id}`}>{c.title}</Link>
              </h3>
              <p className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
                {date(c.updatedAt)}
              </p>
              <Button variant="danger" aria-label={`${t("career.cv.delete")}: ${c.title}`} onClick={() => setDel({ id: c.id, title: c.title })}>
                {t("common.delete")}
              </Button>
            </Card>
          ))}
        </div>
      )}
      <Dialog
        open={del !== null}
        title={t("career.cv.delete")}
        onClose={() => setDel(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDel(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void doDelete()}>
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p>{t("career.cv.deleteConfirm")}</p>
      </Dialog>
    </div>
  );
}

export function CareerHub() {
  const { t } = useI18n();
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("career.title")}</h1>
        <p>{t("career.subtitle")}</p>
      </div>
      <Tabs
        label={t("career.tabs.label")}
        items={[
          { id: "opportunities", label: t("career.tabs.opportunities"), content: <Feed /> },
          { id: "tracker", label: t("career.tabs.tracker"), content: <Tracker /> },
          { id: "cv", label: t("career.tabs.cv"), content: <CvList /> },
          { id: "interview", label: t("career.tabs.interview"), content: <InterviewPanel /> },
        ]}
      />
    </div>
  );
}
