-- Extensions, enums and shared utilities. Target: Postgres 15 + pgvector.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create type public.app_role as enum ('student', 'moderator', 'admin', 'super_admin');
create type public.doc_status as enum ('pending_upload', 'uploaded', 'processing', 'ready', 'failed');
create type public.job_state as enum ('queued', 'running', 'succeeded', 'failed', 'dead');
create type public.message_role as enum ('user', 'assistant', 'system');
create type public.question_kind as enum ('mcq', 'true_false', 'short_answer');
create type public.community_visibility as enum ('public', 'private');
create type public.community_role as enum ('member', 'moderator', 'owner');
create type public.membership_status as enum ('active', 'pending', 'banned');
create type public.post_kind as enum ('post', 'question');
create type public.content_status as enum ('pending', 'published', 'removed');
create type public.resource_kind as enum ('note', 'past_exam', 'slides', 'other');
create type public.resource_visibility as enum ('private', 'university', 'public');
create type public.report_status as enum ('open', 'reviewing', 'actioned', 'dismissed');
create type public.takedown_status as enum ('open', 'accepted', 'rejected');
create type public.enrollment_status as enum ('enrolled', 'completed', 'dropped');
create type public.task_status as enum ('todo', 'doing', 'done');
create type public.listing_kind as enum ('internship', 'full_time', 'part_time', 'volunteer', 'scholarship');
create type public.sub_plan as enum ('free', 'plus', 'pro');
create type public.sub_status as enum ('active', 'trialing', 'past_due', 'canceled', 'expired');

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;
