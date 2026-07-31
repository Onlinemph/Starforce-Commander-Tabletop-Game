# The match service

A tiny Cloudflare Worker that keeps online matches alive. One Durable Object
per match stores the battle as the same `(setup + actions)` document the game
saves locally, appends actions in arrival order, and relays them over
websockets to whoever is connected. No game rules run here — the clients hold
the engine; this is a password-gated, ordered ledger of a few kilobytes per
match.

Matches survive everyone leaving. A player who refreshes, switches devices,
or returns days later replays the record and stands exactly where the battle
stands. Matches with no activity for **7 days** are deleted (one constant,
`MATCH_TTL_MS` in `src/worker.ts`, if you want a different lease).

## Deploy (once, ~2 minutes)

You need a free Cloudflare account.

```sh
cd server
npm install
npx wrangler login     # opens the browser to authorise
npx wrangler deploy
```

`deploy` prints your service URL, something like
`https://sfc-matches.<your-subdomain>.workers.dev`. Paste that into the
**Online** panel's *Match server* field in the game — it is remembered per
browser. That's the whole setup; the free tier comfortably carries a hobby
community.

## Develop locally

```sh
cd server
npm run dev            # wrangler dev --local, listens on http://localhost:8787
```

Point the game's *Match server* field at `localhost:8787`.

## Protocol

- `POST /api/matches` `{name, password, sides, save}` → `{id}` — create a
  match from a battle file. The password is stored as a SHA-256 hash.
- `GET /api/matches/:id` → `{name, sides, actions, present}` — existence and
  presence, no password required.
- `WS /api/matches/:id/ws` — the live link. First message must be
  `{t:'hello', password, side?}`; then `action`/`undo`/`replace`/`syncreq`
  flow exactly like the game's peer-to-peer remote play, with the service as
  the ordering authority: an action whose sequence number does not extend the
  ledger is answered with a corrective `sync` (a whole battle file), and both
  ends converge.
