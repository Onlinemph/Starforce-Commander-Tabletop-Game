# Online matches on Supabase

Persistent online battles with no server to deploy and no command line. You
paste one SQL file into the Supabase dashboard, copy two values out of it, and
that is the whole setup.

A match is stored the same way the game saves a battle locally: a setup
document plus an ordered list of actions. Postgres hands out the order,
Realtime relays each action to whoever is connected, and the match sits there
between sessions. Refresh, switch devices, come back next week — the battle
replays to exactly the board you left.

**StarForce: Border Command campaigns ride the very same tables** — an online
campaign is a match whose journal rows are campaign phase moves instead of
battle actions, hosted and joined from the Border Command screen. If this
schema is already set up for battles, online campaigns work with nothing new
to run.

## 1. Make a project

At [supabase.com](https://supabase.com), create a free account and a new
project. Any region; the free tier is more than enough. Give it a database
password when asked and keep it somewhere — you will not need it for the game,
only for the dashboard.

Wait for the project to finish provisioning (a minute or two).

## 2. Run the schema

In the project, open **SQL Editor** in the left sidebar → **New query**. Open
[`schema.sql`](./schema.sql) from this folder, copy the whole file, paste it
in, and press **Run**.

It should report success. Running it again later is safe — every statement is
written to be repeatable.

That file creates two tables (`sfc_matches`, `sfc_actions`), turns on Realtime
for the action feed, locks both tables behind Row Level Security, and defines
the functions the game calls. Passwords are bcrypt-hashed by Postgres and
never readable by a browser.

**Upgrading:** when the game gains features that need the database's help,
re-running the current `schema.sql` the same way is the whole upgrade. The
latest run adds server-refereed side claims (two players can no longer grab
the same side in the same instant), a state fingerprint on every action (two
boards that drift apart now notice and resynchronise by themselves), and a
whose-move column the match browser shows. The game works against an older
schema too — those three features just quietly stand down until you re-run.

## 3. Copy the two values

Easiest route: the **Connect** button at the top of the project dashboard. It
shows the Project URL and an API key together, ready to copy — under the
*App Frameworks* tab they appear as `SUPABASE_URL` and `SUPABASE_ANON_KEY` (or
`SUPABASE_PUBLISHABLE_KEY`).

Failing that, **Project Settings** → **API Keys** for the key, and **Project
Settings** → **Data API** for the URL. Supabase moved these out of the old
combined *API* page, so older walkthroughs (including the first draft of this
one) point at a page that no longer exists.

You need:

- **Project URL** — `https://<project-ref>.supabase.co`. If you cannot find it
  anywhere, read it off your browser's address bar: the dashboard URL is
  `supabase.com/dashboard/project/<project-ref>`, and your Project URL is
  `https://<project-ref>.supabase.co`.
- **A publishable key** — `sb_publishable_…`, or a legacy `eyJ…` *anon* key.
  Either works.

Both key types are designed to be public; they ship in the browser bundle of
every Supabase app. Never paste the **secret** key (`sb_secret_…`, formerly
`service_role`) — it bypasses every security rule, and the game has no use
for it.

## 4. Play

Open the game → **Online match**. Paste the Project URL into **Match service**
and the key into **Supabase API key** (the key field appears once the URL looks
like a Supabase project). Both are remembered in your browser.

Then either:

- **Host this battle** — names a password, and the battle currently on screen
  becomes the match. Set the scenario, fleets, terrain and options up *before*
  hosting: they are frozen into the match at that moment and nobody can change
  them afterwards. You get a **match code** and an **invite link**. Untick
  *List in the match browser* to keep a match reachable only by its code.
- **Join a match** — with a code and password from the host.
- **Open matches** — the browser lists every match hosted publicly on this
  project. Clicking one fills in its code; you still need its password.

While you are in a match the setup controls stand down — no scenario change,
no fleet picker, no ship builder, no rematch, no loading another battle — and
your view is pinned to the side you command, so enemy ship forms stay sealed.
Leave the match to get them back.

The invite link carries the project URL, the anon key, the match code and the
password in its `#fragment` — which browsers never send to any server. Whoever
opens it joins the match and picks a side, having configured nothing at all.

## 5. Optional: bake it into the hosted site

So that anyone opening your GitHub Pages build is connected without pasting
anything, set two repository variables (**Settings → Secrets and variables →
Actions → Variables**):

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | your Project URL |
| `SUPABASE_ANON_KEY` | your publishable (or legacy anon) key |

The deploy workflow passes them to the build as `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY`, and the Online panel starts pre-filled. Repository
*variables*, not secrets: these values end up in the client bundle either way,
which is what the anon key is for.

## Housekeeping

Matches persist until you remove them. To clear out old ones, run this in the
SQL editor whenever you like:

```sql
select sfc_sweep(30);   -- forget matches untouched for 30 days
```

If you enable the `pg_cron` extension (Database → Extensions), you can have it
run nightly instead:

```sql
select cron.schedule('sfc-sweep', '0 4 * * *', $$select sfc_sweep(30)$$);
```

## What this costs

Nothing, in practice. A battle is a few kilobytes of JSON; the free tier's
500 MB database and 2 million Realtime messages per month are wildly beyond
what a group of friends can play through.

## Security, honestly

The model is a tavern door: anyone with the match code *and* the password can
join a match, and the password is bcrypt-checked inside the database before any
read or write. Nobody can list matches, read another match's battle, or reach a
password hash — the tables are behind Row Level Security and every path in goes
through a function that checks the password first.

The action feed itself is readable by anyone who knows a match code, since that
is what Realtime delivers to subscribers. The codes are random 8-character
strings; guessing one gets an eavesdropper a fleet battle between strangers.

## Checking the setup before you play

Two quick checks, both from the dashboard or the address bar.

The schema is in place — run this in the SQL editor and expect six rows:

```sql
select routine_name from information_schema.routines
where routine_name like 'sfc_%' order by routine_name;
```

The key works — the game only ever calls functions, so test a function. Paste
this into a browser devtools console (F12), with your own URL and key:

```js
fetch('https://<project-ref>.supabase.co/rest/v1/rpc/sfc_open_match', {
  method: 'POST',
  headers: {
    apikey: '<your key>',
    Authorization: 'Bearer <your key>',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_id: 'ZZZZZZZZ', p_password: 'x' }),
}).then(r => r.text()).then(console.log)
```

Expect `{"code":"P0001","message":"No match with that code."}` — that refusal
is the success: the key authenticated and the function ran.

Two browser URLs that look like failures but are not worth testing: the bare
`/rest/v1/` root is API introspection and is restricted to secret keys
(*"Secret API key required"*), and table paths like `/rest/v1/sfc_actions`
depend on Data API settings the game never relies on. Neither says anything
about whether a match will work.

## If something does not work

- **"That password does not open this match."** — the password is wrong, or
  the code belongs to a different project.
- **"Could not open the live link to the project."** — the URL or anon key is
  wrong, or Realtime is disabled. Re-run `schema.sql`; the publication block
  at the top turns Realtime on for the action feed.
- **Actions do not arrive for the other player** — check **Database →
  Replication** (or re-run the schema) to confirm `sfc_actions` is in the
  `supabase_realtime` publication.
- **The match opens but the board is wrong** — the two players are on
  different builds of the game. Both should reload the same deployed site.

## The shared ship library (optional, independent)

`ship-library.sql` is a second, separate feature: a public library of fan-made
ship designs that anyone can browse and take a copy from, and publish to from
the ship builder. Run it the same way — paste the file into the SQL Editor
once. It shares nothing with the match tables, so you can run either, both, or
neither.

**Entries are immutable, and that is not a policy.** A saved battle is a setup
plus a journal, and custom ship forms travel *inside* it so a battle replays on
a machine that has never seen the design. If a library entry could be edited in
place, every saved battle and every online match that named it would quietly
replay into a different board. So an entry is keyed by a hash of the design
itself: publishing the same ship twice is one entry, and publishing an edited
one is a new entry. There is no update path and no delete path for clients.

Taking a copy is literal — the whole design is written into that browser's
roster, so it keeps working if the library goes away entirely.

**"I republished it and it never showed up."** Almost always this: the design
was already there. Publishing is keyed by a hash of the design, so publishing an
unchanged ship again writes nothing and keeps the original entry's date and
credit — and browsing is sorted newest-first, so a re-publish does not resurface
at the top. The design is in the library; it is just where it was before. Search
for it by name to confirm.

The dialog used to say the same "Published." to that case as to a real insert,
which left the person who did it with no way to tell whether it had worked. It
now says which happened, and when the original went up. That needs a current
copy of `ship-library.sql` — an older install cannot report it, and the dialog
says so rather than guessing. **Re-run the file if you installed it before
August 2026**; it drops and recreates `sfc_publish_design`, because the function
changed its return type from `text` to `jsonb` and `create or replace` cannot do
that on its own. Re-running the whole file is still safe.

**Checking what is actually in the library.** In the game, open the ship
library and search by name — that is the same call the browser makes and the
fastest answer to "did my publish land". From outside the game, paste this into
a browser devtools console (F12) with your own URL and key:

```js
fetch('https://<project-ref>.supabase.co/rest/v1/rpc/sfc_browse_designs', {
  method: 'POST',
  headers: {
    apikey: '<your key>',
    Authorization: 'Bearer <your key>',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ p_search: '', p_limit: 100 }),
})
  .then((r) => r.json())
  .then((rows) =>
    console.table(
      rows.map((d) => ({
        name: d.name,
        author: d.author,
        faction: d.faction,
        points: d.points,
        published: d.published_at.slice(0, 10),
      })),
    ),
  )
```

Pass `p_search: 'maersk'` to look for one design. If it is in that list it
published, whatever the dialog said and however long ago it went up.

**What you are on the hook for.** Anyone with the publishable key can publish,
so this is a public write surface. The guard rails in the SQL are:

- Row level security with **no policies**, so the four functions below are the
  entire API. No client can read a hidden entry, edit one, or delete one.
- A 64 KB cap on a design and length caps on the free text, enforced in the
  database rather than only in the browser.
- `sfc_report_design` lets players flag an entry; five reports takes it out of
  the browse results pending your look.
- `hidden` is your switch, settable only from the dashboard or with the service
  key. Set it to confirm a report, or zero the `reports` count to clear one.

Designs are pure data — there is no code in a ship form, and the game escapes
every string it renders — so the realistic risk is junk and offensive names,
not anything dangerous. Read the table occasionally.

| Function | What it does |
| --- | --- |
| `sfc_publish_design` | Insert an entry, keyed by fingerprint; a repeat is a no-op, and it says which it did |
| `sfc_browse_designs` | Search by name or author, filter by faction tag, newest first |
| `sfc_record_download` | Count an import — "somebody fielded this" |
| `sfc_report_design` | Flag an entry for you to look at |

Every entry carries a faction tag — one of the three printed flags or
`Independent` — chosen when it is published and defaulted from the design's own
faction. It is what the browser filters on. It is deliberately *not* what tells
a fan design from a printed one: a design may fly any flag it likes, and the
game separates the two by identity instead, so nothing published here can slip
into the canon roster however it is tagged or named.

## The shared scenario library (optional, independent)

`scenario-library.sql` is the same idea for designed scenarios: publish from
the scenario designer, browse and take a copy from the Library's Scenarios
tab. Run the file once in the SQL Editor. It is independent of both the match
schema and the ship library — any combination works in one project.

Everything above about immutability applies unchanged: entries are keyed by a
hash of the packaged design, publishing an edit makes a new entry, and the
only moderation levers are `hidden` and the report counter.

The one scenario-specific mechanism is **packaging**. A scenario's force lists
are references — ship form ids — and a designed scenario may field fan ships
that exist only in its author's browser. Published as-is those references
would dangle everywhere else, so the game publishes a package: the scenario
plus every non-canon form it fields, with the references rewritten to the
forms' content-addressed ids (the same `lib-…` ids the ship library mints).
Taking a copy imports the fan ships into the roster and the scenario into the
scenario list in one step, and the same entry lands under the same ids on
every machine, so battle files that reference it travel too. The size cap is
256 KB — a scenario and several fan hulls — enforced in the database.

| Function | What it does |
| --- | --- |
| `sfc_publish_scenario` | Insert an entry, keyed by fingerprint; a repeat is a no-op |
| `sfc_browse_scenarios` | Search by name or author, newest first |
| `sfc_record_scenario_download` | Count an import — "somebody set this battle up" |
| `sfc_report_scenario` | Flag an entry for you to look at |
