// Zero-dependency dev server: serves the board's static files and mocks the
// Kalshi trade-api v2 endpoints the board reads with JSON from ./data (see
// scripts/snapshot.js). Page and data share one origin, so fonts load without
// CORS issues in every browser.
//
//   GET /                                         -> index.html
//   GET /css/*, /js/*, /assets/*                  -> static files
//   GET /events?series_ticker=…&status=open       -> data/events.json
//   GET /events/{EVENT}?with_nested_markets=true  -> data/events/{EVENT}.json
//   GET /markets/trades?ticker={MARKET}&limit=20  -> data/trades/{MARKET}.json
//
// Static files get the caching a CDN should apply in production: `?v=`
// URLs are immutable, index.html is always revalidated, other assets are
// cached for a day. DEV=1 turns caching off so edits show without a version bump.
//
//   PORT=8787 node server.js
//   DEV=1 node server.js

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { fixtureFile } = require('./lib/fixtures');

const PORT = Number(process.env.PORT) || 8787;
const DEV = process.env.DEV === '1';
const ROOT = __dirname;
const STATIC_DIRS = ['css', 'js', 'assets'];

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
};

function send(res, status, body, type = MIME['.json'], cache = 'no-cache') {
    res.writeHead(status, {
        'Content-Type': type,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': cache,
    });
    res.end(body);
}

function cacheControl(url, file) {
    if (DEV || path.basename(file) === 'index.html') return 'no-cache';
    if (url.searchParams.has('v')) return 'public, max-age=31536000, immutable';
    return 'public, max-age=86400';
}

// Maps an API request onto its fixture file, or null for a non-API route.
function fixtureFor(url) {
    if (url.pathname === '/events') return fixtureFile('events');
    const event = /^\/events\/([^/]+)$/.exec(url.pathname);
    if (event) return fixtureFile('event', event[1]);
    if (url.pathname === '/markets/trades') return fixtureFile('trades', url.searchParams.get('ticker'));
    return null;
}

// Maps a request onto a servable static file, or null. Only index.html and
// the css/js/assets folders are exposed (not server.js, scripts/, dotfiles).
function staticFor(url) {
    if (url.pathname === '/' || url.pathname === '/index.html') return path.join(ROOT, 'index.html');
    let file;
    try {
        file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    } catch (err) {
        return null;   // malformed %-escape
    }
    const parts = path.relative(ROOT, file).split(path.sep);
    const hidden = parts.some(part => part.startsWith('.'));
    return STATIC_DIRS.includes(parts[0]) && !hidden && MIME[path.extname(file)] ? file : null;
}

const NOT_FOUND = '{"error":"not found"}';

function serve(res, file, cache) {
    fs.readFile(file, (err, data) => {
        if (err) return send(res, 404, NOT_FOUND);
        send(res, 200, data, MIME[path.extname(file)], cache);
    });
}

http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '{"error":"method not allowed"}');
    const fixture = fixtureFor(url);
    if (fixture) return serve(res, fixture);
    const file = staticFor(url);
    if (file) return serve(res, file, cacheControl(url, file));
    send(res, 404, NOT_FOUND);
}).listen(PORT, () => {
    console.log(`Board + mock Kalshi API on http://localhost:${PORT}${DEV ? ' (DEV: caching off)' : ''}`);
});
