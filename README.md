# Kalshi NFL Board — 1080×1920

Plain HTML5/CSS/JS recreation of the deployed Kalshi NFL daily board
(`d20n9k8ckk7spf.cloudfront.net/ads/nfl-linknyc/daily-1080x1920/`): logo and
tagline, green glass frame, chrome helmets, team names, dot-matrix win
probabilities, `$100 →` payout pills, a flowing feed of executed trades, and a
rotation through the day's top matchups.

No build step and no dependencies.

## Run

```sh
node server.js                   # board + mock Kalshi API
open http://localhost:8787/
PORT=9000 node server.js         # another port
DEV=1 node server.js             # no caching, so edits show without a version bump
```

Open the page over http, not `file://`: browsers load fonts under CORS
rules, and Safari refuses local font files for a `file://` page. The data
URL comes from `apiBase` in `js/config.js` (`''` = same origin), overridable
with `?api=`. The board is authored at 1080×1920 and fits any window at
9:16 (rem-based, see [Layout](#layout)).

### URL params

| Param | Effect |
|---|---|
| *(none)* | Daily rotation: top `dailyGames` open games, `rotateMs` each |
| `?event=KXNFLGAME-26OCT01PITCLE` | Pin one matchup (away left, home right, read from the ticker) |
| `?api=https://…` | Data server base URL |

## Data

`server.js` is a zero-dependency dev server. It serves `index.html`,
`css/`, `js/` and `assets/` (nothing else), and mocks the three Kalshi
trade-api v2 endpoints the board reads with JSON from `data/`:

| Endpoint | Fixture |
|---|---|
| `GET /events?series_ticker=KXNFLGAME&status=open&limit=200&with_nested_markets=true` | `data/events.json` |
| `GET /events/{EVENT}?with_nested_markets=true` | `data/events/{EVENT}.json` |
| `GET /markets/trades?ticker={EVENT}-{TEAM}&limit=20` | `data/trades/{EVENT}-{TEAM}.json` |

The fixtures are a real snapshot of the live API (no invented values).
Refresh them with:

```sh
node scripts/snapshot.js         # replaces data/events and data/trades
```

The rotation only picks games dated today or later (New York time), so an old
snapshot eventually shows "Football returns soon" — re-run the script.

**Production:** point `apiBase` at the real server. It must expose the same
paths and response shape; Kalshi's API rejects browser calls from other
origins, so it has to be a server-side proxy (credentials stay there).

## Configuration — `js/config.js`

| Key | Meaning |
|---|---|
| `apiBase` | Data server base URL |
| `series`, `event` | Event series; `event` pins one ticker (`null` → daily rotation) |
| `dailyGames`, `rotateMs` | Rotation size, time per matchup |
| `fadeMs`, `swapFadeMs` | Crossfade duration (View Transitions); fade-out/in duration of the fallback |
| `prepareTimeoutMs` | Next game not ready by then → rotation skipped this cycle |
| `gamesRefreshMs`, `gamesRetryMs` | Re-select games every 5 min; retry every 30 s until a list loads |
| `oddsRefreshMs`, `tradesRefreshMs` | Poll intervals for the matchup on screen (15 s / 30 s) |
| `staleAfterMs` | Data older than this (120 s) is taken off screen |
| `helmetsPath` | Helmet folder |
| `feed` | Feed motion: tick gap, batch size; `visibleRows` sets the feed window height in rows (the row buffer is derived from it) |
| `text` | Status line copy per state |

Teams (name, colour, helmet slug) are in `js/teams.js`; helmet PNGs in
`assets/helmets/{slug}.png`.

## Fonts

Inter 400/600 (everything) and Bebas Neue 400 (team names) load from Google
Fonts. OO Theran (percentages) isn't on Google Fonts and is served from
`assets/fonts/`. The pill arrow is an inline SVG because Google's Inter
subsets don't include `→`.

## Structure

```
index.html          stage markup
css/styles.css      1080×1920 geometry, feed motion, state + rotation styles
js/config.js        configuration
js/teams.js         NFL team table
js/utils.js         pure helpers (ticker parsing, colours, money, text fitting)
js/games.js         daily game selection (port of the deployed daily-games.js)
js/api.js           cached JSON client: LRU cache, request dedupe, timeout,
                    429 backoff with Retry-After + jitter, stale fallback
js/data.js          game selection, polling, JSON -> per-game state
js/feed.js          trades feed animation only (no fetching)
js/board.js         rendering, display state machine, rotation
server.js           dev server: static files + mock JSON API
scripts/snapshot.js re-captures data/ from the live API
data/               JSON snapshot
assets/             wordmark, OO Theran, helmets (from the deployed board's CDN)
```

Animation and polling are independent: `data.js` polls on its own timers,
`feed.js` runs its own irregular tick and only reads the trades `board.js`
currently considers fresh.

## Layout

- **Sizing:** everything is in rem. `html { font-size: min(100vw / 108, 100vh / 192) }`
  makes 1rem = 10px at 1080×1920 and fits the 108rem × 192rem board into
  any viewport, keeping 9:16, without transforms or JS.
- **Flow:** normal flow, no absolute or fixed positioning. The stage is a
  flex column: the frame, then the disclaimer. The frame is a flex column:
  logo, headline, the matchup rows, the status line, the feed. Spacing is
  `margin-top` per element; the vertical rhythm is listed at the top of
  `css/styles.css`.
- **Sizes:** only the dynamic slots have a size: helmets (width + height),
  team names and odds (width), the feed window (height = `visibleRows` rows,
  from `config.feed.visibleRows`). Text takes its height from `line-height`;
  everything else is fluid. The matchup rows are grids with columns
  `minmax(0, 1fr) 7rem minmax(0, 1fr)`, so a wider or narrower name, number
  or pill, a hidden pill (`visibility`) or a missing helmet never moves
  anything else. Long team names are shrunk to fit their slot.
- **Frame height:** follows its content (padding + logo … feed), so fewer
  feed rows make the frame shorter and the disclaimer follows it up. It is
  capped: the disclaimer's bottom margin marks the lowest the frame may
  reach, the frame has `min-height: 0`, and past that point only the feed
  window shrinks (as a flex item with `overflow: hidden` its minimum height
  is 0; nothing else can go below its content). The design's 8 rows sit at
  that cap, so a larger `visibleRows` by mistake never pushes the disclaimer
  off the board; the extra rows just stay under the fade.
- The only other fixed sizes are the canvas itself and static images (logo,
  status dot, pill arrow), which would otherwise render at their intrinsic
  pixel size.

## Display states (`.stage[data-state]`)

| State | When | Screen |
|---|---|---|
| `loading` | Before the first response | `—` values, no pills, grey dot |
| `live` | Odds younger than `staleAfterMs` | Values, pills, flowing feed, pulsing dot |
| `stale` | Odds too old or unavailable | `—` values, no pills, empty feed, "Live odds temporarily unavailable" |
| `closed` | Event not open, or a market closed/settled | `—` values, empty feed, "Market closed" |
| `no-game` | No open game, or an invalid `?event=` | Art hidden, "Football returns soon" |

## Motion

- **Feed:** every 0.7–1.8 s, 1–5 rows enter at the top with a 500 ms ease-out
  fade while the track bounce-settles downward; a fixed CSS mask on the feed
  window fades the bottom out to transparent.
- **Rotation:** every `rotateMs` the next game is prepared off screen first
  (odds and trades refreshed, helmets decoded). Only then are the two
  `.matchup` blocks, `matchup-teams` (helmets, names, odds, pills) and
  `matchup-feed` (the feed window), swapped in one synchronous update inside
  a View Transition, a 1 s crossfade of just those two regions (the root
  isn't captured). Right before it, the feed
  holds new arrivals until the rows already in motion come to rest (≤ ~1 s),
  because the outgoing side is a frozen snapshot and would otherwise show
  half-faded rows as a gap; arrivals resume at the swap. Logo, headline,
  frame and the status line (between the two blocks) aren't part of the
  transition and never move; the feed is refilled with
  the new game's rows in the same update, so it never goes empty, and its ticks
  keep running. A game that isn't ready within `prepareTimeoutMs`, or isn't
  live, is skipped and the current matchup stays up. Without View Transitions
  (older players) both blocks fade out, swap and fade back in
  (`swapFadeMs`).

Known behaviour kept from the deployed board (to revisit):
1. The feed cycles through the latest fetched trade set, so a trade can appear
   more than once between polls.
2. A trade's team is taken from its market ticker, not `taker_side`, and its
   amount uses `yes_price` — a NO buy on `…-PIT` shows as Pittsburgh.

Fixed: trades under $0.50 are dropped instead of showing as `$0`.

## Caching and versions

`index.html` loads the CSS and every script with `?v=<version>`
(e.g. `?v=20260928-1`). Cache policy (applied by `server.js`, and to be set
the same way on the CDN):

| Request | `Cache-Control` |
|---|---|
| `index.html` | `no-cache` (always revalidated, so a new version lands at once) |
| `*.css` / `*.js` with `?v=` | `public, max-age=31536000, immutable` |
| other `assets/` (helmets, wordmark, OO Theran) | `public, max-age=86400` |
| JSON | `no-cache` |

**Releasing a change to CSS/JS:** bump the version on all `?v=` links in
`index.html`:

```sh
sed -i '' 's/?v=[0-9A-Za-z-]*"/?v=20260929-1"/g' index.html
```

Assets outside `?v=` are cached for a day; to replace one sooner, give it a
new file name (or invalidate it on the CDN).

## Deploy / rollback

Upload the static files (everything except `server.js`, `scripts/`, `data/`)
to the CDN with the cache policy above, and set `apiBase` to the production
data server. To roll back, re-upload the previous `index.html` together with
its CSS/JS (the old `?v=` URLs are a different cache key, so players pick
them up immediately) and invalidate `index.html`.
