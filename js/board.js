// Board renderer: paints the current matchup,
// maps the data onto a display state, rotates matchups and hands fresh trades
// to the feed.
//
// Rotation runs on a fixed rotateMs step. Right after each switch the next
// game is prepared in the background (odds + trades refreshed, helmets
// decoded), so on the next tick the .matchup blocks are swapped at once in one
// synchronous update inside a View Transition: logo, frame and status line
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

    window.Board = window.Board || {};

    const { config, TEAMS, utils } = Board;
    const SLOTS = ['left', 'right'];
    let stage = null;
    let els = null;                // element references, looked up once in init
    let data = null;
    let feed = null;
    let renderedTicker = '';
    let lastTradesAt = 0;
    let rotating = false;
    let upNext = null;             // the next game, once prepared
    let rotationEpoch = 0;         // rotation ticks fall on rotationEpoch + n × rotateMs

    // { left, right }: the [data-slot] element per slot (or its `descendant`).
    function bySlot(selector, descendant = '') {
        return Object.fromEntries(SLOTS.map(slot =>
            [slot, stage.querySelector(`${selector}[data-slot="${slot}"] ${descendant}`)]));
    }

    function findElements() {
        return {
            helmets: bySlot('.helmet'),
            names: bySlot('.team-name'),
            percents: bySlot('.pct', '.value'),
            payouts: bySlot('.payout', '.to'),
            status: stage.querySelector('.odds-status'),
            track: stage.querySelector('.trades-feed-track'),
            matchups: stage.querySelectorAll('.matchup'),
        };
    }

    function teamFor(game, slot) {
        return TEAMS[slot === 'left' ? game.away : game.home];
    }

    function helmetUrl(team) {
        return `${config.helmetsPath}${team.slug}.png`;
    }

    // A missing helmet PNG hides that helmet instead of showing a broken image.
    function renderHelmet(slot, team) {
        const img = els.helmets[slot];
        img.classList.remove('missing');
        img.onerror = () => {
            img.classList.add('missing');
            utils.logger(new Error(`Helmet failed to load: ${img.src}`), 'helmet');
        };
        img.alt = team.name;
        img.src = helmetUrl(team);
    }

    function preloadHelmets(game) {
        return Promise.all(SLOTS.map(slot => utils.preloadImage(helmetUrl(teamFor(game, slot)))));
    }

    function fitNames() {
        SLOTS.forEach(slot => utils.fitText(els.names[slot]));
    }

    function renderMatchup(game) {
        if (game.ticker === renderedTicker) return;
        renderedTicker = game.ticker;
        SLOTS.forEach(slot => {
            const team = teamFor(game, slot);
            stage.style.setProperty(`--${slot}-color`, utils.readableOnBlack(team.color));
            renderHelmet(slot, team);
            els.names[slot].textContent = team.name;
        });
        fitNames();
    }

    function setSlot(slot, percent, payout) {
        utils.setText(els.percents[slot], percent);
        utils.setText(els.payouts[slot], payout);
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
        return { slot, name: TEAMS[trade.abbr].name };
    }

    function render() {
        const entry = data?.current();
        if (entry) renderMatchup(entry.game);
        if (entry && entry.tradesAt !== lastTradesAt) {
            lastTradesAt = entry.tradesAt;
            feed.rewind();
        }
        const state = currentState();
        if (stage.dataset.state !== state) stage.dataset.state = state;
        utils.setText(els.status, config.text[state]);
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
        return new Promise(resolve => {
            els.matchups.forEach(block => block.classList.add('swapping'));
            setTimeout(() => {
                update();
                els.matchups.forEach(block => block.classList.remove('swapping'));
                setTimeout(resolve, config.swapFadeMs);
            }, config.swapFadeMs);
        });
    }

    function swapMatchup(update) {
        if (document.startViewTransition) return document.startViewTransition(update).finished;
        return fadeSwap(update);
    }

    // When the next matchup swap is due; never while there is nothing to rotate
    // to (a pinned or single game), so the feed gets no quiet windows then.
    function nextSwapAt() {
        if (!data?.next()) return Infinity;
        const elapsed = Date.now() - rotationEpoch;
        return rotationEpoch + Math.ceil(elapsed / config.rotateMs) * config.rotateMs;
    }

    // Readies the following game in the background, so the next tick can switch
    // to it at once.
    function prepareNext() {
        upNext = null;
        const next = data?.next();
        if (!next) return;
        Promise.all([data.prepare(next), preloadHelmets(next.game)]).then(() => {
            if (data.next() === next) upNext = next;
        });
    }

    // A next game that isn't prepared yet, or isn't live, is skipped this cycle
    // and the current matchup stays up.
    async function rotate() {
        const next = upNext;
        if (rotating) return;
        if (!next || next !== data.next() || stateOf(next) !== 'live') {
            prepareNext();
            return;
        }
        rotating = true;
        try {
            feed.freeze();   // the outgoing snapshot must not catch rows mid-entry
            await swapMatchup(() => showEntry(next));
        } finally {
            rotating = false;
            prepareNext();
        }
    }

    function init() {
        stage = document.querySelector('.stage');
        els = findElements();
        const settings = utils.urlSettings(config);
        const root = document.documentElement.style;
        root.setProperty('--fade', `${config.fadeMs}ms`);
        root.setProperty('--swap-fade', `${config.swapFadeMs}ms`);
        root.setProperty('--feed-rows', config.feed.visibleRows);
        const pinned = settings.event ? utils.parseEventTicker(settings.event, config.series, TEAMS) : null;

        document.fonts.ready.then(fitNames);

        feed = Board.createFeed({
            track: els.track, config, getTrades: freshTrades, describe: describeTrade, nextSwapAt,
        });
        if (!settings.event || pinned) {
            data = Board.createDataSource({ config, apiBase: settings.apiBase, teams: TEAMS, pinned, onChange: render });
            data.start().then(prepareNext);
        }
        render();
        setInterval(render, 1000);   // expires stale values even when polls stop answering
        rotationEpoch = Date.now();
        setInterval(rotate, config.rotateMs);
        feed.start();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
