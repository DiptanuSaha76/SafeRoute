-- SafeRoute MVP schema. Run in Supabase SQL Editor or `supabase db push`.
-- After creating your first admin account, promote it manually from SQL Editor:
-- update public.profiles set role = 'admin' where handle = 'your_handle';

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default 'SafeRoute member',
  role text not null default 'user' check (role in ('user', 'admin')),
  public_key_jwk jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_handle text;
begin
  requested_handle := lower(coalesce(new.raw_user_meta_data ->> 'handle', 'member_' || substr(new.id::text, 1, 8)));
  if requested_handle !~ '^[a-z0-9_]{3,24}$' then
    requested_handle := 'member_' || substr(new.id::text, 1, 8);
  end if;
  insert into public.profiles (id, handle, display_name)
  values (
    new.id,
    requested_handle,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), requested_handle)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Public profile data is needed to discover a chat recipient's public encryption key.
-- Never store private keys or plaintext E2EE messages in this table.
alter table public.profiles enable row level security;
drop policy if exists "authenticated users can read public profile data" on public.profiles;
create policy "authenticated users can read public profile data"
  on public.profiles for select to authenticated using (true);
drop policy if exists "users can update their own non-role profile fields" on public.profiles;
create policy "users can update their own non-role profile fields"
  on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated;
grant update (display_name, public_key_jwk) on public.profiles to authenticated;

