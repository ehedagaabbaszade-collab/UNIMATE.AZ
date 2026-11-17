import { useI18n } from "@unimate/i18n/react";
import { useRouter, type Href } from "expo-router";
import { useDeferredValue, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { AppText, Badge, Card, EmptyState, ErrorState, Input, Notice, PressableScale, Reveal, Screen, ScreenHeader, Segmented, SkeletonCard } from "../../components/ui";
import { NO_FILTERS, collegeLabel, filterPrograms, summarizeColleges, type CatalogFilters, type CollegeRow, type ProgramRow } from "../../lib/college-catalog";
import { unwrap, useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { CONTENT_MAX } from "../../theme/tokens";

/** Centred and capped on tablets, like Screen. */
const LIST = { padding: 16, gap: 12, width: "100%", maxWidth: CONTENT_MAX + 32, alignSelf: "center" } as const;

const PROGRAM_COLS = "id,college_id,code,specialty,division,language,study_format,seats,tuition_azn,state_funded,special_ability,source_page,needs_verification";

/** Loads the whole catalog once (55 colleges, 783 programs): search and filters then run locally, also on a slow connection. */
export function useCatalog() {
  const { supabase: sb } = useUser();
  const state = useAsync(async () => {
    const [c, p] = await Promise.all([sb.from("admission_colleges").select("id,heading,parent_institution,college_name").limit(1000), sb.from("college_programs").select(PROGRAM_COLS).limit(2000)]);
    return { colleges: unwrap(c) as CollegeRow[], programs: unwrap(p) as ProgramRow[] };
  }, []);
  const byId = useMemo(() => new Map((state.data?.colleges ?? []).map((c) => [c.id, c])), [state.data]);
  return { ...state, byId };
}

function Filters({ value, onChange }: { value: CatalogFilters; onChange: (f: CatalogFilters) => void }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: 12 }}>
      <Input label={t("colleges.search")} value={value.query} onChangeText={(query) => onChange({ ...value, query })} autoCorrect={false} autoCapitalize="none" returnKeyType="search" />
      <AppText variant="label" muted>
        {t("colleges.language")}
      </AppText>
      <Segmented
        label={t("colleges.language")}
        value={value.language}
        onChange={(language) => onChange({ ...value, language })}
        options={[
          { value: "all", label: t("colleges.langAll") },
          { value: "az", label: t("colleges.langAz") },
          { value: "ru", label: t("colleges.langRu") },
          { value: "az_ru", label: t("colleges.langAzRu") },
        ]}
      />
      <AppText variant="label" muted>
        {t("colleges.format")}
      </AppText>
      <Segmented
        label={t("colleges.format")}
        value={value.format}
        onChange={(format) => onChange({ ...value, format })}
        options={[
          { value: "all", label: t("colleges.formatAll") },
          { value: "full_time", label: t("colleges.formatFull") },
          { value: "part_time", label: t("colleges.formatPart") },
        ]}
      />
      <AppText variant="label" muted>
        {t("colleges.funding")}
      </AppText>
      <Segmented
        label={t("colleges.funding")}
        value={value.funding}
        onChange={(funding) => onChange({ ...value, funding })}
        options={[
          { value: "all", label: t("colleges.fundAll") },
          { value: "state", label: t("colleges.fundState") },
          { value: "paid", label: t("colleges.fundPaid") },
        ]}
      />
    </View>
  );
}

