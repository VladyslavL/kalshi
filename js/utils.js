// Small pure helpers shared by the data, feed and board modules.

(function () {
    'use strict';

    window.Board = window.Board || {};

    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    // URL overrides on top of the config, resolved once; the config itself is
    // never changed.
    function urlSettings(config) {
        const params = new URLSearchParams(window.location.search);
        return {
            apiBase: params.get('api') || config.apiBase,
            event: params.get('event') || config.event,
        };
    }

    // Called with every caught error. A stub for now: plug a real error
    // collector in here.
    function logger(error, context) {}

    function upper(value) {
        return (value || '').trim().toUpperCase();
    }

    function formatMoney(value) {
        return '$' + Math.round(value).toLocaleString('en-US');
    }

    // "KXNFLGAME-26OCT01PITCLE-PIT" -> "PIT"
    function marketSuffix(ticker) {
        return ticker.split('-').pop();
    }

    // KXNFLGAME-26OCT01PITCLE -> { ticker, date: '2026-10-01', away: 'PIT', home: 'CLE' },
    // or null when it isn't a `series` ticker or doesn't split into two known teams.
    function parseEventTicker(ticker, series, teams) {
        const normalized = upper(ticker);
        const pattern = new RegExp(`^${series}-(\\d{2})(${MONTHS.join('|')})(\\d{2})([A-Z0-9]+)$`);
        const match = pattern.exec(normalized);
        if (!match) return null;
        const [, year, month, day, pair] = match;
        const date = `20${year}-${String(MONTHS.indexOf(month) + 1).padStart(2, '0')}-${day}`;
        for (let cut = 1; cut < pair.length; cut++) {
            const away = pair.slice(0, cut);
            const home = pair.slice(cut);
            if (teams[away] && teams[home]) return { ticker: normalized, date, away, home };
        }
        return null;
    }

    // Writes text only when it differs, so a steady render never touches the DOM.
    function setText(element, text) {
        if (element.textContent !== text) element.textContent = text;
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

    Board.utils = {
        urlSettings, logger, formatMoney, marketSuffix, parseEventTicker, setText, readableOnBlack, fitText, randomBetween,
        preloadImage,
    };
})();

