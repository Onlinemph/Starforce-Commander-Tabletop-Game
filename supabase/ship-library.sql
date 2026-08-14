-- StarForce Commander — the shared library of fan-made ships.
--
-- Paste this whole file into the Supabase dashboard's SQL Editor and run it
-- once. Running it again is safe. It is independent of `schema.sql`: you can
-- have online matches without the library, the library without matches, or
-- both in the same project.
--
-- The shape follows from one fact about how this game stores a battle. A save
-- is a setup plus a journal of actions, and custom ship forms travel *inside*
-- it, so a battle replays on a machine that has never seen the design. If a
-- library entry could be edited in place, every saved battle and every online
-- match that named it would quietly replay into a different board.
--
-- So entries are immutable and addressed by their own content. There is no
-- update path and no delete path for clients: publishing an edited design
-- makes a new entry, and the old battles go on meaning what they meant. The
-- only moderation lever is `hidden`, which only you — holding the service key
-- or sitting in the dashboard — can move.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists sfc_ship_designs (
  -- A hash of the design itself, computed by the client. Publishing the same
  -- ship twice is the same row; this is the primary key precisely so it is.
  fingerprint   text primary key,
  -- The whole ShipForm. Clients import this, never a reference to it.
  form          jsonb       not null,
  name          text        not null,
  faction       text        not null default 'Custom',
  size_class    int         not null default 1,
  -- The designers' own point model, recorded so the browser can sort by it.
  -- Never a gate: an expensive ship is a legal ship.
  points        numeric     not null default 0,
  author        text        not null default '',
  notes         text        not null default '',
  downloads     int         not null default 0,
  reports       int         not null default 0,
  -- Your moderation switch. Nothing a client can call will set this.
  hidden        boolean     not null default false,
  published_at  timestamptz not null default now()
);

create index if not exists sfc_designs_browse
  on sfc_ship_designs (hidden, published_at desc);
create index if not exists sfc_designs_faction on sfc_ship_designs (faction);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Deny everything by default and expose only the functions below. A client
-- holding the publishable key can call those and nothing else: it cannot
-- read `hidden` rows, cannot update, and cannot delete.

alter table sfc_ship_designs enable row level security;

-- No policies are created, so direct table access is refused for anon and
-- authenticated alike. The functions below are SECURITY DEFINER and are the
-- entire API surface.

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Publish a design. Idempotent by fingerprint: the same ship published twice,
-- by the same person or by two people who happened to build it identically,
-- is one entry and keeps the first publisher's credit.
--
-- It returns *whether it inserted*, not just the fingerprint, and that matters
-- more than it sounds. A re-publish of an unchanged design is a no-op that
-- succeeds, and for a while the dialog said the same cheerful "Published." to
-- both cases — so somebody who republished a design and then failed to find it
-- at the top of the library had no way to tell whether it had gone in, been
-- deduplicated, or silently failed. Browsing sorts on `published_at`, which a
-- re-publish deliberately does not bump, so a deduplicated entry does not
-- resurface. The client can now say which happened, and when the original went
-- up.
--
-- `drop` first: `create or replace` cannot change a function's return type, and
-- this one used to return `text`. Running this file over an older install is
-- still safe.
drop function if exists sfc_publish_design(text, jsonb, text, text, int, numeric, text, text);

create or replace function sfc_publish_design(
  p_fingerprint text,
  p_form        jsonb,
  p_name        text,
  p_faction     text,
  p_size_class  int,
  p_points      numeric,
  p_author      text,
  p_notes       text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row sfc_ship_designs%rowtype;
begin
  -- Size is checked here as well as in the client: the client's copy is a
  -- courtesy to the person publishing, this one is the actual limit.
  if octet_length(p_form::text) > 65536 then
    raise exception 'That design is larger than any ship form.';
  end if;
  if length(coalesce(p_author, '')) > 40 or length(coalesce(p_notes, '')) > 500 then
    raise exception 'Author or notes too long.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'A design needs a name.';
  end if;
  if p_fingerprint !~ '^[0-9a-f]{16}$' then
    raise exception 'Malformed fingerprint.';
  end if;

  /*
   * Insert first and let the primary key arbitrate, rather than looking before
   * leaping. Two people publishing the same design in the same instant — or one
   * person double-clicking Publish — both find nothing on a prior `select` and
   * both then insert, and one of them gets a unique-violation instead of the
   * "already in the library" it should have got.
   */
  insert into sfc_ship_designs
    (fingerprint, form, name, faction, size_class, points, author, notes)
  values
    (p_fingerprint, p_form, trim(p_name), coalesce(nullif(trim(p_faction), ''), 'Custom'),
     greatest(1, coalesce(p_size_class, 1)), coalesce(p_points, 0),
     coalesce(trim(p_author), ''), coalesce(trim(p_notes), ''))
  on conflict (fingerprint) do nothing
  returning * into v_row;

  if found then
    return jsonb_build_object(
      'fingerprint', v_row.fingerprint,
      'created', true,
      'published_at', v_row.published_at,
      'author', v_row.author,
      'name', v_row.name
    );
  end if;

  -- The library already held this exact design. Report the entry that is
  -- actually there, which keeps the first publisher's date and credit.
  select * into v_row from sfc_ship_designs where fingerprint = p_fingerprint;
  if not found then
    raise exception 'That design could not be published.';
  end if;
  return jsonb_build_object(
    'fingerprint', v_row.fingerprint,
    'created', false,
    'published_at', v_row.published_at,
    'author', v_row.author,
    'name', v_row.name
  );
end;
$$;

-- Browse. Hidden rows and rows the community has flagged repeatedly never
-- leave the database.
create or replace function sfc_browse_designs(
  p_search  text default '',
  p_faction text default '',
  p_limit   int  default 50,
  p_offset  int  default 0
) returns table (
  fingerprint  text,
  form         jsonb,
  name         text,
  faction      text,
  size_class   int,
  points       numeric,
  author       text,
  notes        text,
  downloads    int,
  published_at timestamptz
)
language sql
security definer
set search_path = public, extensions
as $$
  select d.fingerprint, d.form, d.name, d.faction, d.size_class, d.points,
         d.author, d.notes, d.downloads, d.published_at
  from sfc_ship_designs d
  where not d.hidden
    and d.reports < 5
    and (coalesce(trim(p_search), '') = ''
         or d.name ilike '%' || trim(p_search) || '%'
         or d.author ilike '%' || trim(p_search) || '%')
    and (coalesce(trim(p_faction), '') = '' or d.faction = trim(p_faction))
  order by d.published_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Count an import. Deliberately separate from browsing so the number means
-- "somebody put this in a fleet", not "somebody scrolled past it".
create or replace function sfc_record_download(p_fingerprint text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update sfc_ship_designs
     set downloads = downloads + 1
   where fingerprint = p_fingerprint and not hidden;
$$;

-- Flag an entry. Five reports takes it out of the browse results pending your
-- look; you clear it by setting `reports` back to zero in the dashboard, or
-- confirm it by setting `hidden`.
create or replace function sfc_report_design(p_fingerprint text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update sfc_ship_designs
     set reports = reports + 1
   where fingerprint = p_fingerprint;
$$;

-- The publishable (anon) key may call exactly these four and nothing else.
grant execute on function sfc_publish_design(text, jsonb, text, text, int, numeric, text, text) to anon, authenticated;
grant execute on function sfc_browse_designs(text, text, int, int) to anon, authenticated;
grant execute on function sfc_record_download(text) to anon, authenticated;
grant execute on function sfc_report_design(text) to anon, authenticated;
