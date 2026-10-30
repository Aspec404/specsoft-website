#!/usr/bin/env node
/* ==========================================================================
   SPECSOFT® add-seasons.js  -  one-time helper
   Run it from your website folder (the one with index.html):

       node add-seasons.js --dry     shows what it WOULD change, touches nothing
       node add-seasons.js           does it

   For every .html file it:
     1. adds  <script src="seasons.js"></script>  just before </head>   (skips pages that already have it)
     2. removes the old  <link rel="stylesheet" href="halloween.css">   (seasons.css replaces it and
        only loads while an event is on, so it can be switched off from Console > Seasons)
   It is safe to run twice. If you use git, "git diff" shows exactly what changed.
   ========================================================================== */
'use strict';
var fs = require('fs');
var path = require('path');

var dry = process.argv.indexOf('--dry') !== -1;
var dir = process.cwd();
var TAG = '    <script src="seasons.js"></script>';
var changed = 0, skipped = 0, warned = [];

function walk(d) {
    return fs.readdirSync(d, { withFileTypes: true }).flatMap(function (e) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name.charAt(0) === '.') return [];
        var full = path.join(d, e.name);
        return e.isDirectory() ? walk(full) : [full];
    });
}

var files = walk(dir);

files.filter(function (f) { return /\.html?$/i.test(f); }).forEach(function (f) {
    var raw = fs.readFileSync(f, 'utf8'), crlf = raw.indexOf('\r\n') !== -1;
    var s = raw.replace(/\r\n/g, '\n'), notes = [];

    var before = s;
    s = s.replace(/^[ \t]*<link[^>]*halloween\.css[^>]*>[ \t]*\n?/gim, '');
    if (s !== before) notes.push('removed halloween.css link');

    if (!/seasons\.js/i.test(s)) {
        if (/<\/head>/i.test(s)) { s = s.replace(/<\/head>/i, TAG + '\n</head>'); notes.push('added seasons.js'); }
        else { warned.push(path.relative(dir, f) + ' has no </head>, add <script src="seasons.js"></script> by hand'); }
    }

    if (!notes.length) { skipped++; return; }
    changed++;
    console.log((dry ? '[dry] ' : '') + path.relative(dir, f) + ': ' + notes.join(', '));
    if (!dry) fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s, 'utf8');
});

// scripts that load halloween.css themselves would keep the old always-on look
files.filter(function (f) { return /\.js$/i.test(f) && !/seasons\.js$/i.test(f); }).forEach(function (f) {
    try { if (/halloween\.css/i.test(fs.readFileSync(f, 'utf8'))) warned.push(path.relative(dir, f) + ' still loads halloween.css by itself: remove that line so seasons can be switched off'); } catch (e) { /* unreadable */ }
});

console.log('\n' + (dry ? 'Dry run: ' : 'Done: ') + changed + ' page(s) ' + (dry ? 'would change' : 'changed') + ', ' + skipped + ' already fine.');
warned.forEach(function (w) { console.log('! ' + w); });
if (!fs.existsSync(path.join(dir, 'seasons.js')) || !fs.existsSync(path.join(dir, 'seasons.css'))) console.log('! seasons.js and seasons.css must be in this same folder.');
