// Flowing trades feed — animation only. It pulls whatever trades the board
// currently considers fresh via `getTrades()` and never fetches anything.
//
// Every tick (irregular, 0.7–1.8 s) 1–5 rows are prepended at the top, the
// track is shifted up by their height with no transition, then released back
// to 0 with a slightly overshooting curve: a 500 ms fade-in plus a soft
// bounce-settle. The bottom fade is a fixed mask on the feed window (CSS).
//
// Quiet window: no batch starts if it would still be moving at the next matchup
// swap (`nextSwapAt()`), so the swap's snapshot always catches the feed at rest.

(function () {
    'use strict';

    window.Board = window.Board || {};

    Board.createFeed = function ({ track, config, getTrades, describe, nextSwapAt }) {
        const { formatMoney, randomBetween } = Board.utils;
        const feed = config.feed;
        // The window shows visibleRows; a batch is prepended above it and slides
        // in, so the track holds visibleRows + maxBatch rows and extras are only
        // ever trimmed below the window, out of sight.
        const maxRows = feed.visibleRows + feed.maxBatch;
        // Bounce duration: base + per row + up to `jitterMs`. The longest a batch
        // is in motion (the 500 ms fade-in is shorter) sizes the quiet window.
        const BOUNCE = { baseMs: 340, perRowMs: 130, jitterMs: 130 };
        const MAX_MOTION_MS = BOUNCE.baseMs + feed.maxBatch * BOUNCE.perRowMs + BOUNCE.jitterMs;
        let index = 0;
        let held = false;            // arrivals paused (see freeze)

        function span(className, text) {
            const node = document.createElement('span');
            node.className = className;
            node.textContent = text;
            return node;
        }

        // `describe(trade)` -> { slot: 'left' | 'right', name }
        function rowFor(trade) {
            const { slot, name } = describe(trade);
            const row = document.createElement('div');
            row.className = `trade color-${slot}`;
            row.append(span('amount', formatMoney(trade.dollars)), span('label', 'on'), span('name', name));
            return row;
        }

        // Cycles through the current trade set, newest first.
        function nextRow(trades) {
            return rowFor(trades[index++ % trades.length]);
        }

        function fill(trades) {
            track.style.transition = 'none';
            track.style.transform = 'translateY(0)';
            track.replaceChildren(...Array.from({ length: feed.visibleRows }, () => nextRow(trades)));
        }

        function arrive(trades) {
            const batch = 1 + Math.floor(Math.random() * feed.maxBatch);
            let pitch = 0;
            for (let i = 0; i < batch; i++) {
                const row = nextRow(trades);
                row.classList.add('enter');
                track.prepend(row);
                if (!pitch) pitch = row.offsetHeight + (parseFloat(getComputedStyle(track).rowGap) || 0);
            }
            track.style.transition = 'none';
            track.style.transform = `translateY(${-pitch * batch}px)`;
            void track.offsetHeight;   // commit the offset before releasing it
            const duration = Math.round(BOUNCE.baseMs + batch * BOUNCE.perRowMs + Math.random() * BOUNCE.jitterMs);
            track.style.transition = `transform ${duration}ms cubic-bezier(0.34, 1.2, 0.64, 1)`;
            track.style.transform = 'translateY(0)';
            while (track.children.length > maxRows) track.lastChild.remove();
        }

        function step(trades) {
            if (!trades.length) track.replaceChildren();
            else if (!track.children.length) fill(trades);
            else arrive(trades);
        }

        function tick() {
            const quiet = nextSwapAt() - Date.now() < MAX_MOTION_MS;
            if (!held && !quiet) step(getTrades());
            setTimeout(tick, randomBetween(feed.minGapMs, feed.minGapMs + feed.gapJitterMs));
        }

        // New data arrived: the next rows to enter are the newest trades.
        function rewind() {
            index = 0;
        }

        // Pauses arrivals for the swap. The quiet window normally leaves nothing in
        // motion; anything still moving (timer drift) is put at rest at once, so
        // the outgoing snapshot never freezes rows mid-entry as a gap. resume()
        // lets the flow continue.
        function freeze() {
            held = true;
            track.style.transition = 'none';
            track.style.transform = 'translateY(0)';
            track.querySelectorAll('.enter').forEach(row => row.classList.remove('enter'));
        }

        function resume() {
            held = false;
        }

        // Matchup changed: swap in the new game's rows in one synchronous step (run
        // inside the matchup transition), so the feed never goes empty.
        function refill(trades) {
            index = 0;
            if (trades.length) fill(trades);
            else track.replaceChildren();
        }

        function start() {
            setTimeout(tick, feed.firstTickMs);
        }

        return { start, rewind, refill, freeze, resume };
    };
})();
