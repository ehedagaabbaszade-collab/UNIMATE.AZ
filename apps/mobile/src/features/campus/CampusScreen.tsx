import { CAMPUS_LIMITS, CREATABLE_COMMUNITY_KINDS, COMMUNITY_KINDS, campusTextProblem, isInviteCode, normalizeInviteCode, type CampusLanguage, type CommunityKind, type CommunityListItem, type EventRow, type PostKind } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Button, Card, EmptyState, ErrorState, ExpandCard, HeroTitle, Input, ListGroup, ListRow, PillRow, Screen, SearchField, Skeleton, useOnline, useToast, PressableScale } from "../../components/ui";
import { MIN_TOUCH, spacing } from "../../theme/tokens";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { createCommunity, createEvent, createPost, discoverCommunities, ensureUniversityCommunity, homeFeed, joinByCode, listEvents, myCommunities, parseLocalDateTime, react, searchCampus, type CommunityFilters, type EventScope } from "./api";
import { usePagedPosts } from "./hooks";
import { Chips, CommunityCardView, EventCardView, PostCardView, languageOptions, useCampusError } from "./parts";

type Tab = "feed" | "communities" | "events" | "groups";

const textError = (t: (k: string) => string, ...texts: string[]) => (texts.some((x) => campusTextProblem(x)) ? t("campus.errors.invalidText") : undefined);

