import { CV_LANGUAGES, CV_MAX_DOCUMENTS, OPPORTUNITY_KINDS, OPPORTUNITY_PAGE_SIZE, OPPORTUNITY_SORTS, TRACK_STATUSES, groupByStatus, safeExternalUrl, skillGap, todayInBaku, type CvLanguage, type OpportunityListItem, type TrackStatus, type TrackedItem } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { Icon, ModuleIcon } from "../../components/Icon";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, Input, Screen, Segmented, Skeleton, useOnline, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { InterviewPanel } from "./InterviewPanel";
import { DEFAULT_FILTERS, createCv, listCvs, myCvSkills, myTracking, removeTracking, searchOpportunities, updateTracking, type OpportunityFilters } from "./api";
import { DeadlineLabel, KIND_ICON, OpportunityCard, STATUS_TONE } from "./parts";
import { emptyCv } from "@unimate/core";

type Tab = "opportunities" | "tracker" | "cv" | "interview";

/** Feed with debounced search; keeps the last result visible when offline or on error. */
function useFeed(filters: OpportunityFilters) {
  const { supabase: sb } = useUser();
  const [items, setItems] = useState<OpportunityListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify(filters);
  const load = useCallback(
    async (offset: number) => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const rows = await searchOpportunities(sb, filters, offset, todayInBaku());
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
    [sb, key],
  );
  useEffect(() => {
    const id = setTimeout(() => void load(0), filters.q || filters.skills || filters.location ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, filters.q, filters.skills, filters.location]);
  return { items, hasMore, loading, error, reload: () => void load(0), more: () => void load(items.length) };
}

function Feed() {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const [f, setF] = useState<OpportunityFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const set = <K extends keyof OpportunityFilters>(k: K, v: OpportunityFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  const feed = useFeed(f);
  const filtered = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTERS);
  return (
    <View style={{ gap: 12 }}>
      <Input label={t("career.search.label")} placeholder={t("career.search.placeholder")} value={f.q} onChangeText={(v) => set("q", v)} returnKeyType="search" autoCorrect={false} />
      <Segmented
        label={t("career.tabs.opportunities")}
        value={f.kind}
        onChange={(v) => set("kind", v)}
        options={[{ value: "", label: t("career.kind.all") }, ...OPPORTUNITY_KINDS.map((k) => ({ value: k, label: t(`career.kind.${k}`) }))]}
      />
      <Pressable onPress={() => setShowFilters((s) => !s)} accessibilityRole="button" accessibilityState={{ expanded: showFilters }} accessibilityLabel={t("career.filters.workMode")} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
        <Icon name="search" size="sm" />
        <AppText variant="label">{t("career.filters.location")} · {t("career.filters.closing")} · {t("career.filters.skills")}</AppText>
      </Pressable>
      {showFilters ? (
        <Card>
          <Input label={t("career.filters.location")} placeholder={t("career.filters.locationPlaceholder")} value={f.location} onChangeText={(v) => set("location", v)} autoCorrect={false} />
          <Input label={t("career.filters.skills")} placeholder={t("career.filters.skillsPlaceholder")} value={f.skills} onChangeText={(v) => set("skills", v)} autoCapitalize="none" autoCorrect={false} />
          <Segmented
            label={t("career.filters.workMode")}
            value={f.remoteOnly ? "remote" : "any"}
            onChange={(v) => set("remoteOnly", v === "remote")}
            options={[{ value: "any", label: t("career.filters.anyMode") }, { value: "remote", label: t("career.filters.remoteOnly") }]}
          />
          <Segmented
            label={t("career.filters.closing")}
            value={String(f.closingInDays) as "0" | "7" | "30"}
            onChange={(v) => set("closingInDays", Number(v) as 0 | 7 | 30)}
            options={[{ value: "0", label: t("career.filters.closingAny") }, { value: "7", label: t("career.filters.closing7") }, { value: "30", label: t("career.filters.closing30") }]}
          />
          <Segmented label={t("career.filters.sort")} value={f.sort} onChange={(v) => set("sort", v)} options={OPPORTUNITY_SORTS.map((s) => ({ value: s, label: t(s === "deadline" ? "career.filters.sortDeadline" : "career.filters.sortNewest") }))} />
          <Segmented
            label={t("career.filters.expired")}
            value={f.includeExpired ? "show" : "hide"}
            onChange={(v) => set("includeExpired", v === "show")}
            options={[{ value: "hide", label: t("career.filters.expiredHide") }, { value: "show", label: t("career.filters.expiredShow") }]}
          />
        </Card>
      ) : null}
      {!online ? (
        <AppText variant="caption" muted>
          {t("career.offline")}
        </AppText>
      ) : null}

      {feed.loading && feed.items.length === 0 ? (
        <View style={{ gap: 12 }}>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      ) : feed.error && feed.items.length === 0 ? (
        <ErrorState title={t("career.loadFailed")} description={online ? feed.error : t("career.offline")} action={<Button title={t("common.retry")} onPress={feed.reload} />} />
      ) : feed.items.length === 0 ? (
        <EmptyState title={filtered ? t("career.empty.search") : t("career.empty.feed")} description={filtered ? undefined : t("career.empty.feedBody")} />
      ) : (
        <View style={{ gap: 12 }}>
          {feed.error ? <ErrorState title={t("career.loadFailed")} description={feed.error} action={<Button title={t("common.retry")} onPress={feed.reload} />} /> : null}
          {feed.items.map((o) => (
            <OpportunityCard key={o.id} item={o} onPress={() => router.push({ pathname: "/career/[id]", params: { id: o.id } })} />
          ))}
          {feed.hasMore ? <Button title={t("career.loadMore")} variant="secondary" loading={feed.loading} onPress={feed.more} /> : null}
        </View>
      )}
    </View>
  );
}

function SkillGapCard({ tracked }: { tracked: TrackedItem[] }) {
  const { t } = useI18n();
  const { supabase: sb } = useUser();
  const skills = useAsync(() => myCvSkills(sb), [sb]);
  const withSkills = tracked.filter((i) => i.skills.length > 0);
  const gap = skills.data ? skillGap(skills.data, withSkills, 8) : [];
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="development" size="md" />
        <AppText variant="heading">{t("career.gap.title")}</AppText>
      </View>
      <AppText muted>{t("career.gap.body")}</AppText>
      {skills.loading && !skills.data ? (
        <Skeleton height={48} />
      ) : skills.error ? (
        <AppText variant="caption" muted>
          {t("career.loadFailed")}
        </AppText>
      ) : !skills.data || skills.data.length === 0 ? (
        <AppText>{t("career.gap.noCv")}</AppText>
      ) : withSkills.length === 0 ? (
        <AppText>{t("career.gap.noTracked")}</AppText>
      ) : gap.length === 0 ? (
        <AppText>{t("career.gap.empty")}</AppText>
      ) : (
        <View style={{ gap: 8 }}>
          {gap.map((g) => (
            <View key={g.skill} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <Badge tone="warning">{g.skill}</Badge>
              <AppText variant="caption" muted>
                {t("career.gap.count", { n: g.count })}
              </AppText>
            </View>
          ))}
          <AppText variant="caption" muted>
            {t("career.gap.note")}
          </AppText>
        </View>
      )}
    </Card>
  );
}

