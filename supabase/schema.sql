-- =====================================================================
-- Liner Notes - database schema
-- Run this whole file once in the Supabase SQL Editor.
--
-- Reading guide:
--   1. Tables            - what we store
--   2. Helper functions  - small reusable checks
--   3. Trigger           - the automatic edit history
--   4. Row Level Security- WHO may read or write each row
--   5. Seed              - link your two Auth users to their profiles
--
-- Key idea: the browser talks to Postgres directly using the public
-- "anon" key. That key is visible to everyone, so the ONLY thing that
-- protects your data is Row Level Security (RLS). Every table below has
-- RLS switched on, and a table with RLS on and no policy allows nothing.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------

-- One row per partner. The id IS the Supabase Auth user id, which is how
-- we later answer "is the logged-in person one of the two admins?".
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username in ('machukaw', 'novyyzhv')),
  display_name text not null,
  tagline      text,
  created_at   timestamptz not null default now()
);

-- All three public lists live in one table, told apart by "category".
--   favorite_song : title = song,   artist = performer
--   top_artist    : title = band or artist name, artist is left null
--   top_liked     : title = track,  artist = performer
create table public.music_favorites (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  category   text not null check (category in ('favorite_song', 'top_artist', 'top_liked')),
  position   smallint not null check (position between 1 and 10),
  title      text not null check (char_length(title) between 1 and 200),
  artist     text check (char_length(artist) <= 200),
  created_at timestamptz not null default now(),
  -- One entry per rank per list: there can only be one "number 3".
  unique (profile_id, category, position)
);

-- Song suggestions left by guests. Guests can INSERT but never read.
create table public.recommendations (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  guest_name text check (char_length(guest_name) <= 80),
  song_title text not null check (char_length(song_title) between 1 and 200),
  artist     text check (char_length(artist) <= 200),
  message    text check (char_length(message) <= 500),
  created_at timestamptz not null default now()
);

-- The secret feed.
create table public.dedications (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 200),
  artist         text not null check (char_length(artist) between 1 and 200),
  audio_url      text check (audio_url is null or audio_url like 'https://%'),
  lyrics_snippet text check (char_length(lyrics_snippet) <= 600),
  custom_title   text check (char_length(custom_title) <= 120),
  note           text check (char_length(note) <= 4000),
  is_archived    boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index dedications_created_at_idx on public.dedications (created_at desc);

-- One row per note edit. Nobody writes here directly: the trigger in
-- section 3 does it, so the history cannot be skipped or faked by the UI.
create table public.dedication_edit_logs (
  id            bigint generated always as identity primary key,
  dedication_id uuid not null references public.dedications (id) on delete cascade,
  editor_id     uuid references public.profiles (id) on delete set null,
  previous_note text,
  new_note      text,
  edited_at     timestamptz not null default now()
);

create index dedication_edit_logs_dedication_idx
  on public.dedication_edit_logs (dedication_id, edited_at desc);

