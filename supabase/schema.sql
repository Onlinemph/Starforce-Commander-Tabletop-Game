-- StarForce Commander — persistent online matches on Supabase.
--
-- Paste this whole file into the Supabase dashboard's SQL Editor and run it
-- once. It creates two tables, turns on Realtime for the action feed, and
-- defines the handful of functions the game calls. Running it again is safe.
--
-- The shape mirrors how the game already saves a battle: a match is a setup
-- document plus an ordered list of actions. The database is the ordering
-- authority — clients propose actions, Postgres assigns the sequence number,
-- and Realtime relays each one to everyone watching. That is the whole
-- protocol, and it is why a refresh, a new device, or a week away all replay
-- to exactly the same board.

-- Supabase keeps extensions in their own schema; a plain Postgres puts them
-- in public. Install into whichever exists, and every function below searches
-- both — otherwise crypt() and gen_random_bytes() are simply invisible.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    begin
      execute 'create extension pgcrypto with schema extensions';
    exception when others then
      execute 'create extension pgcrypto';
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists sfc_matches (
  id            text primary key,
  name          text        not null,
  -- bcrypt, never the password itself, and never readable by a client:
  -- every read goes through a function below.
  password_hash text        not null,
  sides         jsonb       not null default '[]'::jsonb,
  -- The GameSetup the battle was created from (scenario, seed, fleets…).
  setup         jsonb       not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists sfc_actions (
  match_id   text        not null references sfc_matches(id) on delete cascade,
  seq        integer     not null,
  action     jsonb       not null,
  created_at timestamptz not null default now(),
  primary key (match_id, seq)
);

-- Listed in the match browser, or reachable only by its code. Added after the
-- first release, so existing databases pick it up on a re-run.
alter table sfc_matches add column if not exists is_public boolean not null default true;

-- Side claims, enforced by the ledger rather than by politeness. Maps a side
-- name to {key, at}: the claimant's per-browser key and when the claim was
-- last renewed. A claim goes stale after five minutes without renewal, so a
-- closed tab releases its chair by silence. Added after the first release.
alter table sfc_matches add column if not exists claims jsonb not null default '{}'::jsonb;

-- The sides the battle is waiting on, reported by connected clients so the
-- match browser can say whose move it is without opening the battle.
alter table sfc_matches add column if not exists waiting jsonb not null default '[]'::jsonb;

-- Each action may carry a fingerprint of the state it produced, so a client
-- applying it can detect that its board has drifted from the sender's and
-- resynchronise from the ledger instead of playing on in silence.
alter table sfc_actions add column if not exists hash text;

create index if not exists sfc_actions_match_seq on sfc_actions (match_id, seq);
create index if not exists sfc_matches_updated on sfc_matches (updated_at);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Matches are never read directly by a client — the password hash lives there,
-- and every path in goes through a function that checks the password first.
-- Actions are readable, because that is what Realtime delivers; they are only
-- game moves, and the match id is the secret that gates them.

alter table sfc_matches enable row level security;
alter table sfc_actions enable row level security;

drop policy if exists sfc_actions_readable on sfc_actions;
create policy sfc_actions_readable on sfc_actions for select using (true);

-- Deletes carry their old row to subscribers, so an undo can be recognised.
alter table sfc_actions replica identity full;

-- Realtime delivers inserts and deletes on the action feed.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'sfc_actions'
  ) then
    alter publication supabase_realtime add table sfc_actions;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The functions the game calls
-- ---------------------------------------------------------------------------
-- All are SECURITY DEFINER: they run with the owner's rights, so they can
-- reach past RLS — but each one checks the match password before doing
-- anything. That check is the whole security model, exactly as it was on the
-- previous server: know the code and the password, join the battle.

-- The signature gained p_public after the first release; the old one has to
-- go or a four-argument call becomes ambiguous.
drop function if exists sfc_create_match(text, text, jsonb, jsonb);

create or replace function sfc_create_match(
  p_name     text,
  p_password text,
  p_sides    jsonb,
  p_setup    jsonb,
  p_public   boolean default true
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id text;
begin
  if p_password is null or length(p_password) < 1 then
    raise exception 'A match needs a password.';
  end if;
  if p_setup is null then
    raise exception 'A match needs a battle.';
  end if;
  -- A short, unguessable code: it is half of what an invite carries.
  loop
    v_id := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from sfc_matches where id = v_id);
  end loop;

  insert into sfc_matches (id, name, password_hash, sides, setup, is_public)
  values (
    v_id,
    coalesce(nullif(p_name, ''), 'A StarForce battle'),
    crypt(p_password, gen_salt('bf')),
    coalesce(p_sides, '[]'::jsonb),
    p_setup,
    coalesce(p_public, true)
  );
  return v_id;