function TrackerItem({ item, onChanged }: { item: TrackedItem; onChanged: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const { supabase: sb } = useUser();
  const [busy, setBusy] = useState(false);
  const move = async (status: TrackStatus) => {
    setBusy(true);
    try {
      await updateTracking(sb, item.id, { status });
      onChanged();
    } catch {
      toast(t("career.detail.trackFailed"));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await removeTracking(sb, item.id);
      onChanged();
    } catch {
      toast(t("career.detail.trackFailed"));
      setBusy(false);
    }
  };
  const url = safeExternalUrl(item.applyUrl);
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Icon name={KIND_ICON[item.kind] ?? "jobs"} size="sm" />
        <Badge tone={STATUS_TONE[item.status]}>{t(`career.status.${item.status}`)}</Badge>
        {item.listingState === "removed" ? <Badge tone="danger">{t("career.tracker.removed")}</Badge> : item.listingState === "unavailable" ? <Badge tone="warning">{t("career.tracker.unavailable")}</Badge> : null}
      </View>
      <AppText variant="heading">{item.title}</AppText>
      <AppText muted>{item.organization}</AppText>
      <DeadlineLabel deadline={item.deadline} />
      {item.notes ? (
        <AppText variant="caption" muted numberOfLines={3}>
          {item.notes}
        </AppText>
      ) : null}
      <Segmented label={t("career.tracker.moveTo")} value={item.status} onChange={(s) => void move(s)} options={TRACK_STATUSES.map((s) => ({ value: s, label: t(`career.status.${s}`) }))} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {item.listingState === "published" && item.opportunityId ? <Button small variant="secondary" title={t("career.cv.open")} onPress={() => router.push({ pathname: "/career/[id]", params: { id: item.opportunityId! } })} /> : null}
        {url && item.listingState === "published" ? <Button small variant="secondary" title={t("career.detail.applyCta")} onPress={() => void Linking.openURL(url)} /> : null}
        <Button small variant="danger" title={t("career.tracker.remove")} disabled={busy} onPress={() => void remove()} />
      </View>
    </Card>
  );
}

