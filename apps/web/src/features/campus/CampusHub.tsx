"use client";

import { CAMPUS_LIMITS, COMMUNITY_KINDS, campusTextProblem, isInviteCode, normalizeInviteCode, type CampusLanguage, type CommunityKind, type CommunityListItem, type PostKind } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Card, EmptyState, ErrorState, Icon, Input, Select, Skeleton, Textarea, useOnlineStatus, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useUser } from "@/components/user";
import { useAsync } from "@/lib/use-async";
import { createCommunity, createEvent, createPost, discoverCommunities, ensureUniversityCommunity, homeFeed, joinByCode, listEvents, myCommunities, parseLocalDateTime, react, searchCampus, type CommunityFilters, type EventScope } from "./api";
import { usePagedPosts } from "./hooks";
import { Chips, CommunityCardView, EventCardView, PostCardView, languageOptions, useCampusError } from "./parts";

type Tab = "feed" | "communities" | "events" | "groups";
const sb = () => getBrowserClient();
const textError = (t: (k: string) => string, ...texts: string[]) => (texts.some((x) => campusTextProblem(x)) ? t("campus.errors.invalidText") : undefined);

// ------------------------------------------------------------------ university offer
function UniversityOffer({ mine, onJoined }: { mine: CommunityListItem[] | undefined; onJoined: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
  const user = useUser();
  const info = useAsync(async () => {
    const { data } = await sb().from("profiles").select("university_id, universities(name)").eq("id", user.id).maybeSingle();
    const uni = (data as { university_id: string | null; universities: { name: string } | { name: string }[] | null } | null) ?? null;
    const rel = uni?.universities;
    const name = Array.isArray(rel) ? rel[0]?.name : rel?.name;
    return uni?.university_id && name ? { id: uni.university_id, name: name.slice(0, 100) } : null;
  }, [user.id]);
  const [busy, setBusy] = useState(false);
  const u = info.data;
  if (!u || !mine || mine.some((c) => c.kind === "university" && c.university_id === u.id)) return null;
  return (
    <Card>
      <div className="stack">
        <h2 style={{ margin: 0 }}>{t("campus.communities.universityOfferTitle")}</h2>
        <p className="um-muted">{t("campus.communities.universityOfferBody", { name: u.name })}</p>
        <div className="row">
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await ensureUniversityCommunity(sb(), u.id, true);
                toast(t("campus.communities.joined"), "success");
                onJoined();
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("campus.communities.universityOfferCta", { name: u.name })}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ feed + composer
function Composer({ communities, onPosted }: { communities: CommunityListItem[]; onPosted: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const onError = useCampusError();
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
  if (!open)
    return (
      <div className="row">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Icon name="add" size={18} /> {t("campus.composer.open")}
        </Button>
      </div>
    );
  return (
    <Card>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await createPost(sb(), { community: chosen, title: title.trim(), body: body.trim(), kind, anonymous, language });
            toast(t("campus.composer.published"), "success");
            setTitle("");
            setBody("");
            setAnonymous(false);
            setOpen(false);
            onPosted();
          } catch (err) {
            onError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {joined.length === 0 ? (
          <p className="um-muted">{t("campus.composer.noCommunity")}</p>
        ) : (
          <>
            <Select label={t("campus.composer.community")} value={chosen} onChange={(e) => setCommunity(e.target.value)}>
              {joined.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Chips label={t("campus.composer.kind")} value={kind} onChange={(k) => { setKind(k); if (k !== "question") setAnonymous(false); }} options={[{ value: "post", label: t("campus.composer.post") }, { value: "question", label: t("campus.composer.question") }]} />
            <Input label={t("campus.composer.title")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={CAMPUS_LIMITS.title} required error={bad} />
            <Textarea label={t("campus.composer.body")} value={body} onChange={(e) => setBody(e.target.value)} maxLength={CAMPUS_LIMITS.body} rows={4} />
            {kind === "question" ? (
              <label className="row">
                <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
                <span>{t("campus.composer.anonymous")}</span>
              </label>
            ) : null}
            {anonymous ? <p className="um-muted">{t("campus.composer.anonymousHint")}</p> : null}
            <Chips label={t("campus.composer.language")} value={language} onChange={setLanguage} options={languageOptions(t("campus.composer.languageNone"))} />
            <p className="um-muted">{t("campus.composer.languageHint")}</p>
          </>
        )}
        <div className="row">
          <Button type="submit" loading={busy} disabled={!chosen || !title.trim() || !!bad}>
            {t("campus.composer.submit")}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function FeedTab({ onDiscover }: { onDiscover: () => void }) {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const onError = useCampusError();
  const [kind, setKind] = useState<PostKind | "">("");
  const [language, setLanguage] = useState<CampusLanguage | "">("");
  const mine = useAsync(() => myCommunities(sb()), []);
  const feed = usePagedPosts((cursor) => homeFeed(sb(), { cursor, kind, language }), `${kind}|${language}`);
  return (
    <div className="stack-lg">
      <UniversityOffer mine={mine.data} onJoined={() => { mine.reload(); feed.reload(); }} />
      <Composer communities={mine.data ?? []} onPosted={feed.reload} />
      <Chips label={t("campus.feed.filterLabel")} value={kind} onChange={setKind} options={[{ value: "", label: t("campus.feed.filterAll") }, { value: "post", label: t("campus.feed.filterPosts") }, { value: "question", label: t("campus.feed.filterQuestions") }]} />
      <Chips label={t("campus.feed.language")} value={language} onChange={setLanguage} options={languageOptions(t("campus.feed.languageAll"))} />
      {!online ? (
        <p className="um-muted" role="status">
          {t("campus.offline")}
        </p>
      ) : null}
      {feed.loading && feed.items.length === 0 ? (
        <div className="stack">
          <Skeleton height={130} />
          <Skeleton height={130} />
        </div>
      ) : feed.error && feed.items.length === 0 ? (
        <ErrorState title={t("campus.loadFailed")} {...(online ? {} : { description: t("campus.offline") })} action={<Button onClick={feed.reload}>{t("common.retry")}</Button>} />
      ) : feed.items.length === 0 ? (
        <EmptyState title={t("campus.feed.empty")} description={t("campus.feed.emptyBody")} action={<Button variant="secondary" onClick={onDiscover}>{t("campus.tabs.communities")}</Button>} />
      ) : (
        <div className="stack">
          {feed.items.map((p) => (
            <PostCardView
              key={p.id}
              post={p}
              onLike={async () => {
                try {
                  const r = await react(sb(), "post", p.id, "like", !p.my_liked);
                  feed.patch(p.id, { like_count: Number(r.like_count), my_liked: r.my_like });
                } catch (e) {
                  onError(e);
                }
              }}
            />
          ))}
          {feed.hasMore ? (
            <div className="row">
              <Button variant="secondary" loading={feed.loading} onClick={feed.more}>
                {t("campus.loadMore")}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ communities
function CommunitiesTab() {
  const { t } = useI18n();
  const router = useRouter();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const onError = useCampusError();
  const [f, setF] = useState<CommunityFilters>({ q: "", kind: "", joined: "all" });
  const list = useAsync(() => discoverCommunities(sb(), f), [f.q, f.kind, f.joined]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"faculty" | "course">("course");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [busy, setBusy] = useState(false);
  const bad = textError(t as (k: string) => string, name, description, rules);
  return (
    <div className="stack-lg">
      <Input label={t("campus.communities.searchLabel")} type="search" placeholder={t("campus.communities.searchPlaceholder")} value={f.q} onChange={(e) => setF((p) => ({ ...p, q: e.target.value }))} />
      <Chips label={t("campus.communities.kindLabel")} value={f.kind} onChange={(kindV) => setF((p) => ({ ...p, kind: kindV }))} options={[{ value: "", label: t("campus.communities.kind.all") }, ...COMMUNITY_KINDS.map((k) => ({ value: k as CommunityKind, label: t(`campus.communities.kind.${k}`) }))]} />
      <Chips label={t("campus.communities.scopeLabel")} value={f.joined} onChange={(joined) => setF((p) => ({ ...p, joined }))} options={[{ value: "all", label: t("campus.communities.scopeAll") }, { value: "joined", label: t("campus.communities.scopeJoined") }, { value: "not", label: t("campus.communities.scopeNotJoined") }]} />
      {!creating ? (
        <div className="row">
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <Icon name="add" size={18} /> {t("campus.communities.create")}
          </Button>
        </div>
      ) : (
        <Card>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                const id = await createCommunity(sb(), { name: name.trim(), kind, visibility, description: description.trim(), rules: rules.trim() });
                toast(t("campus.communities.created"), "success");
                setCreating(false);
                setName("");
                router.push(`/campus/community/${id}`);
              } catch (err) {
                onError(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Chips label={t("campus.communities.createKind")} value={kind} onChange={setKind} options={(["faculty", "course"] as const).map((k) => ({ value: k, label: t(`campus.communities.kind.${k}`) }))} />
            <Input label={t("campus.communities.createName")} value={name} onChange={(e) => setName(e.target.value)} maxLength={CAMPUS_LIMITS.communityName} required error={bad} />
            <Textarea label={t("campus.communities.createDescription")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={CAMPUS_LIMITS.description} />
            <Textarea label={t("campus.communities.createRules")} value={rules} onChange={(e) => setRules(e.target.value)} maxLength={CAMPUS_LIMITS.rules} />
            <Chips label={t("campus.communities.createVisibility")} value={visibility} onChange={setVisibility} options={[{ value: "public", label: t("campus.communities.visibilityPublic") }, { value: "private", label: t("campus.communities.visibilityPrivate") }]} />
            <p className="um-muted">{t(visibility === "public" ? "campus.communities.createPublicHint" : "campus.communities.createPrivateHint")}</p>
            <div className="row">
              <Button type="submit" loading={busy} disabled={name.trim().length < 2 || !!bad}>
                {t("campus.communities.createSubmit")}
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        </Card>
      )}
      {list.loading && !list.data ? (
        <Skeleton height={100} />
      ) : list.error && !list.data ? (
        <ErrorState title={t("campus.loadFailed")} {...(online ? {} : { description: t("campus.offline") })} action={<Button onClick={list.reload}>{t("common.retry")}</Button>} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title={t("campus.communities.empty")} description={t("campus.communities.emptyBody")} />
      ) : (
        <div className="grid-auto">
          {(list.data ?? []).map((c) => (
            <CommunityCardView key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ events
export interface EventFormValues {
  community: string | null;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  capacity: number | null;
  language: CampusLanguage | "";
}
export function EventForm({ communities, initial, submitLabel, onSubmit }: { communities: CommunityListItem[]; initial?: { title: string; description: string; location: string; startsAt: string; endsAt: string; capacity: string }; submitLabel: string; onSubmit: (v: EventFormValues) => Promise<void> }) {
  const { t } = useI18n();
  const joined = communities.filter((c) => c.my_status === "active");
  const [community, setCommunity] = useState("");
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
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const s = parseLocalDateTime(starts);
          const en = ends.trim() ? parseLocalDateTime(ends) : null;
          if (!s || (ends.trim() && !en) || Date.parse(s) <= Date.now()) {
            setDateError(true);
            return;
          }
          setBusy(true);
          try {
            await onSubmit({ community: community || null, title: title.trim(), description: description.trim(), location: location.trim(), startsAt: s, endsAt: en, capacity: capacity ? Number(capacity) : null, language });
          } finally {
            setBusy(false);
          }
        }}
      >
        {!initial ? (
          <Select label={t("campus.events.community")} value={community} onChange={(e) => setCommunity(e.target.value)}>
            <option value="">{t("campus.events.noCommunityOption")}</option>
            {joined.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Input label={t("campus.events.eventTitle")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={CAMPUS_LIMITS.eventTitle} required error={bad} />
        <Textarea label={t("campus.events.description")} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={CAMPUS_LIMITS.eventDescription} />
        <Input label={t("campus.events.location")} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={CAMPUS_LIMITS.location} />
        <div className="grid-auto">
          <Input label={t("campus.events.starts")} type="datetime-local" value={starts} onChange={(e) => { setStarts(e.target.value); setDateError(false); }} required error={dateError ? t("campus.events.invalidDate") : undefined} />
          <Input label={t("campus.events.ends")} type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
          <Input label={t("campus.events.capacity")} type="number" min={1} max={CAMPUS_LIMITS.capacity} value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, "").slice(0, 5))} />
        </div>
        <Chips label={t("campus.composer.language")} value={language} onChange={setLanguage} options={languageOptions(t("campus.composer.languageNone"))} />
        <div className="row">
          <Button type="submit" loading={busy} disabled={!title.trim() || !starts || !!bad}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function EventsTab() {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const { toast } = useToast();
  const onError = useCampusError();
  const [scope, setScope] = useState<EventScope>("upcoming");
  const list = useAsync(() => listEvents(sb(), scope), [scope]);
  const mine = useAsync(() => myCommunities(sb()), []);
  const [creating, setCreating] = useState(false);
  return (
    <div className="stack-lg">
      <Chips label={t("campus.events.scopeLabel")} value={scope} onChange={setScope} options={[{ value: "upcoming", label: t("campus.events.upcoming") }, { value: "going", label: t("campus.events.going") }, { value: "mine", label: t("campus.events.mine") }]} />
      {!creating ? (
        <div className="row">
          <Button variant="secondary" onClick={() => setCreating(true)}>
            <Icon name="add" size={18} /> {t("campus.events.create")}
          </Button>
        </div>
      ) : (
        <>
          <EventForm
            communities={mine.data ?? []}
            submitLabel={t("campus.events.submit")}
            onSubmit={async (v) => {
              try {
                const r = await createEvent(sb(), v);
                toast(t(r.status === "published" ? "campus.events.createdPublished" : "campus.events.createdPending"), "success");
                setCreating(false);
                list.reload();
              } catch (e) {
                onError(e);
              }
            }}
          />
          <div className="row">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </>
      )}
      {list.loading && !list.data ? (
        <Skeleton height={100} />
      ) : list.error && !list.data ? (
        <ErrorState title={t("campus.loadFailed")} {...(online ? {} : { description: t("campus.offline") })} action={<Button onClick={list.reload}>{t("common.retry")}</Button>} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title={t("campus.events.empty")} description={t("campus.events.emptyBody")} />
      ) : (
        <div className="grid-auto">
          {(list.data ?? []).map((e) => (
            <EventCardView key={e.id} e={e} />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ study groups
function GroupsTab() {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const onError = useCampusError();
  const groups = useAsync(() => discoverCommunities(sb(), { q: "", kind: "group", joined: "joined" }, 0, 100), []);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const bad = textError(t as (k: string) => string, name);
  return (
    <div className="stack-lg">
      <p className="um-muted">{t("campus.groups.intro")}</p>
      <div className="grid-auto">
        <Card>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy("join");
              try {
                const id = await joinByCode(sb(), code);
                toast(t("campus.groups.joined"), "success");
                setCode("");
                router.push(`/campus/community/${id}`);
              } catch (err) {
                onError(err);
              } finally {
                setBusy(null);
              }
            }}
          >
            <h2 style={{ margin: 0 }}>{t("campus.groups.joinTitle")}</h2>
            <Input label={t("campus.groups.codeLabel")} placeholder={t("campus.groups.codePlaceholder")} value={code} onChange={(e) => setCode(normalizeInviteCode(e.target.value).slice(0, 10))} autoComplete="off" autoCapitalize="characters" />
            <div className="row">
              <Button type="submit" loading={busy === "join"} disabled={!isInviteCode(code)}>
                {t("campus.groups.joinSubmit")}
              </Button>
            </div>
          </form>
        </Card>
        <Card>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy("create");
              try {
                const id = await createCommunity(sb(), { name: name.trim(), kind: "group", visibility: "private", description: "", rules: "" });
                setName("");
                router.push(`/campus/community/${id}`);
              } catch (err) {
                onError(err);
              } finally {
                setBusy(null);
              }
            }}
          >
            <h2 style={{ margin: 0 }}>{t("campus.groups.createTitle")}</h2>
            <Input label={t("campus.groups.createName")} value={name} onChange={(e) => setName(e.target.value)} maxLength={CAMPUS_LIMITS.communityName} error={bad} />
            <div className="row">
              <Button type="submit" loading={busy === "create"} disabled={name.trim().length < 2 || !!bad}>
                {t("campus.groups.createSubmit")}
              </Button>
            </div>
          </form>
        </Card>
      </div>
      <h2 style={{ margin: 0 }}>{t("campus.groups.mine")}</h2>
      {groups.loading && !groups.data ? (
        <Skeleton height={80} />
      ) : groups.error && !groups.data ? (
        <ErrorState title={t("campus.loadFailed")} action={<Button onClick={groups.reload}>{t("common.retry")}</Button>} />
      ) : (groups.data ?? []).length === 0 ? (
        <EmptyState title={t("campus.groups.empty")} />
      ) : (
        <div className="grid-auto">
          {(groups.data ?? []).map((c) => (
            <CommunityCardView key={c.id} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ search
function SearchResults({ q }: { q: string }) {
  const { t } = useI18n();
  const res = useAsync(() => searchCampus(sb(), q), [q]);
  const empty = res.data && res.data.communities.length + res.data.posts.length + res.data.people.length === 0;
  if (res.loading && !res.data) return <Skeleton height={90} />;
  if (res.error && !res.data) return <ErrorState title={t("campus.loadFailed")} action={<Button onClick={res.reload}>{t("common.retry")}</Button>} />;
  if (empty) return <EmptyState title={t("campus.search.empty")} />;
  const row = (key: string, title: string, sub: string, href: string, icon: "group" | "post" | "profile") => (
    <li key={key}>
      <Link href={href} className="list-item">
        <span className="list-item__main">
          <span className="list-item__title">
            <Icon name={icon} size={16} /> {title}
          </span>
          {sub ? <span className="um-muted">{sub}</span> : null}
        </span>
      </Link>
    </li>
  );
  return (
    <div className="stack-lg">
      {res.data!.communities.length ? <h2 style={{ margin: 0 }}>{t("campus.search.communities")}</h2> : null}
      <ul className="list">{res.data!.communities.map((c) => row(c.id, c.name, t(`campus.communities.kind.${c.kind}`), `/campus/community/${c.id}`, "group"))}</ul>
      {res.data!.posts.length ? <h2 style={{ margin: 0 }}>{t("campus.search.posts")}</h2> : null}
      <ul className="list">{res.data!.posts.map((p) => row(p.id, p.title, `${p.community_name} · ${p.snippet}`, `/campus/post/${p.id}`, "post"))}</ul>
      {res.data!.people.length ? <h2 style={{ margin: 0 }}>{t("campus.search.people")}</h2> : null}
      <ul className="list">{res.data!.people.map((p) => row(p.id, p.display_name ?? p.username ?? "", p.university_name ?? "", `/campus/user/${p.id}`, "profile"))}</ul>
    </div>
  );
}

// ------------------------------------------------------------------ page
export function CampusHub() {
  const { t } = useI18n();
  const user = useUser();
  const [tab, setTab] = useState<Tab>("feed");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(id);
  }, [q]);
  const searching = debounced.trim().length >= 2;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row row--between">
          <h1>{t("campus.title")}</h1>
          <Link className="um-btn um-btn--ghost um-btn--sm" href={`/campus/user/${user.id}`}>
            <Icon name="profile" size={16} /> {t("campus.profile.title")}
          </Link>
        </div>
        <p>{t("campus.subtitle")}</p>
      </div>
      <Input label={t("campus.search.label")} type="search" placeholder={t("campus.search.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} {...(q.length > 0 && q.trim().length < 2 ? { hint: t("campus.search.hint") } : {})} />
      {searching ? (
        <SearchResults q={debounced.trim()} />
      ) : (
        <>
          <Chips label={t("campus.tabs.label")} value={tab} onChange={setTab} options={[{ value: "feed", label: t("campus.tabs.feed") }, { value: "communities", label: t("campus.tabs.communities") }, { value: "events", label: t("campus.tabs.events") }, { value: "groups", label: t("campus.tabs.groups") }]} />
          {tab === "feed" ? <FeedTab onDiscover={() => setTab("communities")} /> : tab === "communities" ? <CommunitiesTab /> : tab === "events" ? <EventsTab /> : <GroupsTab />}
        </>
      )}
    </div>
  );
}