function ProgramRowCard({ p, college, index, onPress }: { p: ProgramRow; college: CollegeRow | undefined; index: number; onPress: () => void }) {
  const { t, number } = useI18n();
  return (
    <Reveal index={index}>
      <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`${p.specialty}, ${p.code}`}>
        <Card>
          <AppText variant="heading">{p.specialty}</AppText>
          {college ? (
            <AppText variant="caption" muted numberOfLines={2}>
              {collegeLabel(college)}
            </AppText>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <Badge tone="neutral">{p.code}</Badge>
            <Badge tone={p.state_funded ? "success" : "warning"}>{p.state_funded ? t("colleges.stateFunded") : t("colleges.fee", { n: number(p.tuition_azn ?? 0) })}</Badge>
            <Badge tone="primary">{t("colleges.seats", { n: p.seats })}</Badge>
            <Badge tone="info">{t(p.study_format === "full_time" ? "colleges.formatFull" : "colleges.formatPart")}</Badge>
            {p.special_ability ? <Badge tone="danger">{"*"}</Badge> : null}
          </View>
        </Card>
      </PressableScale>
    </Reveal>
  );
}

export function CollegesScreen() {
  const { t, number } = useI18n();
  const router = useRouter();
  const cat = useCatalog();
  const [view, setView] = useState<"colleges" | "specialties">("colleges");
  const [filters, setFilters] = useState<CatalogFilters>(NO_FILTERS);
  const deferred = useDeferredValue(filters);
  const programs = useMemo(() => (cat.data ? filterPrograms(cat.data.programs, cat.byId, deferred) : []), [cat.data, cat.byId, deferred]);
  const colleges = useMemo(() => (cat.data ? summarizeColleges(cat.data.colleges, programs) : []), [cat.data, programs]);
  const go = (href: string) => router.push(href as Href);
  const head = <ScreenHeader title={t("colleges.title")} onBack={() => router.back()} />;

  if (cat.error)
    return (
      <Screen>
        {head}
        <ErrorState title={t("colleges.loadFailed")} />
      </Screen>
    );
  if (cat.loading && !cat.data)
    return (
      <Screen>
        {head}
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </Screen>
    );

  const header = (
    <View style={{ gap: 16, paddingBottom: 12 }}>
      {head}
      <AppText muted>{t("colleges.subtitle")}</AppText>
      <Segmented
        label={t("colleges.title")}
        value={view}
        onChange={setView}
        options={[
          { value: "colleges", label: t("colleges.viewColleges") },
          { value: "specialties", label: t("colleges.viewSpecialties") },
        ]}
      />
      <Filters value={filters} onChange={setFilters} />
      <AppText variant="caption" muted accessibilityLiveRegion="polite">
        {t("colleges.results", { n: number(view === "colleges" ? colleges.length : programs.length) })}
      </AppText>
    </View>
  );

  return (
    <Screen scroll={false} padded={false}>
      {view === "colleges" ? (
        <FlatList
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
          data={colleges}
          keyExtractor={(c) => c.id}
          contentContainerStyle={LIST}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title={t("colleges.noResults")} />}
          ListFooterComponent={<Notice tone="info" text={t("colleges.notice")} />}
          initialNumToRender={10}
          renderItem={({ item, index }) => (
            <Reveal index={Math.min(index, 6)}>
              <PressableScale onPress={() => go(`/colleges/${item.id}`)} accessibilityRole="button" accessibilityLabel={collegeLabel(item)}>
                <Card>
                  <AppText variant="heading">{item.college_name}</AppText>
                  {item.parent_institution ? (
                    <AppText variant="caption" muted>
                      {item.parent_institution}
                    </AppText>
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <Badge tone="primary">{t("colleges.programCount", { n: item.programs })}</Badge>
                    <Badge tone="neutral">{t("colleges.seatTotal", { n: number(item.seats) })}</Badge>
                  </View>
                </Card>
              </PressableScale>
            </Reveal>
          )}
        />
      ) : (
        <FlatList
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
          data={programs}
          keyExtractor={(p) => p.id}
          contentContainerStyle={LIST}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title={t("colleges.noResults")} />}
          ListFooterComponent={<Notice tone="info" text={t("colleges.notice")} />}
          initialNumToRender={12}
          windowSize={7}
          renderItem={({ item, index }) => <ProgramRowCard p={item} college={cat.byId.get(item.college_id)} index={Math.min(index, 6)} onPress={() => go(`/colleges/program/${item.id}`)} />}
        />
      )}
    </Screen>
  );
}

export function CollegeScreen({ id }: { id: string }) {
  const { t, number } = useI18n();
  const router = useRouter();
  const cat = useCatalog();
  const [filters, setFilters] = useState<CatalogFilters>(NO_FILTERS);
  const deferred = useDeferredValue(filters);
  const college = cat.byId.get(id);
  const programs = useMemo(() => (cat.data ? filterPrograms(cat.data.programs, cat.byId, { ...deferred, collegeId: id }) : []), [cat.data, cat.byId, deferred, id]);
  const head = <ScreenHeader title={college?.college_name ?? t("colleges.college")} onBack={() => router.back()} />;
  if (cat.loading && !cat.data)
    return (
      <Screen>
        {head}
        <SkeletonCard />
      </Screen>
    );
  if (cat.error || !college)
    return (
      <Screen>
        {head}
        <ErrorState title={t("colleges.loadFailed")} />
      </Screen>
    );
  const seats = programs.reduce((n, p) => n + p.seats, 0);
  return (
    <Screen scroll={false} padded={false}>
      <FlatList
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
        data={programs}
        keyExtractor={(p) => p.id}
        contentContainerStyle={LIST}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 16, paddingBottom: 12 }}>
            {head}
            {college.parent_institution ? (
              <AppText muted>
                {t("colleges.parent")}: {college.parent_institution}
              </AppText>
            ) : null}
            <Filters value={filters} onChange={setFilters} />
            <AppText variant="caption" muted accessibilityLiveRegion="polite">
              {t("colleges.programCount", { n: number(programs.length) })} · {t("colleges.seatTotal", { n: number(seats) })}
            </AppText>
          </View>
        }
        ListEmptyComponent={<EmptyState title={t("colleges.noResults")} />}
        ListFooterComponent={<Notice tone="info" text={t("colleges.notice")} />}
        renderItem={({ item, index }) => <ProgramRowCard p={item} college={college} index={Math.min(index, 6)} onPress={() => router.push(`/colleges/program/${item.id}` as Href)} />}
      />
    </Screen>
  );
}

