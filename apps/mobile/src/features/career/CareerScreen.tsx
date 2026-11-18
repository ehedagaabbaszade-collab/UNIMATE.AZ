import { CV_DEFAULT_TEMPLATE, CV_LANGUAGES, CV_MAX_DOCUMENTS, OPPORTUNITY_KINDS, OPPORTUNITY_PAGE_SIZE, OPPORTUNITY_SORTS, TRACK_STATUSES, groupByStatus, safeExternalUrl, skillGap, todayInBaku, type CvLanguage, type OpportunityListItem, type TrackStatus, type TrackedItem } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";
import { Icon } from "../../components/Icon";
import { WorkAzSection } from "./WorkAzSection";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, HeroTitle, ListGroup, ListRow, PillRow, Screen, SearchField, Segmented, Skeleton, useOnline, useToast, PressableScale, Input } from "../../components/ui";
import { radii, spacing } from "../../theme/tokens";
import { useTheme } from "../../theme/ThemeProvider";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { InterviewPanel } from "./InterviewPanel";
import { DEFAULT_FILTERS, createCv, deleteCv, listCvs, myCvSkills, myTracking, removeTracking, searchOpportunities, updateTracking, type OpportunityFilters } from "./api";
import { DeadlineLabel, KIND_ICON, OpportunityCard, STATUS_TONE } from "./parts";
import { emptyCv, type CvTemplate } from "@unimate/core";
import { NewCvTemplateModal } from "./TemplatePicker";

type Tab = "opportunities" | "forYou" | "tracker" | "cv" | "interview";

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
  const { theme } = useTheme();
  const [f, setF] = useState<OpportunityFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const set = <K extends keyof OpportunityFilters>(k: K, v: OpportunityFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  const feed = useFeed(f);
  const filtered = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTERS);
  return (
    <View style={{ gap: spacing.lg }}>
      {/* Search + one filter button on a single line; the extra filters stay folded away until asked for. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <SearchField label={t("career.search.label")} placeholder={t("career.search.placeholder")} value={f.q} onChangeText={(v) => set("q", v)} returnKeyType="search" autoCorrect={false} />
        </View>
        <PressableScale onPress={() => setShowFilters((s) => !s)} accessibilityRole="button" accessibilityState={{ expanded: showFilters }} accessibilityLabel={`${t("career.filters.title")}${filtered ? " •" : ""}`} style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: showFilters ? theme.primary : theme.card }}>
          <Icon name="development" size="sm" color={showFilters ? theme.onPrimary : theme.text} />
          {filtered ? <View style={{ position: "absolute", top: 12, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: theme.active }} /> : null}
        </PressableScale>
      </View>
      <PillRow role="radiogroup" label={t("career.tabs.opportunities")} value={f.kind} onChange={(v) => set("kind", v)} options={[{ value: "", label: t("career.kind.all") }, ...OPPORTUNITY_KINDS.map((k) => ({ value: k, label: t(`career.kind.${k}`) }))]} />
      {showFilters ? (
        <Card style={{ borderRadius: radii.xxl }}>
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

/** Recommendations that leave the app: Work.az searches matched to the profile, and the college catalog. */
function ForYou() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <View style={{ gap: spacing.lg }}>
      <ListGroup>
        <ListRow icon="development" title={t("colleges.title")} subtitle={t("colleges.subtitle")} onPress={() => router.push("/colleges" as never)} />
      </ListGroup>
      <WorkAzSection />
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
    <View style={{ gap: spacing.lg }}>
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
  const [picking, setPicking] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const firstFocus = useRef(true);
  const { reload } = cvs;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) firstFocus.current = false;
      else reload();
    }, [reload]),
  );
  const remove = async () => {
    const id = toDelete;
    setToDelete(null);
    if (!id) return;
    try {
      await deleteCv(sb, id);
      toast(t("career.cv.removed"), "success");
    } catch {
      toast(t("career.cv.saveFailed"), "error");
    }
    reload();
  };
  const create = async (template: CvTemplate) => {
    setBusy(true);
    const lang: CvLanguage = (CV_LANGUAGES as readonly string[]).includes(locale) ? (locale as CvLanguage) : "az";
    const r = await createCv(sb, user.id, { title: t("career.cv.untitled"), language: lang, template, data: emptyCv() });
    setBusy(false);
    if (r.ok) router.push({ pathname: "/career/cv/[id]", params: { id: r.id } });
    else toast(r.error === "limit" ? t("career.cv.limit") : t("career.cv.saveFailed"));
  };
  if (cvs.loading && !cvs.data) return <Skeleton height={100} />;
  if (cvs.error && !cvs.data) return <ErrorState title={t("career.loadFailed")} description={cvs.error} action={<Button title={t("common.retry")} onPress={cvs.reload} />} />;
  const list = cvs.data ?? [];
  return (
    <View style={{ gap: spacing.lg }}>
      <Button title={t("career.cv.create")} icon={<Icon name="add" size="sm" />} loading={busy} disabled={list.length >= CV_MAX_DOCUMENTS} onPress={() => setPicking(true)} />
      <NewCvTemplateModal open={picking} busy={busy} initial={CV_DEFAULT_TEMPLATE} onCancel={() => setPicking(false)} onCreate={(v) => void create(v).then(() => setPicking(false))} />
      {list.length >= CV_MAX_DOCUMENTS ? (
        <AppText variant="caption" muted>
          {t("career.cv.limit")}
        </AppText>
      ) : null}
      <Dialog open={toDelete !== null} title={t("career.cv.delete")} onClose={() => setToDelete(null)} actions={<><Button small variant="secondary" title={t("common.cancel")} onPress={() => setToDelete(null)} /><Button small variant="danger" title={t("common.delete")} onPress={() => void remove()} /></>}>
        <AppText>{t("career.cv.deleteConfirm")}</AppText>
      </Dialog>
      {list.length === 0 ? (
        <EmptyState title={t("career.empty.cvs")} description={t("career.empty.cvsBody")} />
      ) : (
        list.map((c) => (
          <View key={c.id} style={{ gap: 6 }}>
          <PressableScale accessibilityRole="button" accessibilityLabel={c.title} onPress={() => router.push({ pathname: "/career/cv/[id]", params: { id: c.id } })}>
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
          </PressableScale>
            <Button small variant="danger" title={t("career.cv.delete")} onPress={() => setToDelete(c.id)} />
          </View>
        ))
      )}
    </View>
  );
}

export function CareerScreen() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("opportunities");
  const tabs: { value: Tab; label: string }[] = [
    { value: "opportunities", label: t("career.tabs.opportunities") },
    { value: "forYou", label: t("career.tabs.forYou") },
    { value: "tracker", label: t("career.tabs.tracker") },
    { value: "cv", label: t("career.tabs.cv") },
    { value: "interview", label: t("career.tabs.interview") },
  ];
  return (
    <Screen ambient>
      <HeroTitle muted={t("mobile.career.heroMuted")} strong={t("mobile.career.heroStrong")} />
      <PillRow label={t("career.tabs.label")} value={tab} onChange={setTab} options={tabs} />
      {tab === "opportunities" ? <Feed /> : tab === "forYou" ? <ForYou /> : tab === "tracker" ? <Tracker /> : tab === "cv" ? <CvList /> : <InterviewPanel />}
    </Screen>
  );
}