function Tracker() {
  const { t } = useI18n();
  const { supabase: sb } = useUser();
  const tracked = useAsync(() => myTracking(sb), [sb]);
  if (tracked.loading && !tracked.data) return <Skeleton height={140} />;
  if (tracked.error && !tracked.data) return <ErrorState title={t("career.loadFailed")} description={tracked.error} action={<Button title={t("common.retry")} onPress={tracked.reload} />} />;
  const items = tracked.data ?? [];
  return (
    <View style={{ gap: 12 }}>
      <AppText muted>{t("career.tracker.intro")}</AppText>
      <SkillGapCard tracked={items} />
      {items.length === 0 ? (
        <EmptyState title={t("career.empty.tracker")} description={t("career.empty.trackerBody")} />
      ) : (
        groupByStatus(items)
          .filter((c) => c.items.length > 0)
          .map((col) => (
            <View key={col.status} style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <AppText variant="heading">{t(`career.status.${col.status}`)}</AppText>
                <AppText variant="caption" muted>
                  {t("career.tracker.count", { n: col.items.length })}
                </AppText>
              </View>
              {col.items.map((i) => (
                <TrackerItem key={i.id} item={i} onChanged={tracked.reload} />
              ))}
            </View>
          ))
      )}
    </View>
  );
}

function CvList() {
  const { t, date } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const { user, supabase: sb } = useUser();
  const { locale } = useI18n();
  const cvs = useAsync(() => listCvs(sb), [sb]);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const lang: CvLanguage = (CV_LANGUAGES as readonly string[]).includes(locale) ? (locale as CvLanguage) : "az";
    const r = await createCv(sb, user.id, { title: t("career.cv.untitled"), language: lang, template: "classic", data: emptyCv() });
    setBusy(false);
    if (r.ok) router.push({ pathname: "/career/cv/[id]", params: { id: r.id } });
    else toast(r.error === "limit" ? t("career.cv.limit") : t("career.cv.saveFailed"));
  };
  if (cvs.loading && !cvs.data) return <Skeleton height={100} />;
  if (cvs.error && !cvs.data) return <ErrorState title={t("career.loadFailed")} description={cvs.error} action={<Button title={t("common.retry")} onPress={cvs.reload} />} />;
  const list = cvs.data ?? [];
  return (
    <View style={{ gap: 12 }}>
      <Button title={t("career.cv.create")} icon={<Icon name="add" size="sm" color="#FFFFFF" />} loading={busy} disabled={list.length >= CV_MAX_DOCUMENTS} onPress={() => void create()} />
      {list.length >= CV_MAX_DOCUMENTS ? (
        <AppText variant="caption" muted>
          {t("career.cv.limit")}
        </AppText>
      ) : null}
      {list.length === 0 ? (
        <EmptyState title={t("career.empty.cvs")} description={t("career.empty.cvsBody")} />
      ) : (
        list.map((c) => (
          <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.title} onPress={() => router.push({ pathname: "/career/cv/[id]", params: { id: c.id } })}>
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name="cv" size="sm" />
                <Badge tone="info">{t(`career.lang.${c.language}`)}</Badge>
                <Badge tone="neutral">{t(`career.cv.templates.${c.template}`)}</Badge>
              </View>
              <AppText variant="heading">{c.title}</AppText>
              <AppText variant="caption" muted>
                {date(c.updatedAt)}
              </AppText>
            </Card>
          </Pressable>
        ))
      )}
    </View>
  );
}

export function CareerScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("opportunities");
  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <ModuleIcon icon="career" module="career" size={48} />
        <View style={{ flex: 1 }}>
          <AppText variant="display" accessibilityRole="header">
            {t("career.title")}
          </AppText>
          <AppText muted>{t("career.subtitle")}</AppText>
        </View>
      </View>
      <Segmented
        label={t("career.tabs.label")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "opportunities", label: t("career.tabs.opportunities") },
          { value: "tracker", label: t("career.tabs.tracker") },
          { value: "cv", label: t("career.tabs.cv") },
          { value: "interview", label: t("career.tabs.interview") },
        ]}
      />
      {tab === "opportunities" ? <Feed /> : tab === "tracker" ? <Tracker /> : tab === "cv" ? <CvList /> : <InterviewPanel />}
    </Screen>
  );
}
