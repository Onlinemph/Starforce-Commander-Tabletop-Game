-- StarForce Commander — the shared library of designed scenarios.
--
-- Paste this whole file into the Supabase dashboard's SQL Editor and run it
-- once. Running it again is safe. It is independent of `schema.sql` and of
-- `ship-library.sql`: any combination of the three works in one project.
--
-- The design follows the ship library exactly — entries are immutable and
-- addressed by their own content, because battle files reference scenarios by
-- id and must go on replaying the same way. Publishing an edited scenario is
-- a new entry; the only moderation lever is `hidden`, which only you can move.
--
-- One scenario-specific point: an entry stores the scenario AND every
-- non-canon ship form its force lists field (`forms`), with the references
-- rewritten to content-addressed ids. A downloaded scenario therefore works
-- on a machine that has never seen its fan ships — nothing dangles.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists sfc_scenarios (
  -- A hash of the packaged scenario, computed by the client. Publishing the
  -- same design twice is the same row.
  fingerprint   text primary key,
  -- The whole CustomScenario. Clients import this, never a reference to it.
  scenario      jsonb       not null,
  -- Every non-canon ShipForm the force lists field, ids rewritten to match.
  forms         jsonb       not null default '[]',
  name          text        not null,
  author        text        not null default '',
  notes         text        not null default '',
  -- How big a battle: shown in the browse list without parsing the jsonb.
  sides         int         not null default 2,
  hulls         int         not null default 0,
  downloads     int         not null default 0,
  reports       int         not null default 0,
  -- Your moderation switch. Nothing a client can call will set this.
  hidden        boolean     not null default false,
  published_at  timestamptz not null default now()
);

create index if not exists sfc_scenarios_browse
  on sfc_scenarios (hidden, published_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Deny everything by default and expose only the functions below, exactly as
-- the ship library does: no policies, so direct table access is refused; the
-- SECURITY DEFINER functions are the entire API surface.

alter table sfc_scenarios enable row level security;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Publish a scenario. Idempotent by fingerprint.
create or replace function sfc_publish_scenario(
  p_fingerprint text,
  p_scenario    jsonb,
  p_forms       jsonb,
  p_name        text,
  p_author      text,
  p_notes       text,
  p_sides       int,
  p_hulls       int
) returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_existing text;
begin
  -- Wider than a ship form's cap: a package carries the scenario plus its fan
  -- hulls. Checked in the client too; this one is the actual limit.
  if octet_length(p_scenario::text) + octet_length(p_forms::text) > 262144 then
    raise exception 'That scenario is larger than any battle.';
  end if;
  if length(coalesce(p_author, '')) > 40 or length(coalesce(p_notes, '')) > 500 then
    raise exception 'Author or notes too long.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A scenario needs a name.';
  end if;
  if p_fingerprint !~ '^[0-9a-f]{16}$' then
    raise exception 'Malformed fingerprint.';
  end if;

  select fingerprint into v_existing from sfc_scenarios where fingerprint = p_fingerprint;
  if v_existing is not null then
    return v_existing;
  end if;

  insert into sfc_scenarios
    (fingerprint, scenario, forms, name, author, notes, sides, hulls)
  values
    (p_fingerprint, p_scenario, coalesce(p_forms, '[]'::jsonb), trim(p_name),
     coalesce(trim(p_author), ''), coalesce(trim(p_notes), ''),
     greatest(2, coalesce(p_sides, 2)), greatest(0, coalesce(p_hulls, 0)));

  return p_fingerprint;
end;
$$;

-- Browse. Hidden rows and rows the community has flagged repeatedly never
-- leave the database.
create or replace function sfc_browse_scenarios(
  p_search text default '',
  p_limit  int  default 50,
  p_offset int  default 0
) returns table (
  fingerprint  text,
  scenario     jsonb,
  forms        jsonb,
  name         text,
  author       text,
  notes        text,
  sides        int,
  hulls        int,
  downloads    int,
  published_at timestamptz
)
language sql
security definer
set search_path = public, extensions
as $$
  select s.fingerprint, s.scenario, s.forms, s.name, s.author, s.notes,
         s.sides, s.hulls, s.downloads, s.published_at
  from sfc_scenarios s
  where not s.hidden
    and s.reports < 5
    and (coalesce(trim(p_search), '') = ''
         or s.name ilike '%' || trim(p_search) || '%'
         or s.author ilike '%' || trim(p_search) || '%')
  order by s.published_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Count an import — "somebody set this battle up", not "somebody scrolled by".
create or replace function sfc_record_scenario_download(p_fingerprint text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update sfc_scenarios
     set downloads = downloads + 1
   where fingerprint = p_fingerprint and not hidden;
$$;

-- Flag an entry. Five reports takes it out of the browse results pending your
-- look; clear it by zeroing `reports` in the dashboard, or confirm with `hidden`.
create or replace function sfc_report_scenario(p_fingerprint text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update sfc_scenarios
     set reports = reports + 1
   where fingerprint = p_fingerprint;
$$;

-- The publishable (anon) key may call exactly these four and nothing else.
grant execute on function sfc_publish_scenario(text, jsonb, jsonb, text, text, text, int, int) to anon, authenticated;
grant execute on function sfc_browse_scenarios(text, int, int) to anon, authenticated;
grant execute on function sfc_record_scenario_download(text) to anon, authenticated;
grant execute on function sfc_report_scenario(text) to anon, authenticated;
