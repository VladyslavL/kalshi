// Cached JSON client, ported from the deployed board's board-api.js:
//  - fresh cache hits never touch the network;
//  - concurrent requests for one URL share a single fetch;
//  - a 429 starts an exponential, jittered cooldown (honouring Retry-After)
//    during which no request is sent and still-usable cached data is served;
//  - network/HTTP errors fall back to cached data while it is within maxStale.

'use strict';

window.Board = window.Board || {};

Board.createClient = function (options = {}) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const maxEntries = options.maxEntries ?? 64;
    const baseBackoffMs = options.baseBackoffMs ?? 1_000;
    const maxBackoffMs = options.maxBackoffMs ?? 60_000;
    const jitterRatio = options.jitterRatio ?? 0.25;
    const cache = new Map();      // url -> { data, at }, in LRU order
    const inflight = new Map();   // url -> Promise
    let cooldownUntil = 0;
    let rateLimitCount = 0;

    function retryAfterMs(response) {
        const value = response.headers.get('retry-after');
        if (value == null || value.trim() === '') return 0;
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
        const date = Date.parse(value);
        return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
    }

    // A CDN-cached response is older than its arrival; Age says by how much.
    function responseTimestamp(response) {
        const age = Number(response.headers.get('age'));
        return Number.isFinite(age) && age >= 0 ? Date.now() - age * 1000 : Date.now();
    }

    function put(url, entry) {
        cache.delete(url);
        cache.set(url, entry);
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
        return entry;
    }

    function usable(entry, maxAge) {
        return entry && Date.now() - entry.at < maxAge;
    }

    function beginCooldown(response) {
        const exponential = Math.min(maxBackoffMs, baseBackoffMs * (2 ** rateLimitCount));
        const jittered = exponential + exponential * jitterRatio * Math.random();
        rateLimitCount += 1;
        cooldownUntil = Math.max(cooldownUntil, Date.now() + Math.max(retryAfterMs(response), jittered));
    }

    function httpError(status) {
        const error = new Error(`Request failed with status ${status}`);
        error.status = status;
        return error;
    }

    async function refresh(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) {
                if (response.status === 429) beginCooldown(response);
                throw httpError(response.status);
            }
            const data = await response.json();
            const entry = put(url, { data, at: responseTimestamp(response) });
            if (Date.now() >= cooldownUntil) {
                cooldownUntil = 0;
                rateLimitCount = 0;
            }
            return entry;
        } finally {
            clearTimeout(timer);
        }
    }

    function sharedRefresh(url) {
        const current = inflight.get(url);
        if (current) return current;
        const request = refresh(url).finally(() => inflight.delete(url));
        inflight.set(url, request);
        return request;
    }

    async function get(url, { maxAge = 10_000, maxStale = 120_000 } = {}) {
        const entry = cache.get(url);
        if (usable(entry, maxAge)) return entry;
        if (Date.now() < cooldownUntil) {
            if (usable(entry, maxStale)) return entry;
            throw httpError(429);
        }
        try {
            return await sharedRefresh(url);
        } catch (error) {
            if (usable(entry, maxStale)) return entry;
            throw error;
        }
    }

    return { get };
};