create or replace function public.is_saferoute_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create table if not exists public.safe_places (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  description text,
  address text not null,
  city text not null,
  state text not null,
  country text not null default 'India',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  phone text,
  opening_hours text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  created_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists safe_places_status_city_idx on public.safe_places (status, country, state, city);
create index if not exists safe_places_lat_lon_idx on public.safe_places (latitude, longitude);
alter table public.safe_places enable row level security;
drop policy if exists "public can read verified safe places" on public.safe_places;
create policy "public can read verified safe places" on public.safe_places for select using (status = 'verified');
drop policy if exists "admins manage safe places" on public.safe_places;
create policy "admins manage safe places" on public.safe_places for all to authenticated using (public.is_saferoute_admin()) with check (public.is_saferoute_admin());

create table if not exists public.place_suggestions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  description text,
  address text not null,
  city text not null,
  state text not null,
  country text not null default 'India',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  phone text,
  opening_hours text,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists place_suggestions_status_idx on public.place_suggestions (status, created_at desc);
alter table public.place_suggestions enable row level security;
drop policy if exists "users submit own place suggestions" on public.place_suggestions;
create policy "users submit own place suggestions" on public.place_suggestions for insert to authenticated with check (submitted_by = auth.uid());
drop policy if exists "users read own suggestions and admins read all" on public.place_suggestions;
create policy "users read own suggestions and admins read all" on public.place_suggestions for select to authenticated using (submitted_by = auth.uid() or public.is_saferoute_admin());
drop policy if exists "admins review suggestions" on public.place_suggestions;
create policy "admins review suggestions" on public.place_suggestions for update to authenticated using (public.is_saferoute_admin()) with check (public.is_saferoute_admin());

create table if not exists public.helplines (
  id uuid primary key default gen_random_uuid(),
  country text not null,
  state text,
  city text,
  name text not null,
  category text not null,
  number text not null,
  description text,
  is_toll_free boolean not null default false,
  availability text,
  official_url text,
  is_active boolean not null default true,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists helplines_location_idx on public.helplines (country, state, city, is_active);
alter table public.helplines enable row level security;
drop policy if exists "public can read active helplines" on public.helplines;
create policy "public can read active helplines" on public.helplines for select using (is_active = true);
drop policy if exists "admins manage helplines" on public.helplines;
create policy "admins manage helplines" on public.helplines for all to authenticated using (public.is_saferoute_admin()) with check (public.is_saferoute_admin());

-- AI chat is not E2EE. Users must explicitly consent before sending anything.
-- Admins can review these records. Do not use this table for private chat.
create table if not exists public.support_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  created_at timestamptz not null default now()
);
create index if not exists support_chat_user_time_idx on public.support_chat_messages (user_id, created_at desc);
alter table public.support_chat_messages enable row level security;
drop policy if exists "users read own AI chat records" on public.support_chat_messages;
create policy "users read own AI chat records" on public.support_chat_messages for select to authenticated using (user_id = auth.uid());
drop policy if exists "users insert own AI chat records" on public.support_chat_messages;
create policy "users insert own AI chat records" on public.support_chat_messages for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "admins can review AI chat records" on public.support_chat_messages;
create policy "admins can review AI chat records" on public.support_chat_messages for select to authenticated using (public.is_saferoute_admin());

-- E2EE messages: database stores ciphertext + wrapped content keys only.
-- No admin SELECT policy exists intentionally.
create table if not exists public.private_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  wrapped_keys jsonb not null,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists private_messages_sender_recipient_time_idx on public.private_messages (sender_id, recipient_id, created_at);
create index if not exists private_messages_recipient_sender_time_idx on public.private_messages (recipient_id, sender_id, created_at);
alter table public.private_messages enable row level security;
drop policy if exists "chat participants can read encrypted messages" on public.private_messages;
create policy "chat participants can read encrypted messages" on public.private_messages for select to authenticated using (auth.uid() = sender_id or auth.uid() = recipient_id);
drop policy if exists "sender can insert encrypted messages" on public.private_messages;
create policy "sender can insert encrypted messages" on public.private_messages for insert to authenticated with check (auth.uid() = sender_id and recipient_id <> auth.uid());
drop policy if exists "sender can delete own encrypted messages" on public.private_messages;
create policy "sender can delete own encrypted messages" on public.private_messages for delete to authenticated using (auth.uid() = sender_id);

-- Seed India-wide numbers from official national sources. Local/state/city rows
-- should be added only after checking the relevant government department source.
insert into public.helplines (country, name, category, number, description, is_toll_free, availability, official_url, is_active, verified_at)
select 'India', 'Emergency Response Support System', 'All emergencies', '112', 'Nationwide emergency response number for police, fire, health and other emergencies.', true, '24×7', 'https://112.gov.in/', true, now()
where not exists (select 1 from public.helplines where country = 'India' and number = '112' and name = 'Emergency Response Support System');

insert into public.helplines (country, name, category, number, description, is_toll_free, availability, official_url, is_active, verified_at)
select 'India', 'Women Helpline', 'Women support', '181', 'Women seeking support or information; connects with emergency services and One Stop Centres.', true, '24×7 (confirm local implementation)', 'https://www.wcd.gov.in/public/women/help', true, now()
where not exists (select 1 from public.helplines where country = 'India' and number = '181' and name = 'Women Helpline');

insert into public.helplines (country, name, category, number, description, is_toll_free, availability, official_url, is_active, verified_at)
select 'India', 'Cyber Crime Helpline', 'Cybercrime', '1930', 'National cybercrime financial fraud reporting helpline.', true, 'Check current operating hours', 'https://www.cybercrime.gov.in/', true, now()
where not exists (select 1 from public.helplines where country = 'India' and number = '1930');

insert into public.helplines (country, name, category, number, description, is_toll_free, availability, official_url, is_active, verified_at)
select 'India', 'National Ambulance Service', 'Medical', '102', 'Ambulance service; availability and routing can vary by state.', true, 'Varies by state', 'https://www.india.gov.in/directory/helpline', true, now()
where not exists (select 1 from public.helplines where country = 'India' and number = '102');

insert into public.helplines (country, name, category, number, description, is_toll_free, availability, official_url, is_active, verified_at)
select 'India', 'Fire & Rescue', 'Fire', '101', 'Fire emergency number listed on the National Portal of India.', true, 'Check local availability', 'https://www.india.gov.in/directory/helpline', true, now()
where not exists (select 1 from public.helplines where country = 'India' and number = '101');
