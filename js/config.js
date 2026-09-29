// Board configuration. Everything a new matchup, rotation or data source
// needs lives here. It is read-only after load; URL params are resolved into
// a separate settings object (utils.urlSettings) and override:
//
//   ?event=KXNFLGAME-26OCT01PITCLE   pin one matchup (away+home are read from the ticker)
//   ?api=https://…                   data server base URL

(function () {
    'use strict';

    window.Board = window.Board || {};

    Board.config = {
        // Kalshi trade-api v2 compatible server. '' = same origin as the page
        // (locally: server.js, which serves both).
        apiBase: '',

        series: 'KXNFLGAME',
        event: null,                 // pin one event ticker; null -> daily rotation
        dailyGames: 3,               // games in the daily rotation
        rotateMs: 10_000,            // fixed rotation step (the 1 s crossfade included)
        fadeMs: 1_000,               // crossfade between matchups (View Transitions)
        swapFadeMs: 300,             // fade out / fade in when View Transitions are unsupported

        gamesRefreshMs: 300_000,     // re-select the daily games
        gamesRetryMs: 30_000,        // check interval: retry until a list loads, re-select on a new New York date
        oddsRefreshMs: 30_000,
        tradesRefreshMs: 30_000,
        staleAfterMs: 120_000,       // no fresh data for this long -> values come off screen

        helmetsPath: 'assets/helmets/',

        feed: {
            firstTickMs: 600,
            minGapMs: 700,           // pause between arrivals: min + random * jitter
            gapJitterMs: 1100,
            maxBatch: 5,             // rows that may arrive at once
            visibleRows: 8,          // feed window height, in rows (the last ones fade out)
        },

        // Status line copy, keyed by display state (.stage[data-state]).
        text: {
            loading: 'Loading live odds',
            live: 'Live trading',
            stale: 'Live odds temporarily unavailable',
            closed: 'Market closed',
            'no-game': 'Football returns soon',
        },
    };
})();
