// Daily game selection, ported from the deployed board's daily-games.js:
// today's open games (New York date) by volume, then upcoming games by date
// and volume, capped at `count`.

(function () {
    'use strict';

    window.Board = window.Board || {};

    const NEW_YORK_DATE = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    });

    // Date -> "2026-09-28" in New York.
    function dayKey(date) {
        const parts = Object.fromEntries(NEW_YORK_DATE.formatToParts(date).map(part => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    }

    function activeMarkets(event) {
        return event.markets.filter(market => market.market_type === 'binary'
            && ['active', 'open'].includes(market.status)
            && !market.result);
    }

    function volumeOf(markets) {
        return markets.reduce((total, market) => total + parseFloat(market.volume_fp), 0);
    }

    // -> [{ game, event }] in rotation order; `game` is the parsed ticker.
    function select(events, series, teams, count, now = new Date()) {
        const today = dayKey(now);
        const candidates = events.flatMap(event => {
            const game = Board.utils.parseEventTicker(event.event_ticker, series, teams);
            const markets = activeMarkets(event);
            if (!game || game.date < today || markets.length < 2) return [];
            return [{ game, event, volume: volumeOf(markets) }];
        });

        const byVolume = (a, b) => b.volume - a.volume || a.game.ticker.localeCompare(b.game.ticker);
        const todayGames = candidates.filter(({ game }) => game.date === today).sort(byVolume);
        const futureGames = candidates.filter(({ game }) => game.date > today)
            .sort((a, b) => a.game.date.localeCompare(b.game.date) || byVolume(a, b));
        return todayGames.concat(futureGames).slice(0, count).map(({ game, event }) => ({ game, event }));
    }

    Board.games = { select, dayKey };
})();
