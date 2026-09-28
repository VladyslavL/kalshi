// Board renderer: paints the current matchup,
// maps the data onto a display state, rotates matchups and hands fresh trades
// to the feed.
//
// Rotation: the next game is prepared off screen first (odds + trades
// refreshed, helmets decoded); only then are the .matchup blocks swapped in one
// synchronous update inside a View Transition, so logo, frame and status line
// never move and the feed never goes empty. Without View Transitions the blocks
// fade out and back in instead.
//
// States (.stage[data-state]):
//   loading  — before the first response; values show "—"
//   live     — odds younger than staleAfterMs; payouts and feed visible
//   stale    — odds too old or unavailable; values come off, feed empties
//   closed   — event/markets closed or settled
//   no-game  — no open game (or an invalid ?event=)

(function () {
    'use strict';

    const { config, TEAMS, utils } = Board;
    const SLOTS = ['left', 'right'];
    const STATUS_TEXT = {
        loading: config.text.loading,
        live: config.text.live,
        stale: config.text.stale,
        closed: config.text.closed,
        'no-game': config.text.noGame,
    };
    let stage = null;
    let data = null;
    let feed = null;
    let renderedKey = '';
    let lastTradesAt = 0;
    let rotating = false;

    function el(selector) {
        return stage.querySelector(selector);
    }

    function teamFor(game, slot) {
        return TEAMS[slot === 'left' ? game.away : game.home] || null;
    }

    function helmetUrl(team) {
        return `${config.helmetsPath}${team.slug}.png`;
    }

    // A missing helmet PNG hides that helmet instead of showing a broken image.
    function renderHelmet(slot, team) {
        const img = el(`.helmet[data-slot="${slot}"]`);
        img.classList.remove('missing');
        img.onerror = () => img.classList.add('missing');
        img.alt = team.name;
        img.src = helmetUrl(team);
    }

    function preloadHelmets(game) {
        return Promise.all(SLOTS.map(slot => teamFor(game, slot)).filter(Boolean)
            .map(team => utils.preloadImage(helmetUrl(team))));
    }

    function fitNames() {
        SLOTS.forEach(slot => utils.fitText(el(`.team-name[data-slot="${slot}"]`)));
    }

    function renderMatchup(game) {
        const key = `${game.ticker}|${game.away}|${game.home}`;
        if (key === renderedKey) return;
        renderedKey = key;
        SLOTS.forEach(slot => {
            const team = teamFor(game, slot);
            if (!team) return;
            stage.style.setProperty(`--${slot}-color`, utils.readableOnBlack(team.color));
            renderHelmet(slot, team);
            el(`.team-name[data-slot="${slot}"]`).textContent = team.name;
        });
        fitNames();
    }

    function setSlot(slot, percent, payout) {
        el(`.pct[data-slot="${slot}"] .value`).textContent = percent;
        el(`.payout[data-slot="${slot}"] .to`).textContent = payout;
    }

    // Percentages are complementary shares (always add to 100); payouts stay
    // on the raw contract price.
    function renderOdds(prices) {
        const leftPercent = Math.round((prices.left / (prices.left + prices.right)) * 100);
        setSlot('left', `${leftPercent}%`, utils.formatMoney(100 / prices.left));
        setSlot('right', `${100 - leftPercent}%`, utils.formatMoney(100 / prices.right));
    }

    function clearOdds() {
        SLOTS.forEach(slot => setSlot(slot, '—', '—'));
    }

    function stateOf(entry) {
        if (!data) return 'no-game';
        const { settled, listLoaded } = data.status();
        if (!entry) return listLoaded ? 'no-game' : (settled ? 'stale' : 'loading');
        if (entry.closed) return 'closed';
        if (entry.prices && Date.now() - entry.oddsAt < config.staleAfterMs) return 'live';
        return settled ? 'stale' : 'loading';
    }

    function currentState() {
        return stateOf(data?.current());
    }

    function freshTrades() {
        const entry = data?.current();
        if (!entry || currentState() !== 'live') return [];
        return Date.now() - entry.tradesAt < config.staleAfterMs ? entry.trades : [];
    }

    function describeTrade(trade) {
        const slot = trade.abbr === data.current().game.away ? 'left' : 'right';
        return { slot, name: TEAMS[trade.abbr]?.name || trade.abbr };
    }

    function render() {
        const entry = data?.current();
        if (entry) renderMatchup(entry.game);
        if (entry && entry.tradesAt !== lastTradesAt) {
            lastTradesAt = entry.tradesAt;
            feed.rewind();
        }
        const state = currentState();
        stage.dataset.state = state;
        el('.odds-status').textContent = STATUS_TEXT[state];
        if (state === 'live') renderOdds(entry.prices);
        else clearOdds();
    }

    // Puts a prepared game on screen: DOM, odds and feed rows in one step, then
    // lets the (now live, new-side) feed flow again.
    function showEntry(entry) {
        if (data.select(entry)) {
            lastTradesAt = entry.tradesAt;
            render();
            feed.refill(freshTrades());
        }
        feed.resume();
    }

    function fadeSwap(update) {
        const blocks = stage.querySelectorAll('.matchup');
        return new Promise(resolve => {
            blocks.forEach(block => block.classList.add('swapping'));
            setTimeout(() => {
                update();
                blocks.forEach(block => block.classList.remove('swapping'));
                setTimeout(resolve, config.swapFadeMs);
            }, config.swapFadeMs);
        });
    }

    function swapMatchup(update) {
        if (document.startViewTransition) return document.startViewTransition(update).finished;
        return fadeSwap(update);
    }

    // A game that isn't ready in time, or isn't live, is skipped this cycle and
    // the current matchup stays up.
    async function rotate() {
        const next = data?.next();
        if (rotating || !next) return;
        rotating = true;
        try {
            const prepared = Promise.all([data.prepare(next), preloadHelmets(next.game)]);
            const ready = await utils.settlesWithin(prepared, config.prepareTimeoutMs);
            if (ready && stateOf(next) === 'live') {
                await feed.settle();   // the outgoing snapshot must not catch rows mid-entry
                await swapMatchup(() => showEntry(next));
            }
        } finally {
            rotating = false;
        }
    }

    function init() {
        stage = document.querySelector('.stage');
        const root = document.documentElement.style;
        root.setProperty('--fade', `${config.fadeMs}ms`);
        root.setProperty('--swap-fade', `${config.swapFadeMs}ms`);
        root.setProperty('--feed-rows', config.feed.visibleRows);
        const api = utils.queryParam('api');
        if (api) config.apiBase = api;
        const eventParam = utils.queryParam('event') || config.event;
        const pinned = eventParam ? utils.parseEventTicker(eventParam, config.series, TEAMS) : null;

        document.fonts.ready.then(fitNames);

        feed = Board.createFeed({
            track: el('.trades-feed-track'), config, getTrades: freshTrades, describe: describeTrade,
        });
        if (!eventParam || pinned) {
            data = Board.createDataSource({ config, teams: TEAMS, pinned, onChange: render });
            data.start();
        }
        render();
        setInterval(render, 1000);   // expires stale values even when polls stop answering
        setInterval(rotate, config.rotateMs);
        feed.start();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
