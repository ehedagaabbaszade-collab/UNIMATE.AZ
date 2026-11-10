-- Account data export: campus, notes, gamification and settings join export_my_data(). Postgres 15 syntax only.
-- Pre-existing keys (posts, anonymous_posts, comments incl. the caller's replies in anonymous threads, reactions, memberships,
-- following, resources, resource_ratings, resource_saves, cv_documents, opportunity_tracking, ...) are unchanged. Added here:
-- event RSVPs, planner links, achievements, challenge progress, leaderboard opt-in, campus discoverability and followers
-- COUNT only. SECURITY INVOKER with an explicit ownership filter on every subquery (RLS applies too); nothing belonging to
-- another user is returned, and anonymous posts are matched through post_private_authors for the caller's own rows only.
alter function public.export_my_data() rename to export_my_data_pre_campus;
create function public.export_my_data() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select public.export_my_data_pre_campus() || jsonb_build_object(
    'event_rsvps', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at) from public.event_rsvps r where r.user_id = auth.uid()), '[]'),
    'event_planner_links', coalesce((select jsonb_agg(to_jsonb(l) order by l.created_at) from public.event_planner_links l where l.user_id = auth.uid()), '[]'),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'unlocked_at', ua.unlocked_at) order by ua.unlocked_at)
        from public.user_achievements ua join public.achievements a on a.id = ua.achievement_id where ua.user_id = auth.uid()), '[]'),
    'challenge_progress', coalesce((select jsonb_agg(to_jsonb(p) order by p.updated_at) from public.user_challenge_progress p where p.user_id = auth.uid()), '[]'),
    'leaderboard_opt_in', coalesce((select pr.leaderboard_opt_in from public.profiles pr where pr.id = auth.uid()), false),
    'campus_discoverable', coalesce((select pr.campus_discoverable from public.profiles pr where pr.id = auth.uid()), true),
    'follower_count', (select count(*) from public.follows f where f.followee_id = auth.uid()))
$$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;
-- export_my_data_pre_campus keeps its (renamed) grants: the invoker chain needs EXECUTE for authenticated; it returns only
-- the caller's own rows like the wrapper does.
revoke all on function public.export_my_data_pre_campus() from public, anon;
