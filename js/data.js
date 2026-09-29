// Data layer: selects the games, polls odds and trades on its own timers,
// maps the Kalshi JSON onto the board's two slots and signals `onChange`.
// It never touches the DOM or the feed animation.
//
// Daily mode: the open-events list picks the rotation and seeds every game's
// odds; afterwards only the game on screen is polled, and the next game is
// refreshed by `prepare()` right before the board switches to it. Pinned mode
// (?event=): a single game, no list.

(function () {
    'use strict';

    window.Board = window.Board || {};

    Board.createDataSource = function ({ config, apiBase, teams, pinned, onChange }) {
        const { marketSuffix, logger } = Board.utils;
        const client = Board.createClient();
        const base = apiBase.replace(/\/$/, '');
        const endpoints = {
            events: () => `${base}/events?series_ticker=${config.series}&status=open&limit=200&with_nested_markets=true`,
            event: ticker => `${base}/events/${ticker}?with_nested_markets=true`,
            trades: market => `${base}/markets/trades?ticker=${market}&limit=20`,
        };
        const entries = new Map();   // ticker -> per-game state
        let order = [];              // tickers in rotation order
        let index = 0;
        let listLoaded = false;      // the set of games is known
        let gamesAt = 0;             // last successful games selection
        let gamesDay = '';           // New York date of that selection
        let settled = false;         // at least one games/odds request has completed
        let fetchingGames = false;

        function entryFor(game) {
            if (!entries.has(game.ticker)) {
                entries.set(game.ticker, {
                    game,              // { ticker, date, away, home }
                    prices: null,      // { left, right } 0–1 contract prices
                    oddsAt: 0,         // data timestamp of the last good odds
                    closed: false,
                    trades: [],        // newest first: { id, at, dollars, abbr }
                    tradesAt: 0,
                    oddsRequest: null,    // in-flight promises, shared by pollers and prepare()
                    tradesRequest: null,
                });
            }
            return entries.get(game.ticker);
        }

        function current() {
            return entries.get(order[index]) || null;
        }

        function isClosed(markets) {
            return markets.some(m => m.result || !['active', 'open'].includes(m.status));
        }

        // Last traded price, else the ask. Returns 0–1 (0 = no price).
        function priceOf(market) {
            const last = parseFloat(market.last_price_dollars);
            return last > 0 ? last : parseFloat(market.yes_ask_dollars);
        }

        function pricesFrom(game, markets) {
            const prices = {};
            markets.forEach(m => {
                const suffix = marketSuffix(m.ticker);
                if (suffix === game.away) prices.left = priceOf(m);
                if (suffix === game.home) prices.right = priceOf(m);
            });
            const valid = p => p > 0 && p <= 1;
            return valid(prices.left) && valid(prices.right) ? prices : null;
        }

        function applyEvent(entry, markets, at) {
            const binary = markets.filter(m => m.market_type === 'binary');
            entry.closed = isClosed(binary);
            const prices = entry.closed ? null : pricesFrom(entry.game, binary);
            if (prices) {
                entry.prices = prices;
                entry.oddsAt = at;
            }
        }

        async function refreshGames() {
            if (fetchingGames) return;
            fetchingGames = true;
            try {
                const { data, at } = await client.get(endpoints.events(), { maxAge: 30_000, maxStale: config.staleAfterMs });
                const shown = order[index];
                const selected = Board.games.select(data.events, config.series, teams, config.dailyGames);
                selected.forEach(({ game, event }) => applyEvent(entryFor(game), event.markets, at));
                order = selected.map(({ game }) => game.ticker);
                for (const ticker of entries.keys()) if (!order.includes(ticker)) entries.delete(ticker);
                index = Math.max(0, order.indexOf(shown));
                listLoaded = true;
                gamesAt = Date.now();
                gamesDay = Board.games.dayKey(new Date());
            } catch (err) {
                logger(err, 'games');   // keep the current rotation; its values expire by age
            } finally {
                fetchingGames = false;
                settled = true;
                onChange();
            }
        }

        async function loadOdds(entry) {
            try {
                const { data, at } = await client.get(endpoints.event(entry.game.ticker), {
                    maxAge: config.oddsRefreshMs / 2, maxStale: config.staleAfterMs, context: `odds ${entry.game.ticker}`,
                });
                applyEvent(entry, data.event.markets, at);
            } catch (err) {
                logger(err, `odds ${entry.game.ticker}`);   // values expire by age; the board shows the stale state
            } finally {
                settled = true;
                onChange();
            }
        }

        function refreshOdds(entry = current()) {
            if (!entry) return Promise.resolve();
            entry.oddsRequest ||= loadOdds(entry).finally(() => { entry.oddsRequest = null; });
            return entry.oddsRequest;
        }

        // Each team has its own YES/NO market. A taker buying YES on `abbr`'s
        // market backs `abbr` at the YES price; buying NO backs the `other` team
        // at the NO price. The amount is what the taker paid. Trades under $0.50
        // would round to "$0" on the board, so they are dropped.
        function tradesFrom(data, market, abbr, other) {
            return data.trades.filter(t => t.ticker === market).map(t => {
                const yes = t.taker_side === 'yes';
                const count = parseFloat(t.count_fp);
                const price = parseFloat(yes ? t.yes_price_dollars : t.no_price_dollars);
                return { id: t.trade_id, at: t.created_time, count, dollars: count * price, abbr: yes ? abbr : other };
            }).filter(t => t.count > 0 && Math.round(t.dollars) >= 1);
        }

        async function loadTrades(entry) {
            const { ticker, away, home } = entry.game;
            try {
                const results = await Promise.all([[away, home], [home, away]].map(async ([abbr, other]) => {
                    const market = `${ticker}-${abbr}`;
                    const { data, at } = await client.get(endpoints.trades(market), {
                        maxAge: config.tradesRefreshMs / 2, maxStale: config.staleAfterMs, context: `trades ${market}`,
                    });
                    return { at, rows: tradesFrom(data, market, abbr, other) };
                }));
                const unique = new Map();
                results.flatMap(result => result.rows).forEach(t => unique.set(t.id, t));
                entry.trades = [...unique.values()].sort((a, b) => b.at.localeCompare(a.at));
                entry.tradesAt = Math.min(...results.map(result => result.at));
                onChange();
            } catch (err) {
                logger(err, `trades ${ticker}`);   // no placeholder rows; the old set expires by age
            }
        }

        function refreshTrades(entry = current()) {
            if (!entry) return Promise.resolve();
            entry.tradesRequest ||= loadTrades(entry).finally(() => { entry.tradesRequest = null; });
            return entry.tradesRequest;
        }

        // The game after the one on screen, or null when there is nothing to rotate to.
        function next() {
            return order.length < 2 ? null : entries.get(order[(index + 1) % order.length]) || null;
        }

        // Brings a game's odds and trades up to date before it goes on screen.
        function prepare(entry) {
            return Promise.all([refreshOdds(entry), refreshTrades(entry)]);
        }

        // Puts a game on screen; false if it has dropped out of the rotation meanwhile.
        function select(entry) {
            const position = order.indexOf(entry.game.ticker);
            if (position < 0) return false;
            index = position;
            return true;
        }

        async function start() {
            if (pinned) {
                order = [entryFor(pinned).game.ticker];
                listLoaded = true;
                refreshOdds();
            } else {
                await refreshGames();
                // Re-select every gamesRefreshMs, and sooner when the New York date
                // changes (yesterday's games drop out) or no list has loaded yet.
                setInterval(() => {
                    const due = Date.now() - gamesAt >= config.gamesRefreshMs;
                    if (!listLoaded || due || Board.games.dayKey(new Date()) !== gamesDay) refreshGames();
                }, config.gamesRetryMs);
            }
            refreshTrades();
            setInterval(() => refreshOdds(), config.oddsRefreshMs);
            setInterval(() => refreshTrades(), config.tradesRefreshMs);
        }

        function status() {
            return { settled, listLoaded, count: order.length };
        }

        return { start, current, next, prepare, select, status };
    };
})();
