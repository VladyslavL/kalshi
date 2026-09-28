// Small pure helpers shared by the data, feed and board modules.

window.Board = window.Board || {};

Board.utils = (function () {
    'use strict';

    function queryParam(name) {
        return new URLSearchParams(window.location.search).get(name);
    }

    function upper(value) {
        return (value || '').trim().toUpperCase();
    }

    function formatMoney(value) {
        return '$' + Math.round(value).toLocaleString('en-US');
    }

    // "KXNFLGAME-26OCT01PITCLE-PIT" -> "PIT"
    function marketSuffix(ticker) {
        return (ticker || '').split('-').pop();
    }

    // KXNFLGAME-26OCT01PITCLE -> { ticker, blob: 'PITCLE', away: 'PIT', home: 'CLE' }.
    // away/home stay null when the blob splits into known teams more than one
    // way; the event's market tickers settle it later.
    function parseEventTicker(ticker, series, teams) {
        const match = new RegExp(`^${series}-\\d{2}[A-Z]{3}\\d{2}([A-Z0-9]+)$`).exec(upper(ticker));
        if (!match) return null;
        const blob = match[1];
        const splits = [];
        for (let cut = 1; cut < blob.length; cut++) {
            const away = blob.slice(0, cut);
            const home = blob.slice(cut);
            if (teams[away] && teams[home]) splits.push({ away, home });
        }
        const only = splits.length === 1 ? splits[0] : null;
        return { ticker: upper(ticker), blob, away: only?.away ?? null, home: only?.home ?? null };
    }

    // Relative luminance, per WCAG.
    function luminance(hex) {
        const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
            .map(c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    }

    // Colours under 3:1 on black (WCAG AA large text) are lifted in place: hue
    // and saturation kept, only lightness rises until it clears the bar.
    function readableOnBlack(hex) {
        if (!/^#[0-9a-f]{6}$/i.test(hex) || luminance(hex) >= 0.1) return hex;
        const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
        const max = Math.max(r, g, b);
        const lightness = (max + Math.min(r, g, b)) / 2;
        for (let target = lightness; target <= 0.95; target += 0.02) {
            const scaled = lightness > 0 ? Math.min(target / lightness, 1 / (max || 1)) : 1;
            const lifted = '#' + [r, g, b]
                .map(c => Math.round(Math.min(c * scaled, 1) * 255).toString(16).padStart(2, '0'))
                .join('');
            if (luminance(lifted) >= 0.1) return lifted.toUpperCase();
        }
        return '#FFFFFF';
    }

    // Shrinks an element's font until its text fits the element's own width.
    // The size is set in rem so it keeps scaling with the root font size.
    function fitText(element) {
        element.style.fontSize = '';
        if (element.scrollWidth <= element.clientWidth) return;
        const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
        const fullPx = parseFloat(getComputedStyle(element).fontSize);
        const fitted = fullPx * element.clientWidth / element.scrollWidth / rootPx;
        element.style.fontSize = `${fitted.toFixed(3)}rem`;
    }

    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    // Loads and decodes an image so a later <img src> swap to it paints at once.
    // A missing image resolves too; the <img> element's onerror handles it.
    function preloadImage(url) {
        const img = new Image();
        img.src = url;
        return img.decode().catch(() => {});
    }

    // Resolves true if `promise` settles within `ms`, false otherwise.
    function settlesWithin(promise, ms) {
        return Promise.race([
            promise.then(() => true, () => true),
            new Promise(resolve => setTimeout(() => resolve(false), ms)),
        ]);
    }

    return {
        queryParam, upper, formatMoney, marketSuffix, parseEventTicker, readableOnBlack, fitText, randomBetween,
        preloadImage, settlesWithin,
    };
})();
