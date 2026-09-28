// Re-captures the mock data in ./data from the live Kalshi trade-api v2, in
// exactly the response shape the board reads:
//
//   data/events.json                open NFL events with nested markets
//   data/events/{EVENT}.json        one event with nested markets
//   data/trades/{EVENT}-{TEAM}.json latest 20 trades per team market
//
//   node scripts/snapshot.js
//
// Existing files in data/events and data/trades are replaced.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const API = process.env.KALSHI_API_BASE || 'https://api.elections.kalshi.com/trade-api/v2';
const SERIES = 'KXNFLGAME';
const DATA = path.join(__dirname, '..', 'data');
const PAUSE_MS = 150;   // stays well under the public rate limit

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJSON(route) {
    const response = await fetch(API + route, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`${route} -> ${response.status}`);
    await pause(PAUSE_MS);
    return response.json();
}

function write(relative, data) {
    fs.writeFileSync(path.join(DATA, relative), JSON.stringify(data, null, 4) + '\n');
}

function resetDir(name) {
    const dir = path.join(DATA, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

async function main() {
    const list = await getJSON(`/events?series_ticker=${SERIES}&status=open&limit=200&with_nested_markets=true`);
    const events = list.events || [];
    resetDir('events');
    resetDir('trades');
    write('events.json', { ...list, cursor: '' });   // one page is the whole mock

    for (const { event_ticker: ticker } of events) {
        const event = await getJSON(`/events/${ticker}?with_nested_markets=true`);
        write(`events/${ticker}.json`, event);
        for (const market of event.event?.markets || []) {
            write(`trades/${market.ticker}.json`, await getJSON(`/markets/trades?ticker=${market.ticker}&limit=20`));
        }
        console.log(`captured ${ticker}`);
    }
    console.log(`${events.length} events -> ${path.relative(process.cwd(), DATA)}`);
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