export function ProgramScreen({ id }: { id: string }) {
  const { t, number } = useI18n();
  const router = useRouter();
  const cat = useCatalog();
  const p = cat.data?.programs.find((x) => x.id === id);
  const college = p ? cat.byId.get(p.college_id) : undefined;
  const head = <ScreenHeader title={t("colleges.detail")} onBack={() => router.back()} />;
  if (cat.loading && !cat.data)
    return (
      <Screen>
        {head}
        <SkeletonCard lines={4} />
      </Screen>
    );
  if (cat.error || !p)
    return (
      <Screen>
        {head}
        <ErrorState title={t("colleges.loadFailed")} />
      </Screen>
    );
  const rows: Array<[string, string]> = [
    [t("colleges.code"), p.code],
    ...(college ? ([[t("colleges.college"), college.college_name]] as Array<[string, string]>) : []),
    ...(college?.parent_institution ? ([[t("colleges.parent"), college.parent_institution]] as Array<[string, string]>) : []),
    ...(p.division ? ([[t("colleges.division"), p.division]] as Array<[string, string]>) : []),
    [t("colleges.language"), t(p.language === "az" ? "colleges.langAz" : p.language === "ru" ? "colleges.langRu" : "colleges.langAzRu")],
    [t("colleges.format"), t(p.study_format === "full_time" ? "colleges.formatFull" : "colleges.formatPart")],
    [t("colleges.seatsTitle"), t("colleges.seats", { n: p.seats })],
    [t("colleges.tuition"), p.state_funded ? t("colleges.stateFunded") : t("colleges.fee", { n: number(p.tuition_azn ?? 0) })],
  ];
  return (
    <Screen>
      {head}
      <Reveal index={0}>
        <Card>
          <AppText variant="title">{p.specialty}</AppText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <Badge tone={p.state_funded ? "success" : "warning"}>{p.state_funded ? t("colleges.stateFunded") : t("colleges.paid")}</Badge>
            {p.special_ability ? <Badge tone="danger">{t("colleges.special")}</Badge> : null}
            {p.needs_verification ? <Badge tone="warning">{t("colleges.needsCheck")}</Badge> : null}
          </View>
        </Card>
      </Reveal>
      <Reveal index={1}>
        <Card>
          {rows.map(([k, v]) => (
            <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 4 }}>
              <AppText variant="caption" muted style={{ flexShrink: 0 }}>
                {k}
              </AppText>
              <AppText variant="caption" style={{ flex: 1, textAlign: "right" }}>
                {v}
              </AppText>
            </View>
          ))}
          <AppText variant="caption" muted>
            {t("colleges.sourcePage", { n: p.source_page })}
          </AppText>
        </Card>
      </Reveal>
      {college ? (
        <PressableScale onPress={() => router.push(`/colleges/${college.id}` as Href)} accessibilityRole="button" accessibilityLabel={collegeLabel(college)}>
          <Card>
            <AppText variant="label">{collegeLabel(college)} {"›"}</AppText>
          </Card>
        </PressableScale>
      ) : null}
      <Notice tone="info" text={t("colleges.notice")} />
    </Screen>
  );
}
