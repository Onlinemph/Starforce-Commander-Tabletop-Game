# Online matches on Supabase

Persistent online battles with no server to deploy and no command line. You
paste one SQL file into the Supabase dashboard, copy two values out of it, and
that is the whole setup.

A match is stored the same way the game saves a battle locally: a setup
document plus an ordered list of actions. Postgres hands out the order,
Realtime relays each action to whoever is connected, and the match sits there
between sessions. Refresh, switch devices, come back next week — the battle
replays to exactly the board you left.

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
the five functions the game calls. Passwords are bcrypt-hashed by Postgres and
never readable by a browser.

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
  becomes the match. You get a **match code** and an **invite link**.
- **Join a match** — with a code and password from the host.

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
