// Vercel function standing in for server.js's mock API: vercel.json rewrites
// the three Kalshi routes here as ?route=…&ticker=…. It is a function rather
// than static files on purpose: Vercel's edge caches static files for the whole
// deployment and adds a growing Age header, which the board rightly reads as
// stale data.

'use strict';

const fs = require('node:fs');
const { fixtureFile } = require('../lib/fixtures');

module.exports = (req, res) => {
    const file = fixtureFile(req.query.route, req.query.ticker);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (!file) {
        res.statusCode = 404;
        return res.end('{"error":"not found"}');
    }
    fs.readFile(file, (err, data) => {
        res.statusCode = err ? 404 : 200;
        res.end(err ? '{"error":"not found"}' : data);
    });
};
