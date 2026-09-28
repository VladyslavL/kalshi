// Daily game selection, ported from the deployed board's daily-games.js:
// today's open games (New York date) by volume, then upcoming games by date
// and volume, capped at `count`.

'use strict';

window.Board = window.Board || {};

Board.games = (function () {
    const MONTHS = {
        JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
        JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
    };

    const NEW_YORK_DATE = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    });

    // Date -> "2026-09-28" in New York.
    function dayKey(date) {
        const parts = Object.fromEntries(NEW_YORK_DATE.formatToParts(date).map(part => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    }

    // "KXNFLGAME-26OCT01PITCLE" -> "2026-10-01", or null.
    function eventDay(ticker) {
        const match = /-(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})[A-Z0-9]*$/.exec(ticker);
        if (!match) return null;
        return `${2000 + Number(match[1])}-${String(MONTHS[match[2]]).padStart(2, '0')}-${match[3]}`;
    }

    function hasResult(value) {
        return value !== undefined && value !== null && String(value).trim() !== '';
    }

    function activeMarkets(event) {
        const status = String(event.status ?? '').toLowerCase();
        if ((status && status !== 'open') || hasResult(event.result)) return [];
        return (event.markets || []).filter(market => String(market.market_type).toLowerCase() === 'binary'
            && ['active', 'open'].includes(String(market.status).toLowerCase())
            && !hasResult(market.result));
    }

    function volumeOf(markets) {
        return markets.reduce((total, market) => {
            const volume = Number.parseFloat(market.volume_fp ?? market.volume);
            return total + (Number.isFinite(volume) ? volume : 0);
        }, 0);
    }

    function select(events, series, count, now = new Date()) {
        const today = dayKey(now);
        const unique = new Map();
        events.forEach(event => {
            const ticker = String(event.event_ticker || '').toUpperCase();
            const date = eventDay(ticker);
            const markets = activeMarkets(event);
            if (!ticker.startsWith(`${series}-`) || !date || date < today || markets.length < 2) return;
            const candidate = { event, ticker, date, volume: volumeOf(markets) };
            const current = unique.get(ticker);
            if (!current || candidate.volume > current.volume) unique.set(ticker, candidate);
        });

        const candidates = [...unique.values()];
        const byVolume = (a, b) => b.volume - a.volume || a.ticker.localeCompare(b.ticker);
        const todayGames = candidates.filter(game => game.date === today).sort(byVolume);
        const futureGames = candidates.filter(game => game.date > today)
            .sort((a, b) => a.date.localeCompare(b.date) || byVolume(a, b));
        return todayGames.concat(futureGames).slice(0, count).map(game => game.event);
    }

    return { select, dayKey };
})();