// ------------------------------------------------------------------ university offer
function UniversityOffer({ mine, onJoined }: { mine: CommunityListItem[] | undefined; onJoined: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb, profile } = useUser();
  const uni = profile?.university_id ?? null;
  const name = useAsync(async () => (uni ? ((await sb.from("universities").select("name").eq("id", uni).maybeSingle()).data?.name as string | undefined) ?? null : null), [uni], !!uni);
  const [busy, setBusy] = useState(false);
  if (!uni || !mine || !name.data || mine.some((c) => c.kind === "university" && c.university_id === uni)) return null;
  const label = name.data.slice(0, 100);
  return (
    <Card strong>
      <AppText variant="heading">{t("campus.communities.universityOfferTitle")}</AppText>
      <AppText muted>{t("campus.communities.universityOfferBody", { name: label })}</AppText>
      <Button
        title={t("campus.communities.universityOfferCta", { name: label })}
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await ensureUniversityCommunity(sb, uni, true);
            toast(t("campus.communities.joined"), "success");
            onJoined();
          } catch (e) {
            onError(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

// ------------------------------------------------------------------ feed + composer
function Composer({ communities, onPosted }: { communities: CommunityListItem[]; onPosted: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const [open, setOpen] = useState(false);
  const joined = communities.filter((c) => c.my_status === "active");
  const [community, setCommunity] = useState("");
  const [kind, setKind] = useState<PostKind>("post");
  const [anonymous, setAnonymous] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [language, setLanguage] = useState<CampusLanguage | "">("");
  const [busy, setBusy] = useState(false);
  const chosen = community || joined[0]?.id || "";
  const bad = textError(t as (k: string) => string, title, body);
  if (!open) return <Button title={t("campus.composer.open")} variant="secondary" icon={<Icon name="add" size="sm" />} onPress={() => setOpen(true)} />;
  return (
    <Card>
      {joined.length === 0 ? (
        <AppText muted>{t("campus.composer.noCommunity")}</AppText>
      ) : (
        <>
          <Chips label={t("campus.composer.community")} value={chosen} onChange={setCommunity} options={joined.map((c) => ({ value: c.id, label: c.name }))} />
          <Chips label={t("campus.composer.kind")} value={kind} onChange={(k) => { setKind(k); if (k !== "question") setAnonymous(false); }} options={[{ value: "post", label: t("campus.composer.post") }, { value: "question", label: t("campus.composer.question") }]} />
          <Input label={t("campus.composer.title")} value={title} onChangeText={setTitle} maxLength={CAMPUS_LIMITS.title} error={bad} />
          <Input label={t("campus.composer.body")} value={body} onChangeText={setBody} multiline maxLength={CAMPUS_LIMITS.body} style={{ minHeight: 90, textAlignVertical: "top" }} />
          {kind === "question" ? <Chips label={t("campus.composer.anonymous")} value={anonymous ? "yes" : "no"} onChange={(v) => setAnonymous(v === "yes")} options={[{ value: "no", label: t("campus.post.you") }, { value: "yes", label: t("campus.composer.anonymous") }]} /> : null}
          {anonymous ? (
            <AppText variant="caption" muted>
              {t("campus.composer.anonymousHint")}
            </AppText>
          ) : null}
          <Chips label={t("campus.composer.language")} value={language} onChange={setLanguage} options={languageOptions(t("campus.composer.languageNone"))} />
          <AppText variant="caption" muted>
            {t("campus.composer.languageHint")}
          </AppText>
        </>
      )}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            title={t("campus.composer.submit")}
            loading={busy}
            disabled={!chosen || !title.trim() || !!bad}
            onPress={async () => {
              setBusy(true);
              try {
                await createPost(sb, { community: chosen, title: title.trim(), body: body.trim(), kind, anonymous, language });
                toast(t("campus.composer.published"), "success");
                setTitle("");
                setBody("");
                setAnonymous(false);
                setOpen(false);
                onPosted();
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          />
        </View>
        <Button title={t("common.cancel")} variant="ghost" onPress={() => setOpen(false)} />
      </View>
    </Card>
  );
}

function FeedTab({ onDiscover }: { onDiscover: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const [kind, setKind] = useState<PostKind | "">("");
  const [language, setLanguage] = useState<CampusLanguage | "">("");
  const mine = useAsync(() => myCommunities(sb), [sb]);
  const feed = usePagedPosts((cursor) => homeFeed(sb, { cursor, kind, language }), `${kind}|${language}`);
  return (
    <View style={{ gap: spacing.lg }}>
      <UniversityOffer mine={mine.data} onJoined={() => { mine.reload(); feed.reload(); }} />
      <Composer communities={mine.data ?? []} onPosted={feed.reload} />
      {/* One line of filters: post kind, then the post language (the "all" chip of each row is first). */}
      <PillRow role="radiogroup" label={t("campus.feed.filterLabel")} value={kind} onChange={setKind} options={[{ value: "", label: t("campus.feed.filterAll") }, { value: "post", label: t("campus.feed.filterPosts") }, { value: "question", label: t("campus.feed.filterQuestions") }]} />
      <PillRow role="radiogroup" label={t("campus.feed.language")} value={language} onChange={setLanguage} options={languageOptions(t("campus.feed.languageAll"))} />
      {!online ? (
        <AppText variant="caption" muted>
          {t("campus.offline")}
        </AppText>
      ) : null}
      {feed.loading && feed.items.length === 0 ? (
        <View style={{ gap: spacing.lg }}>
          <Skeleton height={130} />
          <Skeleton height={130} />
        </View>
      ) : feed.error && feed.items.length === 0 ? (
        <ErrorState title={t("campus.loadFailed")} description={online ? undefined : t("campus.offline")} action={<Button title={t("common.retry")} onPress={feed.reload} />} />
      ) : feed.items.length === 0 ? (
        <EmptyState title={t("campus.feed.empty")} description={t("campus.feed.emptyBody")} action={<Button title={t("campus.tabs.communities")} variant="secondary" onPress={onDiscover} />} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {feed.items.map((p) => (
            <PostCardView
              key={p.id}
              post={p}
              onOpen={() => router.push(`/campus/post/${p.id}`)}
              onAuthor={() => p.author_id && router.push(`/campus/user/${p.author_id}`)}
              onLike={async () => {
                try {
                  const r = await react(sb, "post", p.id, "like", !p.my_liked);
                  feed.patch(p.id, { like_count: Number(r.like_count), my_liked: r.my_like });
                } catch (e) {
                  onError(e);
                }
              }}
            />
          ))}
          {feed.hasMore ? <Button title={t("campus.loadMore")} variant="secondary" loading={feed.loading} onPress={feed.more} /> : null}
        </View>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ communities
function CommunitiesTab() {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const [f, setF] = useState<CommunityFilters>({ q: "", kind: "", joined: "all" });
  const list = useAsync(() => discoverCommunities(sb, f), [sb, f.q, f.kind, f.joined]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"faculty" | "course">("course");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
  const bad = textError(t as (k: string) => string, name, description, rules);
  return (
    <View style={{ gap: spacing.lg }}>
      <PillRow role="radiogroup" label={t("campus.communities.kindLabel")} value={f.kind} onChange={(kindV) => setF((p) => ({ ...p, kind: kindV }))} options={[{ value: "", label: t("campus.communities.kind.all") }, ...COMMUNITY_KINDS.map((k) => ({ value: k as CommunityKind, label: t(`campus.communities.kind.${k}`) }))]} />
      <PillRow role="radiogroup" label={t("campus.communities.scopeLabel")} value={f.joined} onChange={(joined) => setF((p) => ({ ...p, joined }))} options={[{ value: "all", label: t("campus.communities.scopeAll") }, { value: "joined", label: t("campus.communities.scopeJoined") }, { value: "not", label: t("campus.communities.scopeNotJoined") }]} />
      {!creating ? (
        <Button title={t("campus.communities.create")} variant="secondary" icon={<Icon name="add" size="sm" />} onPress={() => setCreating(true)} />
      ) : (
        <Card>
          <Chips label={t("campus.communities.createKind")} value={kind} onChange={setKind} options={CREATABLE_COMMUNITY_KINDS.filter((k) => k !== "group").map((k) => ({ value: k as "faculty" | "course", label: t(`campus.communities.kind.${k}`) }))} />
          <Input label={t("campus.communities.createName")} value={name} onChangeText={setName} maxLength={CAMPUS_LIMITS.communityName} error={bad} />
          <Input label={t("campus.communities.createDescription")} value={description} onChangeText={setDescription} multiline maxLength={CAMPUS_LIMITS.description} />
          <Input label={t("campus.communities.createRules")} value={rules} onChangeText={setRules} multiline maxLength={CAMPUS_LIMITS.rules} />
          <Chips label={t("campus.communities.createVisibility")} value={visibility} onChange={setVisibility} options={[{ value: "public", label: t("campus.communities.visibilityPublic") }, { value: "private", label: t("campus.communities.visibilityPrivate") }]} />
          <AppText variant="caption" muted>
            {t(visibility === "public" ? "campus.communities.createPublicHint" : "campus.communities.createPrivateHint")}
          </AppText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                title={t("campus.communities.createSubmit")}
                loading={busy}
                disabled={name.trim().length < 2 || !!bad}
                onPress={async () => {
                  setBusy(true);
                  try {
                    const id = await createCommunity(sb, { name: name.trim(), kind, visibility, description: description.trim(), rules: rules.trim() });
                    toast(t("campus.communities.created"), "success");
                    setCreating(false);
                    setName("");
                    router.push(`/campus/community/${id}`);
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </View>
            <Button title={t("common.cancel")} variant="ghost" onPress={() => setCreating(false)} />
          </View>
        </Card>
      )}
      {list.loading && !list.data ? (
        <Skeleton height={100} />
      ) : list.error && !list.data ? (
        <ErrorState title={t("campus.loadFailed")} description={online ? undefined : t("campus.offline")} action={<Button title={t("common.retry")} onPress={list.reload} />} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title={t("campus.communities.empty")} description={t("campus.communities.emptyBody")} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {(list.data ?? []).map((c) => (
            <CommunityCardView key={c.id} c={c} onOpen={() => router.push(`/campus/community/${c.id}`)} />
          ))}
        </View>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ events
export function EventForm({ communities, initial, submitLabel, onSubmit }: { communities: CommunityListItem[]; initial?: { title: string; description: string; location: string; startsAt: string; endsAt: string; capacity: string }; submitLabel: string; onSubmit: (v: { community: string | null; title: string; description: string; location: string; startsAt: string; endsAt: string | null; capacity: number | null; language: CampusLanguage | "" }) => Promise<void> }) {
  const { t } = useI18n();
  const joined = communities.filter((c) => c.my_status === "active");
  const [community, setCommunity] = useState<string>("");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [starts, setStarts] = useState(initial?.startsAt ?? "");
  const [ends, setEnds] = useState(initial?.endsAt ?? "");
  const [capacity, setCapacity] = useState(initial?.capacity ?? "");
  const [language, setLanguage] = useState<CampusLanguage | "">("");
  const [busy, setBusy] = useState(false);
  const [dateError, setDateError] = useState(false);
  const bad = textError(t as (k: string) => string, title, description, location);
  return (
    <Card>
      {!initial ? <Chips label={t("campus.events.community")} value={community} onChange={setCommunity} options={[{ value: "", label: t("campus.events.noCommunityOption") }, ...joined.map((c) => ({ value: c.id, label: c.name }))]} /> : null}
      <Input label={t("campus.events.eventTitle")} value={title} onChangeText={setTitle} maxLength={CAMPUS_LIMITS.eventTitle} error={bad} />
      <Input label={t("campus.events.description")} value={description} onChangeText={setDescription} multiline maxLength={CAMPUS_LIMITS.eventDescription} />
      <Input label={t("campus.events.location")} value={location} onChangeText={setLocation} maxLength={CAMPUS_LIMITS.location} />
      <Input label={t("campus.events.starts")} hint={t("campus.events.dateHint")} value={starts} onChangeText={(v) => { setStarts(v); setDateError(false); }} autoCapitalize="none" keyboardType="numbers-and-punctuation" placeholder="2030-01-31 18:00" error={dateError ? t("campus.events.invalidDate") : undefined} />
      <Input label={t("campus.events.ends")} hint={t("campus.events.dateHint")} value={ends} onChangeText={setEnds} autoCapitalize="none" keyboardType="numbers-and-punctuation" />
      <Input label={t("campus.events.capacity")} value={capacity} onChangeText={(v) => setCapacity(v.replace(/\D/g, "").slice(0, 5))} keyboardType="number-pad" />
      <Chips label={t("campus.composer.language")} value={language} onChange={setLanguage} options={languageOptions(t("campus.composer.languageNone"))} />
      <Button
        title={submitLabel}
        loading={busy}
        disabled={!title.trim() || !starts.trim() || !!bad}
        onPress={async () => {
          const s = parseLocalDateTime(starts);
          const e = ends.trim() ? parseLocalDateTime(ends) : null;
          if (!s || (ends.trim() && !e) || Date.parse(s) <= Date.now()) {
            setDateError(true);
            return;
          }
          setBusy(true);
          try {
            await onSubmit({ community: community || null, title: title.trim(), description: description.trim(), location: location.trim(), startsAt: s, endsAt: e, capacity: capacity ? Number(capacity) : null, language });
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

function EventsTab() {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnline();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const [scope, setScope] = useState<EventScope>("upcoming");
  const list = useAsync(() => listEvents(sb, scope), [sb, scope]);
  const mine = useAsync(() => myCommunities(sb), [sb]);
  const [creating, setCreating] = useState(false);
  return (
    <View style={{ gap: spacing.lg }}>
      <PillRow role="radiogroup" label={t("campus.events.scopeLabel")} value={scope} onChange={setScope} options={[{ value: "upcoming", label: t("campus.events.upcoming") }, { value: "going", label: t("campus.events.going") }, { value: "mine", label: t("campus.events.mine") }]} />
      {!creating ? (
        <Button title={t("campus.events.create")} variant="secondary" icon={<Icon name="add" size="sm" />} onPress={() => setCreating(true)} />
      ) : (
        <>
          <EventForm
            communities={mine.data ?? []}
            submitLabel={t("campus.events.submit")}
            onSubmit={async (v) => {
              try {
                const r = await createEvent(sb, v);
                toast(t(r.status === "published" ? "campus.events.createdPublished" : "campus.events.createdPending"), "success");
                setCreating(false);
                list.reload();
              } catch (e) {
                onError(e);
              }
            }}
          />
          <Button title={t("common.cancel")} variant="ghost" onPress={() => setCreating(false)} />
        </>
      )}
      {list.loading && !list.data ? (
        <Skeleton height={100} />
      ) : list.error && !list.data ? (
        <ErrorState title={t("campus.loadFailed")} description={online ? undefined : t("campus.offline")} action={<Button title={t("common.retry")} onPress={list.reload} />} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title={t("campus.events.empty")} description={t("campus.events.emptyBody")} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {(list.data ?? []).map((e: EventRow) => (
            <EventCardView key={e.id} e={e} onOpen={() => router.push(`/campus/event/${e.id}`)} />
          ))}
        </View>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ study groups
function GroupsTab() {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const onError = useCampusError();
  const { supabase: sb } = useUser();
  const groups = useAsync(() => discoverCommunities(sb, { q: "", kind: "group", joined: "joined" }, 0, 100), [sb]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const bad = textError(t as (k: string) => string, name);
  return (
    <View style={{ gap: spacing.lg }}>
      <AppText muted>{t("campus.groups.intro")}</AppText>
      {groups.loading && !groups.data ? (
        <Skeleton height={80} />
      ) : groups.error && !groups.data ? (
        <ErrorState title={t("campus.loadFailed")} action={<Button title={t("common.retry")} onPress={groups.reload} />} />
      ) : (groups.data ?? []).length === 0 ? (
        <EmptyState title={t("campus.groups.empty")} />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {(groups.data ?? []).map((c) => (
            <CommunityCardView key={c.id} c={c} onOpen={() => router.push(`/campus/community/${c.id}`)} />
          ))}
        </View>
      )}
      <ExpandCard label={t("campus.groups.joinTitle")} header={<AppText variant="heading">{t("campus.groups.joinTitle")}</AppText>}>
        <Input label={t("campus.groups.codeLabel")} placeholder={t("campus.groups.codePlaceholder")} value={code} onChangeText={(v) => setCode(normalizeInviteCode(v))} autoCapitalize="characters" autoCorrect={false} />
        <Button
          title={t("campus.groups.joinSubmit")}
          loading={busy === "join"}
          disabled={!isInviteCode(code)}
          onPress={async () => {
            setBusy("join");
            try {
              const id = await joinByCode(sb, code);
              toast(t("campus.groups.joined"), "success");
              setCode("");
              router.push(`/campus/community/${id}`);
            } catch (e) {
              onError(e);
            } finally {
              setBusy(null);
            }
          }}
        />
      </ExpandCard>
      <ExpandCard label={t("campus.groups.createTitle")} header={<AppText variant="heading">{t("campus.groups.createTitle")}</AppText>}>
        <Input label={t("campus.groups.createName")} value={name} onChangeText={setName} maxLength={CAMPUS_LIMITS.communityName} error={bad} />
        <Button
          title={t("campus.groups.createSubmit")}
          loading={busy === "create"}
          disabled={name.trim().length < 2 || !!bad}
          onPress={async () => {
            setBusy("create");
            try {
              const id = await createCommunity(sb, { name: name.trim(), kind: "group", visibility: "private", description: "", rules: "" });
              setName("");
              router.push(`/campus/community/${id}`);
            } catch (e) {
              onError(e);
            } finally {
              setBusy(null);
            }
          }}
        />
      </ExpandCard>
    </View>
  );
}

// ------------------------------------------------------------------ search
function SearchResults({ q }: { q: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const res = useAsync(() => searchCampus(sb, q), [sb, q]);
  const empty = res.data && res.data.communities.length + res.data.posts.length + res.data.people.length === 0;
  if (res.loading && !res.data) return <Skeleton height={90} />;
  if (res.error && !res.data) return <ErrorState title={t("campus.loadFailed")} action={<Button title={t("common.retry")} onPress={res.reload} />} />;
  if (empty) return <EmptyState title={t("campus.search.empty")} />;
  const row = (key: string, title: string, sub: string, href: string, icon: "group" | "post" | "profile") => (
    <ListRow key={key} icon={icon} iconColor={theme.active} title={title} {...(sub ? { subtitle: sub } : null)} onPress={() => router.push(href)} accessibilityLabel={`${title}. ${sub}`} />
  );
  const section = (heading: string, rows: React.ReactNode[]) =>
    rows.length ? (
      <View style={{ gap: spacing.sm }}>
        <AppText variant="heading">{heading}</AppText>
        <ListGroup>{rows}</ListGroup>
      </View>
    ) : null;
  return (
    <View style={{ gap: spacing.lg }}>
      {section(t("campus.search.communities"), res.data!.communities.map((c) => row(c.id, c.name, t(`campus.communities.kind.${c.kind}`), `/campus/community/${c.id}`, "group")))}
      {section(t("campus.search.posts"), res.data!.posts.map((p) => row(p.id, p.title, `${p.community_name} · ${p.snippet}`, `/campus/post/${p.id}`, "post")))}
      {section(t("campus.search.people"), res.data!.people.map((p) => row(p.id, p.display_name ?? p.username ?? "", p.university_name ?? "", `/campus/user/${p.id}`, "profile")))}
    </View>
  );
}

// ------------------------------------------------------------------ screen
export function CampusScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { user } = useUser();
  const { theme } = useTheme();
  const roundBtn = { width: MIN_TOUCH, height: MIN_TOUCH, borderRadius: MIN_TOUCH / 2, backgroundColor: theme.card, alignItems: "center", justifyContent: "center" } as const;
  const tabs: { value: Tab; label: string }[] = [{ value: "feed", label: t("campus.tabs.feed") }, { value: "communities", label: t("campus.tabs.communities") }, { value: "events", label: t("campus.tabs.events") }, { value: "groups", label: t("campus.tabs.groups") }];
  const [tab, setTab] = useState<Tab>("feed");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const searching = debounced.trim().length >= 2;
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  return (
    <Screen ambient>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <HeroTitle muted={t("mobile.campus.heroMuted")} strong={t("mobile.campus.heroStrong")} />
        </View>
        <View style={{ flexDirection: "row", gap: 8, paddingTop: 4 }}>
          <PressableScale onPress={() => router.push(`/campus/user/${user.id}`)} accessibilityRole="button" accessibilityLabel={t("campus.profile.title")} style={roundBtn}>
            <Icon name="profile" color={theme.text} />
          </PressableScale>
          <PressableScale onPress={() => router.push("/notifications")} accessibilityRole="button" accessibilityLabel={t("notifications.bell")} style={roundBtn}>
            <Icon name="notifications" color={theme.text} />
          </PressableScale>
        </View>
      </View>
      <SearchField label={t("campus.search.label")} placeholder={t("campus.search.placeholder")} value={q} onChangeText={setQ} returnKeyType="search" autoCorrect={false} hint={q.length > 0 && q.trim().length < 2 ? t("campus.search.hint") : undefined} />
      {searching ? (
        <SearchResults q={debounced.trim()} />
      ) : (
        <>
          <PillRow label={t("campus.tabs.label")} value={tab} onChange={setTab} options={tabs} />
          {tab === "feed" ? <FeedTab onDiscover={() => setTab("communities")} /> : tab === "communities" ? <CommunitiesTab /> : tab === "events" ? <EventsTab /> : <GroupsTab />}
        </>
      )}
    </Screen>
  );
}