end $$;

/**
 * The match browser: what is on offer, without opening anything.
 *
 * Deliberately thin — a name, the sides, how far along it is and when it last
 * moved. No battle, no setup, and above all no password hash: joining still
 * costs the password, so listing a match gives nothing away but its existence.
 * Matches hosted privately are not listed at all.
 */
create or replace function sfc_list_matches(p_limit integer default 40)
returns jsonb
language sql security definer set search_path = public, extensions as $$
  select coalesce(jsonb_agg(t.row order by t.updated_at desc), '[]'::jsonb)
  from (
    select m.updated_at,
           jsonb_build_object(
             'id', m.id,
             'name', m.name,
             'sides', m.sides,
             'updatedAt', m.updated_at,
             'createdAt', m.created_at,
             'waiting', m.waiting,
             'moves', (select count(*) from sfc_actions a where a.match_id = m.id)
           ) as row
      from sfc_matches m
     where m.is_public
     order by m.updated_at desc
     limit greatest(coalesce(p_limit, 40), 1)
  ) t;
$$;

-- Open a match: the whole battle, if the password is right.
create or replace function sfc_open_match(p_id text, p_password text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  m    sfc_matches;
  acts jsonb;
begin
  select * into m from sfc_matches where id = upper(p_id);
  if not found then
    raise exception 'No match with that code.';
  end if;
  if m.password_hash <> crypt(p_password, m.password_hash) then
    raise exception 'That password does not open this match.';
  end if;

  select coalesce(jsonb_agg(a.action order by a.seq), '[]'::jsonb)
    into acts
    from sfc_actions a
   where a.match_id = m.id;

  return jsonb_build_object(
    'id', m.id,
    'name', m.name,
    'sides', m.sides,
    'setup', m.setup,
    'actions', acts
  );
end $$;

-- Append one action, at the position the sender expects it to take.
--
-- Two players can act in the same instant; both propose the same slot, and
-- the row lock lets exactly one win. The loser's proposal does not match the
-- ledger any more, so it is refused with -1 and that client re-reads the
-- ledger instead — the ledger wins, always, and both boards converge on it.
-- The signature gained p_hash after the first release; the old one has to go
-- or a four-argument call becomes ambiguous. p_hash defaults to null, so a
-- client on an older build still appends — its rows simply carry no
-- fingerprint, and receivers skip the check for them.
drop function if exists sfc_append_action(text, text, integer, jsonb);

create or replace function sfc_append_action(
  p_id       text,
  p_password text,
  p_seq      integer,
  p_action   jsonb,
  p_hash     text default null
) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  m      sfc_matches;
  v_next integer;
begin
  select * into m from sfc_matches where id = upper(p_id) for update;
  if not found then
    raise exception 'No match with that code.';
  end if;
  if m.password_hash <> crypt(p_password, m.password_hash) then
    raise exception 'That password does not open this match.';
  end if;

  select coalesce(max(seq), -1) + 1 into v_next
    from sfc_actions where match_id = m.id;
  if p_seq is not null and p_seq <> v_next then
    return -1; -- the sender is out of step; it will re-read and catch up
  end if;

  insert into sfc_actions (match_id, seq, action, hash) values (m.id, v_next, p_action, p_hash);
  update sfc_matches set updated_at = now() where id = m.id;
  return v_next;
end $$;

-- Claim a side, with the ledger as the referee.
--
-- Presence alone cannot stop two players taking the same chair in the same
-- instant — it only reports, after the fact, that both sat down. This does:
-- the row lock lets exactly one claim land. A claim names its holder by an
-- opaque per-browser key and must be renewed (any repeat claim renews it);
-- five silent minutes and the chair is free again, so a closed tab cannot
-- lock a side out of the match forever. One chair per key: claiming a side
-- releases any other side the same key held. A null side just releases.
create or replace function sfc_claim_side(
  p_id       text,
  p_password text,
  p_side     text,
  p_key      text
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  m     sfc_matches;
  k     text;
  entry jsonb;
  fresh jsonb := '{}'::jsonb;
begin
  select * into m from sfc_matches where id = upper(p_id) for update;
  if not found then
    raise exception 'No match with that code.';
  end if;
  if m.password_hash <> crypt(p_password, m.password_hash) then
    raise exception 'That password does not open this match.';
  end if;
  if p_key is null or length(p_key) < 1 then
    raise exception 'A claim needs a key.';
  end if;

  -- Keep only the claims that still bind: someone else's, and still warm.
  for k in select jsonb_object_keys(coalesce(m.claims, '{}'::jsonb)) loop
    entry := m.claims -> k;
    if (entry ->> 'key') is distinct from p_key
       and (entry ->> 'at')::timestamptz > now() - interval '5 minutes' then
      fresh := fresh || jsonb_build_object(k, entry);
    end if;
  end loop;

  if p_side is not null then
    if fresh ? p_side then
      update sfc_matches set claims = fresh where id = m.id;
      return 'taken';
    end if;
    fresh := fresh || jsonb_build_object(p_side, jsonb_build_object('key', p_key, 'at', now()));
  end if;

  update sfc_matches set claims = fresh where id = m.id;
  return 'ok';
end $$;

-- Whose move it is, for the match browser. Reported by connected clients
-- whenever the waiting set changes; deliberately does not touch updated_at,
-- which means "when the battle last moved".
create or replace function sfc_set_waiting(
  p_id       text,
  p_password text,
  p_waiting  jsonb
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  m sfc_matches;
begin
  select * into m from sfc_matches where id = upper(p_id) for update;
  if not found then
    raise exception 'No match with that code.';
  end if;
  if m.password_hash <> crypt(p_password, m.password_hash) then
    raise exception 'That password does not open this match.';
  end if;
  update sfc_matches set waiting = coalesce(p_waiting, '[]'::jsonb) where id = m.id;
end $$;

-- Undo: drop everything from `p_length_after` onward (the game's undo is a
-- replay of a shorter prefix, so this is the same operation on the ledger).
create or replace function sfc_undo(
  p_id           text,
  p_password     text,
  p_length_after integer
) returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  m sfc_matches;
begin
  select * into m from sfc_matches where id = upper(p_id) for update;
  if not found then
    raise exception 'No match with that code.';
  end if;
  if m.password_hash <> crypt(p_password, m.password_hash) then
    raise exception 'That password does not open this match.';
  end if;

  -- Same bargain as an append: undo only what the sender still agrees is
  -- there. If the ledger has moved on, refuse and let them re-read.
  if (select count(*) from sfc_actions where match_id = m.id) <> p_length_after + 1 then
    return -1;
  end if;

  delete from sfc_actions where match_id = m.id and seq >= greatest(p_length_after, 0);
  update sfc_matches set updated_at = now() where id = m.id;
  return p_length_after;
end $$;

-- Replace the whole battle (a new game started inside an existing match, or a
-- corrective resync). Setup and actions land together.
create or replace function sfc_replace_match(
  p_id       text,
  p_password text,
  p_setup    jsonb,
  p_actions  jsonb
) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  m sfc_matches;
  a jsonb;
  i integer := 0;
begin
  select * into m from sfc_matches where id = upper(p_id) for update;
  if not found then
    raise exception 'No match with that code.';
  end if;
  if m.password_hash <> crypt(p_password, m.password_hash) then
    raise exception 'That password does not open this match.';
  end if;

  delete from sfc_actions where match_id = m.id;
  for a in select * from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) loop
    insert into sfc_actions (match_id, seq, action) values (m.id, i, a);
    i := i + 1;
  end loop;

  update sfc_matches
     set setup = coalesce(p_setup, setup), updated_at = now()
   where id = m.id;
end $$;

-- Housekeeping: forget matches nobody has touched in a long while. Call it by
-- hand from the SQL editor, or schedule it if you enable pg_cron:
--   select cron.schedule('sfc-sweep', '0 4 * * *', $$select sfc_sweep(30)$$);
create or replace function sfc_sweep(p_days integer default 30)
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  n integer;
begin
  delete from sfc_matches where updated_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics n = row_count;
  return n;
end $$;

-- The browser calls these with the public anon key; nothing else is exposed.
grant execute on function sfc_create_match(text, text, jsonb, jsonb, boolean) to anon, authenticated;
grant execute on function sfc_list_matches(integer)                    to anon, authenticated;
grant execute on function sfc_open_match(text, text)                   to anon, authenticated;
grant execute on function sfc_append_action(text, text, integer, jsonb, text) to anon, authenticated;
grant execute on function sfc_undo(text, text, integer)                to anon, authenticated;
grant execute on function sfc_replace_match(text, text, jsonb, jsonb)  to anon, authenticated;
grant execute on function sfc_claim_side(text, text, text, text)       to anon, authenticated;
grant execute on function sfc_set_waiting(text, text, jsonb)           to anon, authenticated;

-- PostgREST answers from a cached picture of the schema, and it matches
-- functions by their exact argument names — so a stale cache reports a
-- brand-new function as "could not find the function ... in the schema
-- cache". Supabase reloads on its own within a moment; this makes it now.
notify pgrst, 'reload schema';