-- Private key/value settings (currently only the guest passcode hash).
-- RLS is on with no policies, so the API cannot read it at all.
create table public.app_settings (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS
-- ---------------------------------------------------------------------

-- "Is the caller one of the two partners?"
-- SECURITY DEFINER = runs with the function owner's rights, so it works
-- no matter what policies exist on profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- Guest passcode check. Returns true when no passcode is configured
-- (the gate is optional) or when the attempt matches the stored hash.
-- The hash never leaves the database.
create or replace function public.check_guest_passcode(attempt text default null)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  stored_hash text;
begin
  select value into stored_hash from public.app_settings where key = 'guest_passcode_hash';
  if stored_hash is null then
    return true;
  end if;
  if attempt is null then
    return false;
  end if;
  return stored_hash = crypt(lower(trim(attempt)), stored_hash);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. TRIGGER: automatic edit history
-- ---------------------------------------------------------------------

create or replace function public.log_dedication_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- "is distinct from" is a null-safe "<>".
  -- updated_at only moves when the words change, not on archive/restore.
  if new.note is distinct from old.note
     or new.custom_title is distinct from old.custom_title
     or new.lyrics_snippet is distinct from old.lyrics_snippet then
    new.updated_at := now();
  end if;

  if new.note is distinct from old.note then
    insert into public.dedication_edit_logs (dedication_id, editor_id, previous_note, new_note)
    values (old.id, auth.uid(), old.note, new.note);
  end if;
  return new;
end;
$$;

create trigger dedications_log_edit
  before update on public.dedications
  for each row execute function public.log_dedication_edit();

-- ---------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
-- Two layers, both required:
--   GRANT  = may this role touch the table at all?
--   POLICY = which rows?
-- Roles: "anon" is a visitor without a login, "authenticated" is anyone
-- who signed in through Supabase Auth.

alter table public.profiles             enable row level security;
alter table public.music_favorites      enable row level security;
alter table public.recommendations      enable row level security;
alter table public.dedications          enable row level security;
alter table public.dedication_edit_logs enable row level security;
alter table public.app_settings         enable row level security;

revoke all on public.profiles, public.music_favorites, public.recommendations,
              public.dedications, public.dedication_edit_logs, public.app_settings
  from anon, authenticated;

grant select on public.profiles, public.music_favorites to anon, authenticated;
grant update (display_name, tagline) on public.profiles to authenticated;
grant insert, update, delete on public.music_favorites to authenticated;
grant insert on public.recommendations to anon, authenticated;
grant select, delete on public.recommendations to authenticated;
grant select, insert, delete on public.dedications to authenticated;
-- Column-level grant: title, artist, author and created_at can never be rewritten.
grant update (note, custom_title, lyrics_snippet, audio_url, is_archived)
  on public.dedications to authenticated;
grant select on public.dedication_edit_logs to authenticated;

grant execute on function public.check_guest_passcode(text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- profiles: world-readable, each partner edits only their own row.
create policy "profiles are public"
  on public.profiles for select to anon, authenticated using (true);
create policy "partners edit own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- music_favorites: world-readable, each partner manages their own lists.
create policy "favorites are public"
  on public.music_favorites for select to anon, authenticated using (true);
create policy "partners manage own favorites"
  on public.music_favorites for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- recommendations: anyone may drop one in, only the partners may read.
create policy "anyone can recommend"
  on public.recommendations for insert to anon, authenticated with check (true);
create policy "partners read recommendations"
  on public.recommendations for select to authenticated using (public.is_admin());
create policy "partners delete own recommendations"
  on public.recommendations for delete to authenticated using (profile_id = auth.uid());

-- dedications: invisible to everyone except the two partners.
-- Both can read everything; only the author can change or remove a post.
create policy "partners read dedications"
  on public.dedications for select to authenticated using (public.is_admin());
create policy "partners create dedications"
  on public.dedications for insert to authenticated
  with check (public.is_admin() and author_id = auth.uid());
create policy "authors update own dedications"
  on public.dedications for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "authors delete own dedications"
  on public.dedications for delete to authenticated using (author_id = auth.uid());

-- edit logs: read-only for the partners. Rows are written by the trigger.
create policy "partners read edit logs"
  on public.dedication_edit_logs for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- 5. SEED  (edit the placeholders, then run this part separately)
-- ---------------------------------------------------------------------
-- First create the two users in Dashboard > Authentication > Users
-- ("Add user", tick "Auto Confirm"). Then also turn OFF
-- Authentication > Sign In / Providers > "Allow new users to sign up",
-- so nobody else can ever create an account.
--
-- insert into public.profiles (id, username, display_name, tagline)
-- select id, 'machukaw', 'Machukaw', 'A line about your taste in music'
--   from auth.users where email = 'FIRST_ADMIN_EMAIL';
--
-- insert into public.profiles (id, username, display_name, tagline)
-- select id, 'novyyzhv', 'Novyyzhv', 'A line about your taste in music'
--   from auth.users where email = 'SECOND_ADMIN_EMAIL';
--
-- Example favorites (repeat per list, positions 1 to 10):
-- insert into public.music_favorites (profile_id, category, position, title, artist)
-- select id, 'top_artist', 1, 'Band name', null from public.profiles where username = 'machukaw';
--
-- Optional guest passcode (skip this and the site is open to guests).
-- Stored as a bcrypt hash; matching ignores case and outer spaces.
-- insert into public.app_settings (key, value)
-- values ('guest_passcode_hash', extensions.crypt('your passcode here', extensions.gen_salt('bf')))
-- on conflict (key) do update set value = excluded.value;
--
-- To remove the passcode again:
-- delete from public.app_settings where key = 'guest_passcode_hash';
