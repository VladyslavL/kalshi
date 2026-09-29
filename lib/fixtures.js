// Mock-data lookup shared by the local dev server (server.js) and the Vercel
// function (api/mock.js): which data/ file answers which mocked Kalshi call.

'use strict';

const path = require('node:path');

const DATA = path.join(__dirname, '..', 'data');
const TICKER = /^[A-Z0-9-]+$/;

// route: 'events' (open events list), 'event' (one event), 'trades' (one
// market's trades). Returns the fixture path, or null for an unknown route or
// a malformed ticker.
function fixtureFile(route, ticker) {
    if (route === 'events') return path.join(DATA, 'events.json');
    if (!TICKER.test(ticker || '')) return null;
    if (route === 'event') return path.join(DATA, 'events', `${ticker}.json`);
    if (route === 'trades') return path.join(DATA, 'trades', `${ticker}.json`);
    return null;
}

module.exports = { fixtureFile };
