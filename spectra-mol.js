/* Spectra Lab: Molecular Constructor (v1) for Spectra Academics.
   Build molecules atom by atom on a 2D canvas, see the formula, molar mass, shape (VSEPR) and polarity update live,
   then flip to a 3D view (Three.js, loaded only when you open it) with ball and stick, space-filling, sticks and lone pairs.
   Everything runs in the browser (no database, no credits). Your Molecule Book is saved on this device (localStorage "sa.lab.mols").
   Load this file BEFORE or AFTER spectra-lab.js (spectra-lab.js opens it through window.SpectraMol.mount / .unmount).
   Needs the lab styles from spectra-lab.css (lb-* classes) plus spectra-mol.css (mc-* classes). */
(function () {
  'use strict';
  var KEY = 'sa.lab.mols', MAXA = 60, THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';

  /* ================= elements (covalent builder set) ================= */
  /* n name, m mass, en electronegativity (Pauling), rc covalent radius (A), rv van der Waals radius (A), ve valence electrons, val allowed bond counts, c color, t text color */
  var EL = {
    H: { n: 'Hydrogen', m: 1.008, en: 2.20, rc: .31, rv: 1.20, ve: 1, val: [1], c: '#eef2f6', t: '#0f172a' },
    B: { n: 'Boron', m: 10.81, en: 2.04, rc: .84, rv: 1.92, ve: 3, val: [3], c: '#fbb6a8', t: '#0f172a' },
    C: { n: 'Carbon', m: 12.011, en: 2.55, rc: .76, rv: 1.70, ve: 4, val: [4], c: '#6b7280', t: '#ffffff' },
    N: { n: 'Nitrogen', m: 14.007, en: 3.04, rc: .71, rv: 1.55, ve: 5, val: [3], c: '#3b5bfd', t: '#ffffff' },
    O: { n: 'Oxygen', m: 15.999, en: 3.44, rc: .66, rv: 1.52, ve: 6, val: [2], c: '#ef2b2b', t: '#ffffff' },
    F: { n: 'Fluorine', m: 18.998, en: 3.98, rc: .57, rv: 1.47, ve: 7, val: [1], c: '#8fd14f', t: '#0f172a' },
    Si: { n: 'Silicon', m: 28.085, en: 1.90, rc: 1.11, rv: 2.10, ve: 4, val: [4], c: '#e8c39e', t: '#0f172a' },
    P: { n: 'Phosphorus', m: 30.974, en: 2.19, rc: 1.07, rv: 1.80, ve: 5, val: [3, 5], c: '#f97316', t: '#ffffff' },
    S: { n: 'Sulfur', m: 32.06, en: 2.58, rc: 1.05, rv: 1.80, ve: 6, val: [2, 4, 6], c: '#facc15', t: '#0f172a' },
    Cl: { n: 'Chlorine', m: 35.45, en: 3.16, rc: 1.02, rv: 1.75, ve: 7, val: [1], c: '#34d058', t: '#0f172a' },
    Br: { n: 'Bromine', m: 79.904, en: 2.96, rc: 1.20, rv: 1.85, ve: 7, val: [1], c: '#a3322b', t: '#ffffff' },
    I: { n: 'Iodine', m: 126.904, en: 2.66, rc: 1.39, rv: 1.98, ve: 7, val: [1], c: '#8b1fa9', t: '#ffffff' }
  };
  var PAL = ['H', 'C', 'N', 'O', 'F', 'P', 'S', 'Cl', 'Br', 'I', 'B', 'Si'];
  var maxVal = function (s) { var v = EL[s].val; return v[v.length - 1]; };
  var targetVal = function (s, sum) { var v = EL[s].val; for (var i = 0; i < v.length; i++) if (v[i] >= sum) return v[i]; return -1; };   // smallest allowed bond count that fits, -1 when over

  /* ================= graph helpers =================
     A molecule is { a: [{s, x, y}], b: [{i, j, o}] }  (atoms with 2D positions, bonds with order 1-3). Hydrogens are real atoms. */
  var SUBS = '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089';
  var sub = function (n) { return String(n).replace(/\d/g, function (d) { return SUBS[+d]; }); };
  function adjOf(G) {
    var adj = G.a.map(function () { return []; });
    G.b.forEach(function (b, k) { adj[b.i].push({ j: b.j, o: b.o, k: k }); adj[b.j].push({ j: b.i, o: b.o, k: k }); });
    return adj;
  }
  function bsum(adj, i) { var t = 0; adj[i].forEach(function (e) { t += e.o; }); return t; }
  function countsOf(G) { var c = {}; G.a.forEach(function (a) { c[a.s] = (c[a.s] || 0) + 1; }); return c; }
  function massOf(G) { var t = 0; G.a.forEach(function (a) { t += EL[a.s].m; }); return t; }
  function copyG(G) { return { a: G.a.map(function (a) { return { s: a.s, x: a.x, y: a.y }; }), b: G.b.map(function (b) { return { i: b.i, j: b.j, o: b.o }; }) }; }
  function components(G) {
    var adj = adjOf(G), seen = {}, out = [];
    G.a.forEach(function (_, s) {
      if (seen[s]) return; var q = [s], c = []; seen[s] = 1;
      while (q.length) { var u = q.pop(); c.push(u); adj[u].forEach(function (e) { if (!seen[e.j]) { seen[e.j] = 1; q.push(e.j); } }); }
      out.push(c);
    });
    return out;
  }
  function subGraph(G, idx) {
    var map = {}, S2 = { a: [], b: [] };
    idx.slice().sort(function (x, y) { return x - y; }).forEach(function (i) { map[i] = S2.a.length; S2.a.push({ s: G.a[i].s, x: G.a[i].x, y: G.a[i].y }); });
    G.b.forEach(function (b) { if (map[b.i] != null && map[b.j] != null) S2.b.push({ i: map[b.i], j: map[b.j], o: b.o }); });
    return S2;
  }
  function withH(G) {   // copy with every open valence filled by explicit hydrogens (positions do not matter for naming)
    var C = copyG(G), adj = adjOf(G);
    G.a.forEach(function (a, i) { var s = bsum(adj, i), t = targetVal(a.s, s); for (var k = s; k < t; k++) { C.a.push({ s: 'H', x: a.x, y: a.y }); C.b.push({ i: i, j: C.a.length - 1, o: 1 }); } });
    return C;
  }
  function lpCount(G, adj, i) {   // lone pairs on atom i (0 when the atom still has open bonds)
    var s = bsum(adj, i), a = G.a[i]; if (targetVal(a.s, s) !== s) return 0;
    return Math.max(0, Math.floor((EL[a.s].ve - s) / 2));
  }
  function fdisp(G) {   // display formula: Hill order for carbon compounds, familiar order (H2O, NH3, H2SO4, SF6) for the rest
    var c = countsOf(G), ks = Object.keys(c), out;
    if (c.C) out = ['C'].concat(c.H ? ['H'] : [], ks.filter(function (k) { return k !== 'C' && k !== 'H'; }).sort());
    else {
      out = ks.filter(function (k) { return k !== 'H'; }).sort(function (x, y) { return EL[x].en - EL[y].en || (x < y ? -1 : 1); });
      if (c.H) { var hl = out.every(function (k) { return ['B', 'Si', 'N', 'P'].indexOf(k) >= 0; }); if (hl && out.length) out.push('H'); else out.unshift('H'); }
    }
    return out.map(function (k) { return k + (c[k] > 1 ? sub(c[k]) : ''); }).join('');
  }
  function hash(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function sigOf(G) {   // same molecule = same signature, whatever the drawing looks like
    var adj = adjOf(G), col = G.a.map(function (a) { return a.s; }), r;
    for (r = 0; r < 6; r++) col = col.map(function (c, i) { return hash(c + '|' + adj[i].map(function (e) { return col[e.j] + e.o; }).sort().join(',')); });
    var c = countsOf(G); return Object.keys(c).sort().map(function (k) { return k + c[k]; }).join('') + ':' + col.slice().sort().join('.');
  }
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function rv3(r) { var x = r() * 2 - 1, y = r() * 2 - 1, z = r() * 2 - 1, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }

  /* ================= shapes and polarity ================= */
  var GEO = {
    '2,0': ['Linear', '180\u00B0'], '3,0': ['Trigonal planar', '120\u00B0'], '2,1': ['Bent', '~120\u00B0'], '4,0': ['Tetrahedral', '109.5\u00B0'],
    '3,1': ['Trigonal pyramidal', '~107\u00B0'], '2,2': ['Bent', '~104.5\u00B0'], '5,0': ['Trigonal bipyramidal', '90\u00B0 and 120\u00B0'], '4,1': ['Seesaw', '~90\u00B0 and ~120\u00B0'],
    '3,2': ['T-shaped', '~90\u00B0'], '2,3': ['Linear', '180\u00B0'], '6,0': ['Octahedral', '90\u00B0'], '5,1': ['Square pyramidal', '~90\u00B0'], '4,2': ['Square planar', '90\u00B0']
  };
  var geoName = function (nb, lp) { return GEO[nb + ',' + lp] || ['Unusual shape', '']; };
  function dEN(a, b) {   // electronegativity gap when the bond counts as polar, otherwise 0 (C-H is treated as nonpolar, the usual textbook rule)
    if ((a === 'C' && b === 'H') || (a === 'H' && b === 'C')) return 0;
    var d = Math.abs(EL[a].en - EL[b].en); return d >= .35 ? d : 0;
  }
  function polarity(G, P) {   // add up the bond dipoles (each points toward the more electronegative atom)
    var v = [0, 0, 0], has = false;
    G.b.forEach(function (b) {
      var d = dEN(G.a[b.i].s, G.a[b.j].s); if (!d) return; has = true;
      var A = P[b.i], B = P[b.j], dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], l = Math.hypot(dx, dy, dz) || 1, sg = EL[G.a[b.j].s].en > EL[G.a[b.i].s].en ? 1 : -1;
      v[0] += sg * d * dx / l; v[1] += sg * d * dy / l; v[2] += sg * d * dz / l;
    });
    var net = Math.hypot(v[0], v[1], v[2]); return { has: has, net: net, polar: has && net > .3 };
  }

  /* ================= 3D shape finder =================
     Starts from the 2D drawing, adds a puff of z, then lets bonds act like springs and electron groups (bonds and lone pairs) push each other away. */
  function relax(G) {
    var n = G.a.length, adj = adjOf(G), i, j, k, cx = 0, cy = 0;
    if (!n) return { P: [], seed: [], LP: [] };
    G.a.forEach(function (a) { cx += a.x; cy += a.y; }); cx /= n; cy /= n;
    var Lfull = adj.map(function (nb, q) { return lpCount(G, adj, q); }), L0 = Lfull.map(function (l, q) { return adj[q].length < 2 ? 0 : l; }), own = [];   // end atoms get their lone pairs drawn afterwards, they do not steer the shape
    for (i = 0; i < n; i++) for (k = 0; k < L0[i]; k++) own.push(i);
    var m = n + own.length, near = [], dom = [], lpIdx = [], c = n;
    for (i = 0; i < n; i++) { near.push(new Array(n)); for (j = 0; j < n; j++) near[i][j] = false; lpIdx.push([]); for (k = 0; k < L0[i]; k++) lpIdx[i].push(c++); }
    for (i = 0; i < n; i++) {
      var nbs = adj[i].map(function (e) { return e.j; });
      nbs.forEach(function (x) { near[i][x] = near[x][i] = true; });
      for (j = 0; j < nbs.length; j++) for (k = j + 1; k < nbs.length; k++) near[nbs[j]][nbs[k]] = near[nbs[k]][nbs[j]] = true;
      dom.push(nbs.concat(lpIdx[i]));
    }
    var Lb = G.b.map(function (b) { return (EL[G.a[b.i].s].rc + EL[G.a[b.j].s].rc) * [1, .9, .82][b.o - 1]; });
    var Lc = adj.map(function (nb) { if (!nb.length) return 1; var t = 0; nb.forEach(function (e) { t += Lb[e.k]; }); return t / nb.length; });   // typical bond length at each atom
    var planes = [];   // atoms next to a double bond stay in one plane
    G.b.forEach(function (b) {
      if (b.o !== 2) return;
      var SA = adj[b.i].filter(function (e) { return e.j !== b.j; }).map(function (e) { return e.j; }), SB = adj[b.j].filter(function (e) { return e.j !== b.i; }).map(function (e) { return e.j; });
      if (SA.length + SB.length < 3) return;
      var refAtom = SA.length ? SA[0] : SB[0], refFrom = SA.length ? b.i : b.j;
      planes.push({ A: b.i, B: b.j, ref: refAtom, from: refFrom, others: SA.concat(SB).filter(function (x) { return x !== refAtom; }) });
    });
    var P, F, E;
    function spr(a, b, len, kk) {
      var dx = P[b][0] - P[a][0], dy = P[b][1] - P[a][1], dz = P[b][2] - P[a][2], d = Math.hypot(dx, dy, dz) || 1e-6, f = kk * (d - len) / d;
      F[a][0] += dx * f; F[a][1] += dy * f; F[a][2] += dz * f; F[b][0] -= dx * f; F[b][1] -= dy * f; F[b][2] -= dz * f; E += .5 * kk * (d - len) * (d - len);
    }
    function rep(a, b, kk) {
      var dx = P[b][0] - P[a][0], dy = P[b][1] - P[a][1], dz = P[b][2] - P[a][2], d2 = dx * dx + dy * dy + dz * dz + .02, d = Math.sqrt(d2), f = kk / d2 / d;
      F[a][0] -= dx * f; F[a][1] -= dy * f; F[a][2] -= dz * f; F[b][0] += dx * f; F[b][1] += dy * f; F[b][2] += dz * f; E += kk / d;
    }
    function repLp(a, b, kk) {   // like rep(), but only the lone-pair particles move (used on end atoms, whose shape does not matter)
      var dx = P[b][0] - P[a][0], dy = P[b][1] - P[a][1], dz = P[b][2] - P[a][2], d2 = dx * dx + dy * dy + dz * dz + .02, d = Math.sqrt(d2), f = kk / d2 / d;
      if (a >= n) { F[a][0] -= dx * f; F[a][1] -= dy * f; F[a][2] -= dz * f; } if (b >= n) { F[b][0] += dx * f; F[b][1] += dy * f; F[b][2] += dz * f; }
    }
    function run(att) {   // one relaxation from one starting guess; returns the finished shape and how much strain it still has
      var rnd = mulberry(20260 + att * 131), v;
      P = []; var seed = [];
      for (i = 0; i < n; i++) P.push([(G.a[i].x - cx) * 1.3, -(G.a[i].y - cy) * 1.3, (att % 2 ? (rnd() < .5 ? 1 : -1) : (i % 2 ? 1 : -1)) * (.5 + rnd() * .6)]);
      for (i = 0; i < n; i++) seed.push([P[i][0], P[i][1], 0]);
      for (i = 0; i < n; i++) for (k = 0; k < L0[i]; k++) { v = rv3(rnd); P.push([P[i][0] + v[0] * .8 * Lc[i], P[i][1] + v[1] * .8 * Lc[i], P[i][2] + v[2] * .8 * Lc[i]]); }
      var iters = n < 3 ? 1 : n <= 12 ? 1100 : n <= 30 ? 600 : 420;
      for (var it = 0; it < iters; it++) {
        F = P.map(function () { return [0, 0, 0]; }); E = 0;
        G.b.forEach(function (b, q) { spr(b.i, b.j, Lb[q], 3); });
        for (k = 0; k < own.length; k++) spr(own[k], n + k, .8 * Lc[own[k]], 2);
        for (i = 0; i < n; i++) {
          var D = dom[i], KS = 1.1 * Lc[i] * Lc[i], endAtom = adj[i].length < 2;
          for (j = 0; j < D.length; j++) for (k = j + 1; k < D.length; k++) { var lj = D[j] >= n, lk = D[k] >= n, w = KS * (lj && lk ? 1.5 : lj || lk ? 1.25 : 1); if (endAtom) repLp(D[j], D[k], w); else rep(D[j], D[k], w); }
        }
        for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
          if (near[i][j]) continue;
          var dx = P[j][0] - P[i][0], dy = P[j][1] - P[i][1], dz = P[j][2] - P[i][2], d = Math.hypot(dx, dy, dz) || 1e-6;
          if (d < 2.3) { var f = .3 * (2.3 - d) / d; F[i][0] -= dx * f; F[i][1] -= dy * f; F[i][2] -= dz * f; F[j][0] += dx * f; F[j][1] += dy * f; F[j][2] += dz * f; E += .15 * (2.3 - d) * (2.3 - d); }
        }
        planes.forEach(function (pl) {
          var A = P[pl.A], B = P[pl.B], R = P[pl.ref], O = P[pl.from];
          var ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = R[0] - O[0], vy = R[1] - O[1], vz = R[2] - O[2];
          var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz); if (nl < 1e-3) return; nx /= nl; ny /= nl; nz /= nl;
          pl.others.forEach(function (s) { var d = (P[s][0] - A[0]) * nx + (P[s][1] - A[1]) * ny + (P[s][2] - A[2]) * nz; F[s][0] -= nx * d * .6; F[s][1] -= ny * d * .6; F[s][2] -= nz * d * .6; E += .3 * d * d; });
        });
        var step = .08 * (1 - it / iters * .5);
        for (i = 0; i < m; i++) {
          var fm = Math.hypot(F[i][0], F[i][1], F[i][2]), sc = fm * step > .25 ? .25 / fm : step;
          P[i][0] += F[i][0] * sc; P[i][1] += F[i][1] * sc; P[i][2] += F[i][2] * sc;
        }
      }
      return { P: P, seed: seed, E: E };
    }
    var tries = n <= 30 ? 4 : n <= 45 ? 2 : 1, best = null, t;
    for (t = 0; t < tries; t++) { var r = run(t); if (!best || r.E < best.E) best = r; }
    P = best.P; var gx = 0, gy = 0, gz = 0;
    for (i = 0; i < n; i++) { gx += P[i][0]; gy += P[i][1]; gz += P[i][2]; } gx /= n; gy /= n; gz /= n;
    for (i = 0; i < m; i++) { P[i][0] -= gx; P[i][1] -= gy; P[i][2] -= gz; }
    best.seed.forEach(function (q) { q[0] -= gx; q[1] -= gy; q[2] -= gz * 0 + 0; });
    var LP = own.map(function (o, q) { return { o: o, p: P[n + q] }; });
    for (i = 0; i < n; i++) {   // lone pairs on end atoms: fan them out on the side facing away from the one bond
      if (adj[i].length !== 1 || !Lfull[i]) continue;
      var nb0 = P[adj[i][0].j], ux = P[i][0] - nb0[0], uy = P[i][1] - nb0[1], uz = P[i][2] - nb0[2], ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
      var ax = Math.abs(ux) < .9 ? [1, 0, 0] : [0, 1, 0], e1 = [uy * ax[2] - uz * ax[1], uz * ax[0] - ux * ax[2], ux * ax[1] - uy * ax[0]], l1 = Math.hypot(e1[0], e1[1], e1[2]) || 1; e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
      var e2 = [uy * e1[2] - uz * e1[1], uz * e1[0] - ux * e1[2], ux * e1[1] - uy * e1[0]];
      for (k = 0; k < Lfull[i]; k++) {
        var th = k * 2 * Math.PI / Lfull[i], cs = Math.cos(th) * .94, sn = Math.sin(th) * .94, len = .8 * Lc[i];
        LP.push({ o: i, p: [P[i][0] + (ux * .33 + e1[0] * cs + e2[0] * sn) * len, P[i][1] + (uy * .33 + e1[1] * cs + e2[1] * sn) * len, P[i][2] + (uz * .33 + e1[2] * cs + e2[2] * sn) * len] });
      }
    }
    return { P: P.slice(0, n), seed: best.seed, LP: LP };
  }

  /* ================= 2D layout for ready-made molecules ================= */
  function layout2D(G) {
    var n = G.a.length, adj = adjOf(G), pos = new Array(n), par = new Array(n), q = [0], seen = { 0: 1 }, rnd = mulberry(77), i, it, j;
    if (!n) return G;
    pos[0] = [0, 0]; par[0] = null;
    while (q.length) {
      var u = q.shift(), kids = adj[u].filter(function (e) { return !seen[e.j]; }).map(function (e) { return e.j; }), tot = kids.length + (par[u] != null ? 1 : 0);
      if (!tot) continue;
      var st = 2 * Math.PI / tot, base = par[u] == null ? rnd() * 6.28 : par[u] + st;
      kids.forEach(function (c, t) { var ang = base + st * t; pos[c] = [pos[u][0] + Math.cos(ang) + (rnd() - .5) * .04, pos[u][1] + Math.sin(ang) + (rnd() - .5) * .04]; par[c] = ang + Math.PI; seen[c] = 1; q.push(c); });
    }
    for (i = 0; i < n; i++) if (!pos[i]) pos[i] = [rnd() * 3, rnd() * 3];
    var bonded = {}, share = {};
    G.b.forEach(function (b) { bonded[b.i + '_' + b.j] = bonded[b.j + '_' + b.i] = 1; });
    for (i = 0; i < n; i++) for (var x = 0; x < adj[i].length; x++) for (var y = x + 1; y < adj[i].length; y++) { var A = adj[i][x].j, B = adj[i][y].j; share[A + '_' + B] = share[B + '_' + A] = 1; }
    for (it = 0; it < 280; it++) {
      var F = pos.map(function () { return [0, 0]; });
      G.b.forEach(function (b) {
        var dx = pos[b.j][0] - pos[b.i][0], dy = pos[b.j][1] - pos[b.i][1], d = Math.hypot(dx, dy) || 1e-6, f = (d - 1) / d;
        F[b.i][0] += dx * f; F[b.i][1] += dy * f; F[b.j][0] -= dx * f; F[b.j][1] -= dy * f;
      });
      for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
        if (bonded[i + '_' + j]) continue;
        var ex = pos[j][0] - pos[i][0], ey = pos[j][1] - pos[i][1], d2 = ex * ex + ey * ey + .02, dd = Math.sqrt(d2), k2 = (share[i + '_' + j] ? 1.1 : .45) / d2 / dd;
        F[i][0] -= ex * k2; F[i][1] -= ey * k2; F[j][0] += ex * k2; F[j][1] += ey * k2;
      }
      for (i = 0; i < n; i++) { var fm = Math.hypot(F[i][0], F[i][1]), sc = fm * .1 > .2 ? .2 / fm : .1; pos[i][0] += F[i][0] * sc; pos[i][1] += F[i][1] * sc; }
    }
    var cx = 0, cy = 0; pos.forEach(function (p) { cx += p[0]; cy += p[1]; }); cx /= n; cy /= n;
    G.a.forEach(function (a, k) { a.x = pos[k][0] - cx; a.y = pos[k][1] - cy; });
    return G;
  }

  /* ================= ready-made molecules ================= */
  function parseSmi(str) {   // tiny SMILES reader: atoms, - = # bonds, ( ) branches, ring digits. Missing hydrogens are filled in.
    var A = [], B = [], stack = [], prev = -1, ord = 1, rings = {}, i = 0, two = { Cl: 1, Br: 1, Si: 1 };
    while (i < str.length) {
      var ch = str[i];
      if (ch === '(') { stack.push(prev); i++; continue; }
      if (ch === ')') { prev = stack.pop(); i++; continue; }
      if (ch === '-') { ord = 1; i++; continue; } if (ch === '=') { ord = 2; i++; continue; } if (ch === '#') { ord = 3; i++; continue; }
      if (/\d/.test(ch)) { var r = rings[ch]; if (r == null) rings[ch] = { i: prev, o: ord }; else { B.push({ i: r.i, j: prev, o: Math.max(r.o, ord) }); delete rings[ch]; } ord = 1; i++; continue; }
      var s = str.substr(i, 2); if (two[s]) i += 2; else { s = ch; i++; }
      A.push({ s: s, x: 0, y: 0 }); var k = A.length - 1; if (prev >= 0) B.push({ i: prev, j: k, o: ord }); prev = k; ord = 1;
    }
    return withH({ a: A, b: B });
  }
  var W_TOX = 'Real-life note: this is toxic. Only trained chemists handle it, with proper safety gear.';
  var W_COR = 'Real-life note: this is corrosive. Never touch, taste or mix unknown chemicals.';
  var W_FIR = 'Real-life note: this is very flammable. Keep it away from flames and sparks.';
  var W_CAN = 'Real-life note: benzene is toxic and can cause cancer. Only trained chemists handle it.';
  var W_MED = 'Real-life note: medicines are only for use as a doctor or pharmacist says.';
  /* [SMILES, name, state at room temperature, boiling point in C (or null), text, warning, polarity override] */
  var DB = [
    ['HH', 'Hydrogen gas', 'gas', -253, 'The lightest molecule. Two hydrogen atoms share one pair of electrons (a single covalent bond).', W_FIR],
    ['O=O', 'Oxygen gas', 'gas', -183, 'The gas we breathe. The two oxygen atoms share two pairs of electrons, a double bond.'],
    ['N#N', 'Nitrogen gas', 'gas', -196, 'About 78% of air. A triple bond holds the two atoms together, which is very hard to break.'],
    ['FF', 'Fluorine gas', 'gas', -188, 'A pale yellow gas and the most reactive nonmetal.', W_TOX],
    ['ClCl', 'Chlorine gas', 'gas', -34, 'A greenish-yellow gas. Tiny amounts disinfect drinking water and pools.', W_TOX],
    ['O', 'Water', 'liquid', 100, 'The two lone pairs on oxygen squeeze the O-H bonds closer, so water is bent, not straight. That bent, polar shape makes it a great solvent.'],
    ['OO', 'Hydrogen peroxide', 'liquid', 150, 'Like water with one extra oxygen. Weak solutions are mild antiseptics, strong ones are powerful bleaches.', W_COR, 'twist'],
    ['N', 'Ammonia', 'gas', -33, 'A sharp-smelling gas used to make fertilizers. The lone pair on nitrogen gives it a pyramid shape.', W_COR],
    ['C', 'Methane', 'gas', -162, 'The main part of natural gas. Four identical C-H bonds point to the corners of a tetrahedron.', W_FIR],
    ['CC', 'Ethane', 'gas', -89, 'Two carbons joined by a single bond. Found in natural gas.', W_FIR],
    ['CCC', 'Propane', 'gas', -42, 'Fuel gas for grills and camping stoves. It is stored as a liquid under pressure.', W_FIR],
    ['CCCC', 'Butane', 'gas', -1, 'Used in lighters and camp stoves. It has an isomer with the same atoms joined in a different pattern: isobutane.', W_FIR],
    ['CC(C)C', 'Isobutane (2-methylpropane)', 'gas', -12, 'Same atoms as butane (C\u2084H\u2081\u2080) but branched. Isomers can behave differently: isobutane boils at a different temperature.', W_FIR],
    ['CCCCC', 'Pentane', 'liquid', 36, 'A hydrocarbon liquid. Five carbons in a row that can twist freely around their single bonds.', W_FIR],
    ['C1CCCCC1', 'Cyclohexane', 'liquid', 81, 'A ring of six carbons, used to make nylon. Real cyclohexane puckers into a chair shape.', W_FIR],
    ['C1CC1', 'Cyclopropane', 'gas', -33, 'A tiny ring of three carbons. Its bonds are bent to 60\u00B0, far from the ideal 109.5\u00B0, so it is strained and reactive.', W_FIR],
    ['C=C', 'Ethene (ethylene)', 'gas', -104, 'The C=C double bond makes the molecule flat. Fruits release it as they ripen, and it is used to make polyethylene plastic.', W_FIR],
    ['CC=C', 'Propene (propylene)', 'gas', -48, 'Used to make polypropylene plastic. The C=C double bond is flat and stiff.', W_FIR],
    ['C#C', 'Ethyne (acetylene)', 'gas', null, 'The triple bond makes it linear. It burns with a very hot flame, so it is used in welding torches. It turns straight from solid to gas at -84 \u00B0C instead of boiling.', W_FIR],
    ['C1=CC=CC=C1', 'Benzene', 'liquid', 80, 'A flat hexagon of six carbons. Its electrons are shared around the whole ring, so all the bonds are really the same length (alternating double bonds are just a way to draw it).', W_CAN],
    ['CC1=CC=CC=C1', 'Toluene', 'liquid', 111, 'Benzene with a methyl group attached. Used as a solvent in paints and thinners.', W_FIR],
    ['OC1=CC=CC=C1', 'Phenol', 'solid', 182, 'A benzene ring with an OH group. Used to make plastics and disinfectants.', W_COR],
    ['F', 'Hydrogen fluoride', 'gas', 19.5, 'Fluorine pulls so hard on the electrons that H-F is one of the most polar bonds there is. It dissolves in water to make hydrofluoric acid, which can etch glass.', W_TOX],
    ['Cl', 'Hydrogen chloride', 'gas', -85, 'Dissolves in water to make hydrochloric acid. Your stomach makes a dilute version to help digest food.', W_COR],
    ['Br', 'Hydrogen bromide', 'gas', -67, 'A gas that dissolves in water to make hydrobromic acid, a strong acid.', W_COR],
    ['I', 'Hydrogen iodide', 'gas', -35, 'A gas that dissolves in water to make hydroiodic acid, a strong acid.', W_COR],
    ['S', 'Hydrogen sulfide', 'gas', -60, 'Smells like rotten eggs. Shaped like water, but it is a gas because it cannot hydrogen-bond as well.', W_TOX],
    ['P', 'Phosphine', 'gas', -88, 'A pyramid-shaped gas like ammonia. Its bonds are nearly nonpolar, but the lone pair on phosphorus still makes it weakly polar.', W_TOX, 'lp'],
    ['Si', 'Silane', 'gas', -112, 'The silicon version of methane: four identical bonds in a tetrahedron.', W_FIR],
    ['O=C=O', 'Carbon dioxide', 'gas', null, 'Linear shape: the two polar C=O bonds pull in opposite directions and cancel out, so the molecule is nonpolar. Solid CO\u2082 (dry ice) turns straight into gas at -78 \u00B0C.'],
    ['O=S=O', 'Sulfur dioxide', 'gas', -10, 'A sharp-smelling gas from volcanoes and burning fuels, and a cause of acid rain. It is bent because sulfur has a lone pair.', W_TOX],
    ['OS(=O)(=O)O', 'Sulfuric acid', 'liquid', 337, 'One of the most-made chemicals in industry. Car batteries use it.', W_COR],
    ['OP(=O)(O)O', 'Phosphoric acid', 'solid', null, 'Gives cola its tangy taste and is used in fertilizers. It is sold as a thick water solution because it takes in moisture.', W_COR],
    ['FB(F)F', 'Boron trifluoride', 'gas', -100, 'Boron has only six electrons around it. The three fluorines sit in a flat triangle, so the molecule is nonpolar.', W_TOX],
    ['ClC(Cl)(Cl)Cl', 'Carbon tetrachloride', 'liquid', 77, 'Four polar C-Cl bonds in a perfect tetrahedron cancel out, so it is a nonpolar solvent.', W_TOX],
    ['ClC(Cl)Cl', 'Chloroform', 'liquid', 61, 'Methane with three hydrogens swapped for chlorine. The bonds do not cancel, so it is polar.', W_TOX],
    ['FC(F)(F)F', 'Carbon tetrafluoride', 'gas', -128, 'The C-F bonds are very strong. The shape is perfectly symmetric, so the molecule is nonpolar.'],
    ['CCl', 'Chloromethane', 'gas', -24, 'Methane with one hydrogen swapped for chlorine. Chlorine pulls the electrons, so it is polar.', W_TOX],
    ['CO', 'Methanol', 'liquid', 65, 'The simplest alcohol (an OH group on a carbon). Used as a fuel and a solvent.', W_TOX],
    ['CCO', 'Ethanol', 'liquid', 78, 'The alcohol in drinks and fuel blends. It is an isomer of dimethyl ether: same atoms, different arrangement.', W_FIR],
    ['CC(C)O', 'Isopropanol', 'liquid', 82, 'Rubbing alcohol. The OH group sits on the middle carbon.', W_FIR],
    ['OCC(O)CO', 'Glycerol', 'liquid', 290, 'Three OH groups make lots of hydrogen bonds, which makes it thick and syrupy. Used in soaps and foods.'],
    ['COC', 'Dimethyl ether', 'gas', -24, 'Same atoms as ethanol (C\u2082H\u2086O) but the oxygen sits in the middle, so there is no O-H bond. That is why it is a gas.', W_FIR],
    ['CC(=O)O', 'Acetic acid', 'liquid', 118, 'The acid in vinegar.', W_COR],
    ['O=CO', 'Formic acid', 'liquid', 101, 'Ants and stinging nettles use it to sting.', W_COR],
    ['CC(=O)C', 'Acetone', 'liquid', 56, 'Nail polish remover. The C=O group in the middle is polar.', W_FIR],
    ['C=O', 'Formaldehyde', 'gas', -19, 'A flat, polar molecule used to make resins and to preserve specimens.', W_TOX],
    ['CN', 'Methylamine', 'gas', -6, 'Like ammonia with one hydrogen swapped for a CH\u2083 group. It has a fishy smell.', W_TOX],
    ['NC(=O)N', 'Urea', 'solid', null, 'Your body makes it to get rid of extra nitrogen. In 1828 it became the first organic compound made from non-living ingredients.'],
    ['NCC(=O)O', 'Glycine', 'solid', null, 'The simplest amino acid, one of the building blocks of proteins.'],
    ['S=C=S', 'Carbon disulfide', 'liquid', 46, 'Linear like CO\u2082, but with sulfur instead of oxygen.', W_TOX],
    ['NN', 'Hydrazine', 'liquid', 114, 'Two nitrogens joined by a single bond. Used as a rocket fuel.', W_TOX],
    ['CS', 'Methanethiol', 'gas', 6, 'Like methanol but with sulfur. It smells like rotten cabbage.', W_TOX],
    ['FOF', 'Oxygen difluoride', 'gas', -145, 'Bent like water, but with fluorine in place of hydrogen.', W_TOX],
    ['FS(F)(F)(F)(F)F', 'Sulfur hexafluoride', 'gas', null, 'Six fluorines around one sulfur in an octahedron. Very stable, so it is used as an insulating gas in electrical equipment. It turns straight from solid to gas at -64 \u00B0C.'],
    ['FS(F)(F)F', 'Sulfur tetrafluoride', 'gas', -38, 'Seesaw shape: sulfur has four bonds and one lone pair.', W_TOX],
    ['ClP(Cl)Cl', 'Phosphorus trichloride', 'liquid', 76, 'A pyramid with a lone pair on phosphorus.', W_COR],
    ['ClP(Cl)(Cl)(Cl)Cl', 'Phosphorus pentachloride', 'solid', null, 'Five chlorines make a trigonal bipyramid: three in a flat triangle and one above and one below.', W_COR],
    ['OCC1OC(O)C(O)C(O)C1O', 'Glucose (ring form)', 'solid', null, 'Your body\'s main sugar. In water, glucose mostly exists in this six-membered ring form.'],
    ['CC(=O)OC1=CC=CC=C1C(=O)O', 'Aspirin (acetylsalicylic acid)', 'solid', null, 'A benzene ring carrying an ester group and an acid group. Used as a pain reliever.', W_MED]
  ];
  var DBMAP = null;
  function dbMap() {
    if (DBMAP) return DBMAP; DBMAP = {};
    DB.forEach(function (r) { r.g = parseSmi(r[0]); r.k = sigOf(r.g); DBMAP[r.k] = r; });
    return DBMAP;
  }
  function identify(G) { var r = dbMap()[sigOf(G)]; return r ? { k: r.k, n: r[1], st: r[2], bp: r[3], t: r[4], w: r[5] || '', pol: r[6] || '', r: r } : null; }
  var EXAMPLES = ['O', 'C', 'O=C=O', 'N', 'CCO', 'COC', 'C1=CC=CC=C1', 'FS(F)(F)(F)(F)F', 'OCC1OC(O)C(O)C(O)C1O'];

  /* ================= analysis (what the side panel shows) ================= */
  function analyze(G) {
    var R = { empty: !G.a.length }; if (R.empty) return R;
    var comps = components(G).sort(function (x, y) { return y.length - x.length; });
    R.pieces = comps.length;
    var M = comps.length > 1 ? subGraph(G, comps[0]) : G, adj = adjOf(M), i;
    R.atoms = M.a.length; R.bonds = M.b.length; R.rings = M.b.length - M.a.length + 1; R.formula = fdisp(M); R.mass = massOf(M);
    R.open = []; R.over = []; R.nOpen = 0;
    for (i = 0; i < M.a.length; i++) {
      var s = bsum(adj, i), t = targetVal(M.a[i].s, s);
      if (t < 0) R.over.push({ i: i, s: M.a[i].s }); else if (t > s) { R.open.push({ i: i, s: M.a[i].s, miss: t - s }); R.nOpen += t - s; }
    }
    if (R.open.length || R.over.length) {
      if (!R.over.length) { var F = withH(M), h = identify(F); if (h) R.hint = { n: h.n, f: fdisp(F) }; }
      return R;
    }
    R.complete = true;
    var hit = identify(M); if (hit) { R.hit = hit; R.name = hit.n; R.key = hit.k; } else R.key = sigOf(M);
    var gm = {}, order = [];
    for (i = 0; i < M.a.length; i++) {
      var nb = adj[i].length; if (nb < 2) continue;
      var g = geoName(nb, lpCount(M, adj, i)), key = M.a[i].s + '|' + g[0];
      if (!gm[key]) { gm[key] = { s: M.a[i].s, n: g[0], ang: g[1], c: 0 }; order.push(key); } gm[key].c++;
    }
    R.geo = order.map(function (k) { return gm[k]; });
    var rx = relax(M); R.pol = polarity(M, rx.P);
    if (hit && hit.pol) { R.pol.polar = true; R.pol.override = hit.pol; }
    return R;
  }

  /* ================= state ================= */
  var S = { g: { a: [], b: [] }, sel: { a: -1, b: -1 }, el: 'C', view: '2d', hist: [], loaded: false, touched: false, newKey: '', an: null, mode: 'ball', lps: false, auto: true, v: { s: 56, ox: 0, oy: 0, init: false } };
  var root = null, wrap = null, opts = {}, alive = false, cv = null, cvw = null, ctx = null, host3 = null, raf2 = 0, anT = 0, lastW = 0, lastH = 0, ro = null, mo = null, ptrs = {}, gest = null, pin = null, keyFn = null;
  var $ = function (s, r) { return (r || wrap || document).querySelector(s); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var toast = function (t) { if (opts.toast) opts.toast(t); };
  var calm = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var ICO = {
    back: 'M15 6l-6 6 6 6', book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3', x: 'M6 6l12 12M18 6L6 18', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 21v-7h8v7', hplus: 'M5 5v14M5 12h8M13 5v14M19 8v6M16 11h6',
    mol: 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0M6.5 7.3l3 3M17.3 8.6l-3.3 2.2M15.5 17.5l-2-3',
    cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', pen: 'M4 20l4-1L19 8l-3-3L5 16zM14 7l3 3',
    notes: 'M6 3h9l4 4v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM14.5 3v4.5H19M8.5 12h7M8.5 16h5', chat: 'M4 5h16v11H9l-5 4z'
  };
  var ic = function (n, s) { return '<svg viewBox="0 0 24 24" width="' + (s || 16) + '" height="' + (s || 16) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICO[n] + '"/></svg>'; };

  /* ================= Molecule Book (saved on this device) ================= */
  function packG(G) { return { a: G.a.map(function (a) { return [a.s, +a.x.toFixed(2), +a.y.toFixed(2)]; }), b: G.b.map(function (b) { return [b.i, b.j, b.o]; }) }; }
  function unpackG(p) {
    try {
      var G = { a: p.a.map(function (r) { if (!EL[r[0]]) throw 0; return { s: r[0], x: +r[1] || 0, y: +r[2] || 0 }; }), b: p.b.map(function (r) { if (r[0] >= p.a.length || r[1] >= p.a.length || r[2] < 1 || r[2] > 3) throw 0; return { i: r[0], j: r[1], o: r[2] }; }) };
      return G;
    } catch (e) { return null; }
  }
  function loadBook() { try { var b = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(b) ? b : []; } catch (e) { return []; } }
  function saveBook(b) { try { localStorage.setItem(KEY, JSON.stringify(b.slice(0, 120))); } catch (e) { } }
  function bookAdd(R, G, custom) {   // true when it is new
    var b = loadBook(); if (b.some(function (x) { return x.k === R.key; })) return false;
    var M = components(G).length > 1 ? subGraph(G, components(G).sort(function (x, y) { return y.length - x.length; })[0]) : G;
    b.unshift({ k: R.key, f: R.formula, n: R.name || 'My molecule', st: R.hit ? R.hit.st : '', c: custom ? 1 : 0, g: packG(M), t: Date.now() }); saveBook(b); return true;
  }

  /* ================= building: edits ================= */
  function pushHist() { S.hist.push(JSON.stringify(S.g)); if (S.hist.length > 50) S.hist.shift(); }
  function changed(topo) {
    if (topo) { S.loaded = false; S.touched = true; }
    scheduleAnalyze(); dirty(); updateBits();
  }
  var anTimer = 0;
  function scheduleAnalyze() { clearTimeout(anTimer); anTimer = setTimeout(refresh, 90); }
  function refresh() {
    if (!alive) return; S.an = analyze(S.g);
    var R = S.an;
    if (R.complete && S.touched && !S.loaded) { if (bookAdd(R, S.g, !R.hit)) { if (R.hit) { S.newKey = R.key; toast('New molecule: ' + R.hit.n); } } }
    if (!R.complete || R.key !== S.newKey) { if (R.key !== S.newKey) S.newKey = (R.complete && R.hit && S.newKey === R.key) ? S.newKey : ''; }
    var p = $('#mcpanel'); if (p) p.innerHTML = panelHtml(R);
    var bn = $('#mcbn'); if (bn) bn.textContent = loadBook().length;
    if (cv) cv.setAttribute('aria-label', R.empty ? 'Molecule builder canvas, empty' : 'Molecule builder canvas. ' + R.atoms + ' atoms, formula ' + R.formula.replace(/[\u2080-\u2089]/g, function (d) { return SUBS.indexOf(d); }));
  }
  function overlap(x, y, g) { return g.a.some(function (a) { return Math.hypot(a.x - x, a.y - y) < .55; }); }
  function placeAt(wx, wy) {
    var g = S.g, el = S.el, si = S.sel.a;
    if (g.a.length >= MAXA) { toast('That is the max for this builder (' + MAXA + ' atoms).'); return; }
    if (si >= 0) {
      var adj = adjOf(g), a0 = g.a[si];
      if (bsum(adj, si) + 1 > maxVal(a0.s)) { toast(EL[a0.s].n + ' can only make ' + maxVal(a0.s) + (maxVal(a0.s) === 1 ? ' bond' : ' bonds') + ', and it is full.'); return; }
      var ang = Math.atan2(wy - a0.y, wx - a0.x), best = null;
      for (var t = 0; t < 13 && !best; t++) { var off = (t % 2 ? 1 : -1) * Math.ceil(t / 2) * .52, x = a0.x + Math.cos(ang + off), y = a0.y + Math.sin(ang + off); if (!overlap(x, y, g)) best = [x, y]; }
      if (!best) best = [a0.x + Math.cos(ang), a0.y + Math.sin(ang)];
      pushHist(); g.a.push({ s: el, x: best[0], y: best[1] }); g.b.push({ i: si, j: g.a.length - 1, o: 1 }); S.sel = { a: g.a.length - 1, b: -1 };
    } else { pushHist(); g.a.push({ s: el, x: wx, y: wy }); S.sel = { a: g.a.length - 1, b: -1 }; }
    changed(true); setInfo(selInfoHtml());
  }
  function bondAtoms(i, j) {   // make a single bond, or step an existing bond up to double, triple, then back to single
    var g = S.g, adj = adjOf(g), ex = null;
    adj[i].forEach(function (e) { if (e.j === j) ex = e; });
    if (!ex) {
      if (bsum(adj, i) + 1 > maxVal(g.a[i].s)) { toast(EL[g.a[i].s].n + ' is full. It cannot make another bond.'); return false; }
      if (bsum(adj, j) + 1 > maxVal(g.a[j].s)) { toast(EL[g.a[j].s].n + ' is full. It cannot make another bond.'); return false; }
      pushHist(); g.b.push({ i: i, j: j, o: 1 }); changed(true); return true;
    }
    var cur = g.b[ex.k].o, si = bsum(adj, i) - cur, sj = bsum(adj, j) - cur, o2 = cur;
    for (var t = 0; t < 3; t++) { o2 = o2 % 3 + 1; if (si + o2 <= maxVal(g.a[i].s) && sj + o2 <= maxVal(g.a[j].s)) break; o2 = -1; }
    if (o2 < 0 || o2 === cur) { toast('These atoms cannot make a stronger bond. They have no free bonds left.'); return false; }
    pushHist(); g.b[ex.k].o = o2; S.sel = { a: -1, b: ex.k }; changed(true); return true;
  }
  function cycleBond(k) {
    var g = S.g, b = g.b[k], adj = adjOf(g), si = bsum(adj, b.i) - b.o, sj = bsum(adj, b.j) - b.o, o2 = b.o;
    for (var t = 0; t < 3; t++) { o2 = o2 % 3 + 1; if (si + o2 <= maxVal(g.a[b.i].s) && sj + o2 <= maxVal(g.a[b.j].s)) break; o2 = -1; }
    if (o2 < 0 || o2 === b.o) { toast('Those atoms have no free bonds left to make this bond stronger.'); return; }
    pushHist(); b.o = o2; changed(true); setInfo(selInfoHtml());
  }
  function removeAtom(k) {
    var g = S.g; g.a.splice(k, 1);
    g.b = g.b.filter(function (b) { return b.i !== k && b.j !== k; }).map(function (b) { return { i: b.i > k ? b.i - 1 : b.i, j: b.j > k ? b.j - 1 : b.j, o: b.o }; });
  }
  function del() {
    var g = S.g;
    if (S.sel.a >= 0 && g.a[S.sel.a]) { pushHist(); removeAtom(S.sel.a); S.sel = { a: -1, b: -1 }; changed(true); setInfo(selInfoHtml()); }
    else if (S.sel.b >= 0 && g.b[S.sel.b]) { pushHist(); g.b.splice(S.sel.b, 1); S.sel = { a: -1, b: -1 }; changed(true); setInfo(selInfoHtml()); }
    else toast('Tap an atom or a bond first, then press Delete.');
  }
  function undo() {
    if (!S.hist.length) { toast('Nothing to undo.'); return; }
    S.g = JSON.parse(S.hist.pop()); S.sel = { a: -1, b: -1 }; changed(true); setInfo(selInfoHtml());
  }
  function clearAll() {
    if (!S.g.a.length) return; pushHist(); S.g = { a: [], b: [] }; S.sel = { a: -1, b: -1 }; S.touched = false; S.loaded = false; changed(false); setInfo(selInfoHtml());
  }
  function placeH(g, i) {
    var a = g.a[i], angs = [], k, best = 0, bd = -1;
    g.b.forEach(function (b) { var j = b.i === i ? b.j : b.j === i ? b.i : -1; if (j >= 0) angs.push(Math.atan2(g.a[j].y - a.y, g.a[j].x - a.x)); });
    for (k = 0; k < 24; k++) {
      var th = k * Math.PI / 12, md = 9, x = a.x + Math.cos(th), y = a.y + Math.sin(th);
      angs.forEach(function (q) { md = Math.min(md, Math.abs(Math.atan2(Math.sin(th - q), Math.cos(th - q)))); });
      if (overlap(x, y, g)) md -= 2;
      if (md > bd) { bd = md; best = th; }
    }
    g.a.push({ s: 'H', x: a.x + Math.cos(best), y: a.y + Math.sin(best) }); g.b.push({ i: i, j: g.a.length - 1, o: 1 });
  }
  function fillH() {
    var g = S.g, adj = adjOf(g), add = [], tot = 0;
    g.a.forEach(function (a, i) { var s = bsum(adj, i), t = targetVal(a.s, s); if (t > s) { add.push([i, t - s]); tot += t - s; } });
    if (!add.length) { toast('Nothing to fill. Every atom already has all its bonds.'); return; }
    if (g.a.length + tot > MAXA) { toast('That would be more than ' + MAXA + ' atoms.'); return; }
    pushHist(); add.forEach(function (r) { for (var k = 0; k < r[1]; k++) placeH(g, r[0]); }); changed(true); setInfo(selInfoHtml());
  }
  function loadGraph(G, keepHist) {
    if (S.g.a.length && keepHist !== false) pushHist();
    S.g = G; S.sel = { a: -1, b: -1 }; S.loaded = true; S.touched = false; S.newKey = '';
    fitView(); scheduleAnalyze(); dirty(); updateBits(); setInfo(selInfoHtml());
    if (S.view === '3d') rebuild3();
  }
  function loadSmi(smi) { var g = parseSmi(smi); layout2D(g); loadGraph(g); }

  /* ================= info bar ================= */
  function atomInfoHtml(G, adj, i) {
    var a = G.a[i], e = EL[a.s], s = bsum(adj, i), nb = adj[i].length, t = targetVal(a.s, s), lp = lpCount(G, adj, i), parts = [a.s, s + ' of ' + maxVal(a.s) + (maxVal(a.s) === 1 ? ' bond' : ' bonds') + ' used'];
    if (t > s) parts.push('needs ' + (t - s) + ' more'); else if (t < 0) parts.push('too many bonds');
    else { if (lp) parts.push(lp + (lp === 1 ? ' lone pair' : ' lone pairs')); if (nb >= 2) { var g = geoName(nb, lp); parts.push(g[0] + (g[1] ? ', ' + g[1] : '')); } }
    return '<b>' + esc(e.n) + '</b><span>' + esc(parts.join(' \u00B7 ')) + '</span>';
  }
  function selInfoHtml() {
    var g = S.g;
    if (S.sel.a >= 0 && g.a[S.sel.a]) return atomInfoHtml(g, adjOf(g), S.sel.a) + '<span class="mc-hn"> Tap empty space to add a bonded ' + EL[S.el].n.toLowerCase() + ', or tap another atom to bond them.</span>';
    if (S.sel.b >= 0 && g.b[S.sel.b]) {
      var b = g.b[S.sel.b], A = g.a[b.i].s, B = g.a[b.j].s, d = Math.abs(EL[A].en - EL[B].en), kind = !dEN(A, B) ? 'nonpolar covalent' : d >= 1.7 ? 'very polar (close to ionic)' : 'polar covalent';
      return '<b>' + A + ['\u2013', '=', '\u2261'][b.o - 1] + B + '</b><span>' + ['single', 'double', 'triple'][b.o - 1] + ' bond \u00B7 ' + kind + ' (\u0394EN ' + d.toFixed(2) + ')</span><span class="mc-hn"> Tap it again to change the bond order.</span>';
    }
    return g.a.length ? 'Tap an atom to select it. Drag atoms to move them. Drag empty space to pan.' : 'Pick an atom below, then tap the canvas to place it. Select an atom and tap empty space to grow a bonded chain.';
  }
  function setInfo(h) { var el = $('#mcinfo'); if (el) el.innerHTML = h; }

  /* ================= side panel ================= */
  function stChip(st) { return st ? '<u class="lb-sc ' + st + '">' + st.charAt(0).toUpperCase() + st.slice(1) + ' at room temperature</u>' : ''; }
  function panelHtml(R) {
    if (!R || R.empty) return '<div class="lb-be">' + ic('mol', 28) + '<b>Start building</b><span>Pick an atom, tap the canvas, and bond atoms together. The formula, shape and properties show up here.</span></div>';
    var h = '';
    if (R.hit && R.key === S.newKey) h += '<span class="lb-new">NEW MOLECULE</span>';
    h += '<div class="mc-f">' + esc(R.formula) + '</div><h3>' + esc(R.name || (R.complete ? 'Custom molecule' : 'Unfinished molecule')) + '</h3>';
    if (R.complete) {
      h += '<div class="mc-chips">' + (R.hit ? stChip(R.hit.st) : '') + '<u class="lb-sc mc-pl' + (R.pol.polar ? ' p' : '') + '">' + (R.pol.polar ? 'Polar' : 'Nonpolar') + '</u></div>';
    }
    if (R.pieces > 1) h += '<p class="lb-wn">There are ' + R.pieces + ' separate pieces on the canvas. This panel shows the biggest one.</p>';
    if (R.over.length) h += '<p class="lb-wn">' + esc(EL[R.over[0].s].n) + ' has too many bonds. Select a bond and press Delete, or undo.</p>';
    else if (R.open.length) {
      h += '<p class="lb-wn">Not finished: ' + R.nOpen + ' open ' + (R.nOpen === 1 ? 'bond' : 'bonds') + ' (the amber badges on the canvas). Atoms want all their bonds filled.</p>';
      if (R.hint) h += '<p class="lb-hn"><b>Fill with H</b> would make ' + esc(R.hint.n) + ' (' + esc(R.hint.f) + ').</p>';
      h += '<div class="lb-rb"><button type="button" class="lb-b pr" data-mc="fillh">' + ic('hplus', 15) + '<span>Fill with H</span></button></div>';
    }
    h += '<dl class="mc-st"><div><dt>Molar mass</dt><dd>' + R.mass.toFixed(2) + ' g/mol</dd></div><div><dt>Atoms</dt><dd>' + R.atoms + '</dd></div><div><dt>Bonds</dt><dd>' + R.bonds + '</dd></div><div><dt>Rings</dt><dd>' + R.rings + '</dd></div>' +
      (R.complete ? '<div><dt>Boiling point</dt><dd>' + (R.hit && R.hit.bp != null ? R.hit.bp + ' \u00B0C' : R.hit ? 'see note' : 'unknown') + '</dd></div>' : '') + '</dl>';
    if (R.complete) {
      h += '<div class="mc-sec"><b>Shape</b>';
      if (R.geo.length) h += '<ul>' + R.geo.map(function (g) { return '<li><i>' + esc(g.s) + (g.c > 1 ? ' \u00D7' + g.c : '') + '</i> ' + esc(g.n) + (g.ang ? ' <span>' + esc(g.ang) + '</span>' : '') + '</li>'; }).join('') + '</ul>';
      else h += '<p>Linear. Any two atoms line up in a straight line.</p>';
      h += '</div><div class="mc-sec"><b>Polarity</b><p>' + (R.pol.override === 'twist' ? 'The bonds are polar and the molecule is twisted, not flat or straight, so the pulls do not cancel. It is polar.' : R.pol.override ? 'Its bonds are nearly nonpolar, but the lone pair on the central atom makes one side slightly negative, so it is weakly polar.' : !R.pol.has ? 'All the bonds are nonpolar, so the molecule is nonpolar.' : R.pol.polar ? 'The bonds pull electrons unevenly and do not cancel out, so one side is slightly negative and the other slightly positive.' : 'The bonds are polar, but they pull in opposite directions and cancel out because of the shape, so the molecule is nonpolar.') + ' <em>(estimated from electronegativity)</em></p></div>';
      if (R.hit) h += '<p class="lb-tx">' + esc(R.hit.t) + '</p>' + (R.hit.w ? '<p class="lb-wn">' + esc(R.hit.w) + '</p>' : '');
      else h += '<p class="lb-tx">This one is not in my list of known molecules, so it might be something new. Real chemistry would need a lab to confirm it is stable.</p>';
      h += '<div class="lb-rb"><button type="button" class="lb-b" data-mc="note">' + ic('notes', 15) + '<span>Send to Notes</span></button><button type="button" class="lb-b" data-mc="ask">' + ic('chat', 15) + '<span>Ask Spectra</span></button></div>' +
        '<div class="lb-rb"><button type="button" class="lb-b" data-mc="save">' + ic('save', 15) + '<span>Save to Book</span></button><button type="button" class="lb-b pr" data-mc="v3">' + ic('cube', 15) + '<span>See it in 3D</span></button></div>';
    }
    return h;
  }

  /* ================= 2D canvas ================= */
  var sfOf = function () { return clamp(S.v.s / 56, .55, 1.35); };
  var atomR = function (a) { return (a.s === 'H' ? 13 : 19) * sfOf(); };
  var toS = function (x, y) { return [S.v.ox + x * S.v.s, S.v.oy + y * S.v.s]; };
  var toW = function (px, py) { return [(px - S.v.ox) / S.v.s, (py - S.v.oy) / S.v.s]; };
  function dirty() { if (!raf2 && alive && S.view === '2d') raf2 = requestAnimationFrame(draw); }
  function sizeCv() {
    if (!cv || !cvw) return; var w = cvw.clientWidth, h = cvw.clientHeight; if (w < 2 || h < 2) return;
    var r = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * r) || cv.height !== Math.round(h * r)) { cv.width = Math.round(w * r); cv.height = Math.round(h * r); }
    if (!S.v.init) { S.v.ox = w / 2; S.v.oy = h / 2; S.v.init = true; if (S.g.a.length) fitView(); }
    else if (lastW) { S.v.ox += (w - lastW) / 2; S.v.oy += (h - lastH) / 2; }
    lastW = w; lastH = h; dirty();
  }
  function fitView() {
    if (!cvw) return; var w = cvw.clientWidth, h = cvw.clientHeight; if (w < 2) return; var g = S.g;
    if (!g.a.length) { S.v.s = 56; S.v.ox = w / 2; S.v.oy = h / 2; dirty(); return; }
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; g.a.forEach(function (a) { x0 = Math.min(x0, a.x); x1 = Math.max(x1, a.x); y0 = Math.min(y0, a.y); y1 = Math.max(y1, a.y); });
    var s = clamp(Math.min((w - 70) / Math.max(x1 - x0, .01), (h - 70) / Math.max(y1 - y0, .01)), 24, 70);
    S.v.s = s; S.v.ox = w / 2 - (x0 + x1) / 2 * s; S.v.oy = h / 2 - (y0 + y1) / 2 * s; dirty();
  }
  function draw() {
    raf2 = 0; if (!alive || !cv || S.view !== '2d') return;
    var w = cvw.clientWidth, h = cvw.clientHeight; if (w < 2) return;
    var r = cv.width / w; ctx.setTransform(r, 0, 0, r, 0, 0); ctx.clearRect(0, 0, w, h);
    var cs = getComputedStyle(wrap), ink = cs.getPropertyValue('--ink').trim() || '#111', ink2 = cs.getPropertyValue('--ink2').trim() || '#666', line = cs.getPropertyValue('--line').trim() || '#ddd', card = cs.getPropertyValue('--card').trim() || '#fff', acc = '#7c5cff';
    var g = S.g, adj = adjOf(g), sf = sfOf(), V = S.v, x, y;
    ctx.fillStyle = line; for (x = ((V.ox % 32) + 32) % 32; x < w; x += 32) for (y = ((V.oy % 32) + 32) % 32; y < h; y += 32) ctx.fillRect(x - 1, y - 1, 2, 2);
    ctx.lineCap = 'round';
    g.b.forEach(function (b, k) {
      var A = toS(g.a[b.i].x, g.a[b.i].y), B = toS(g.a[b.j].x, g.a[b.j].y), dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, sp = 5.5 * sf;
      if (S.sel.b === k) { ctx.strokeStyle = acc; ctx.globalAlpha = .35; ctx.lineWidth = 15 * sf; ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke(); ctx.globalAlpha = 1; }
      ctx.strokeStyle = ink2; ctx.lineWidth = Math.max(2, 3 * sf);
      for (var q = 0; q < b.o; q++) { var off = (q - (b.o - 1) / 2) * sp; ctx.beginPath(); ctx.moveTo(A[0] + nx * off, A[1] + ny * off); ctx.lineTo(B[0] + nx * off, B[1] + ny * off); ctx.stroke(); }
    });
    g.a.forEach(function (a, i) {
      var p = toS(a.x, a.y), R = atomR(a), e = EL[a.s], s = bsum(adj, i), t = targetVal(a.s, s);
      if (S.sel.a === i) { ctx.strokeStyle = acc; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p[0], p[1], R + 6, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = .18; ctx.fillStyle = acc; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(p[0], p[1], R, 0, 6.2832); ctx.fillStyle = e.c; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = t < 0 ? '#ef4444' : ink2; ctx.stroke();
      if (t < 0) { ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p[0], p[1], R + 4, 0, 6.2832); ctx.stroke(); }
      ctx.fillStyle = e.t; ctx.font = '700 ' + (a.s === 'H' ? 12 : 14) * sf + 'px Inter,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(a.s, p[0], p[1] + .5);
      if (t > s) {
        var bx = p[0] + R * .82, by = p[1] - R * .82, br = 8 * Math.max(sf, .8);
        ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.2832); ctx.fillStyle = '#f59e0b'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = card; ctx.stroke();
        ctx.fillStyle = '#1f1300'; ctx.font = '800 ' + 10 * Math.max(sf, .8) + 'px Inter,system-ui,sans-serif'; ctx.fillText('+' + (t - s), bx, by + .5);
      }
    });
  }
  function atomAt(px, py) {
    var g = S.g; for (var i = g.a.length - 1; i >= 0; i--) { var p = toS(g.a[i].x, g.a[i].y); if (Math.hypot(p[0] - px, p[1] - py) <= atomR(g.a[i]) + 5) return i; } return -1;
  }
  function bondAt(px, py) {
    var g = S.g, best = -1, bd = 9;
    g.b.forEach(function (b, k) {
      var A = toS(g.a[b.i].x, g.a[b.i].y), B = toS(g.a[b.j].x, g.a[b.j].y), dx = B[0] - A[0], dy = B[1] - A[1], l2 = dx * dx + dy * dy || 1, t = clamp(((px - A[0]) * dx + (py - A[1]) * dy) / l2, 0, 1), d = Math.hypot(px - (A[0] + dx * t), py - (A[1] + dy * t));
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }
  var ptOf = function (e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function onCvDown(e) {
    if (e.button > 0) return; var p = ptOf(e); try { cv.setPointerCapture(e.pointerId); } catch (x) { }
    ptrs[e.pointerId] = { x: p[0], y: p[1] };
    var ids = Object.keys(ptrs);
    if (ids.length === 2) {
      var a = ptrs[ids[0]], b = ptrs[ids[1]], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, w = toW(mx, my);
      pin = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: S.v.s, w: w }; gest = null; return;
    }
    var ha = atomAt(p[0], p[1]), hb = ha < 0 ? bondAt(p[0], p[1]) : -1, w0 = toW(p[0], p[1]);
    gest = { id: e.pointerId, x0: p[0], y0: p[1], ha: ha, hb: hb, moved: false, ox: S.v.ox, oy: S.v.oy, dx: ha >= 0 ? S.g.a[ha].x - w0[0] : 0, dy: ha >= 0 ? S.g.a[ha].y - w0[1] : 0, pushed: false };
  }
  function onCvMove(e) {
    var p = ptOf(e); if (ptrs[e.pointerId]) { ptrs[e.pointerId].x = p[0]; ptrs[e.pointerId].y = p[1]; }
    if (pin) {
      var ids = Object.keys(ptrs); if (ids.length < 2) return; var a = ptrs[ids[0]], b = ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      S.v.s = clamp(pin.s * d / pin.d, 18, 120); S.v.ox = mx - pin.w[0] * S.v.s; S.v.oy = my - pin.w[1] * S.v.s; dirty(); return;
    }
    if (!gest || e.pointerId !== gest.id) return;
    var d2 = Math.hypot(p[0] - gest.x0, p[1] - gest.y0);
    if (!gest.moved && d2 > 5) gest.moved = true; if (!gest.moved) return;
    if (gest.ha >= 0) {
      if (!gest.pushed) { pushHist(); gest.pushed = true; }
      var w = toW(p[0], p[1]); S.g.a[gest.ha].x = w[0] + gest.dx; S.g.a[gest.ha].y = w[1] + gest.dy; dirty();
    } else { S.v.ox = gest.ox + p[0] - gest.x0; S.v.oy = gest.oy + p[1] - gest.y0; dirty(); }
  }
  function onCvUp(e) {
    var p = ptOf(e); delete ptrs[e.pointerId]; if (pin) { if (Object.keys(ptrs).length < 2) pin = null; return; }
    if (!gest || e.pointerId !== gest.id) return; var gs = gest; gest = null;
    if (gs.moved) { if (gs.ha >= 0) changed(false); return; }
    tap(gs.ha, gs.hb, p);
  }
  function onCvCancel(e) { delete ptrs[e.pointerId]; if (gest && gest.id === e.pointerId) gest = null; if (Object.keys(ptrs).length < 2) pin = null; }
  function tap(ha, hb, p) {
    var g = S.g;
    if (ha >= 0) {
      if (S.sel.a >= 0 && S.sel.a !== ha) { if (bondAtoms(S.sel.a, ha)) { S.sel = { a: ha, b: -1 }; } }
      else if (S.sel.a === ha) S.sel = { a: -1, b: -1 };
      else S.sel = { a: ha, b: -1 };
      dirty(); setInfo(selInfoHtml()); return;
    }
    if (hb >= 0) {
      if (S.sel.b === hb) cycleBond(hb); else { S.sel = { a: -1, b: hb }; dirty(); setInfo(selInfoHtml()); }
      return;
    }
    var w = toW(p[0], p[1]); placeAt(w[0], w[1]);
  }
  function onWheel(e) {
    e.preventDefault(); var p = ptOf(e), w = toW(p[0], p[1]); S.v.s = clamp(S.v.s * Math.exp(-e.deltaY * .0015), 18, 120); S.v.ox = p[0] - w[0] * S.v.s; S.v.oy = p[1] - w[1] * S.v.s; dirty();
  }

  /* ================= 3D view (Three.js, loaded on first use) ================= */
  var threeP = null, rd = null, sc3 = null, cam = null, grp = null, gS = null, gC = null, d3 = null, mats = {}, lpMat = null, haloMesh = null, raf3 = 0, zoom = 1, need = true, spinning = false, qT = null, ray = null, pt3 = {}, drag3 = null, pin3 = null, ro3 = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(); if (threeP) return threeP;
    threeP = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = THREE_URL; s.async = true;
      s.onload = function () { if (window.THREE) res(); else { threeP = null; rej(new Error('three')); } };
      s.onerror = function () { threeP = null; rej(new Error('load')); };
      document.head.appendChild(s);
    });
    return threeP;
  }
  function msg3(t) { var m = $('#mc3m'); if (!m) return; m.innerHTML = t || ''; m.hidden = !t; }
  function matFor(s) { var T = window.THREE; if (!mats[s]) mats[s] = new T.MeshPhongMaterial({ color: new T.Color(EL[s].c), shininess: 55, specular: 0x333333 }); return mats[s]; }
  function setup3() {
    var T = window.THREE; if (rd || !alive) return;
    try { rd = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); }
    catch (e) { rd = null; msg3('3D needs WebGL, and this browser or device does not have it available. The 2D builder and all the properties still work.'); return; }
    rd.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); rd.domElement.className = 'mc-3c'; host3.insertBefore(rd.domElement, host3.firstChild);
    sc3 = new T.Scene(); cam = new T.PerspectiveCamera(38, 1, .1, 200);
    sc3.add(new T.AmbientLight(0xffffff, .72)); var d1 = new T.DirectionalLight(0xffffff, .85); d1.position.set(3, 4, 6); sc3.add(d1); var d2 = new T.DirectionalLight(0xffffff, .25); d2.position.set(-4, -2, -3); sc3.add(d2);
    grp = new T.Group(); sc3.add(grp); gS = new T.SphereGeometry(1, 28, 20); gC = new T.CylinderGeometry(1, 1, 1, 14, 1, false);
    lpMat = new T.MeshPhongMaterial({ color: 0xfde68a, transparent: true, opacity: .6, shininess: 30 });
    haloMesh = new T.Mesh(gS, new T.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: .32, depthWrite: false })); haloMesh.visible = false;
    qT = new T.Quaternion(); ray = new T.Raycaster();
    var c = rd.domElement; c.addEventListener('pointerdown', on3Down); c.addEventListener('pointermove', on3Move); c.addEventListener('pointerup', on3Up); c.addEventListener('pointercancel', on3Cancel); c.addEventListener('wheel', on3Wheel, { passive: false });
    ro3 = new ResizeObserver(fit3); ro3.observe(host3); fit3();
  }
  function fit3() {
    if (!rd || !host3) return; var w = host3.clientWidth, h = host3.clientHeight; if (w < 2 || h < 2) return;
    rd.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); camPlace(); wake();
  }
  function camPlace() {
    if (!cam) return; var R = 1.5;
    if (d3) d3.G.a.forEach(function (a, i) { var p = d3.rx.P[i]; R = Math.max(R, Math.hypot(p[0], p[1], p[2]) + EL[a.s].rv * .6); });
    var fov = cam.fov * Math.PI / 180, eff = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * cam.aspect));
    cam.position.set(0, 0, R * 1.3 / Math.tan(eff / 2) * zoom); cam.lookAt(0, 0, 0);
  }
  function rad3(s) { return S.mode === 'space' ? EL[s].rv * .95 : S.mode === 'stick' ? .12 : Math.max(.2, EL[s].rc * .55); }
  function rebuild3() {
    if (!rd || !alive) return; var T = window.THREE, G = S.g, i;
    while (grp.children.length) grp.remove(grp.children[0]);
    if (!G.a.length) { d3 = null; msg3('Build a molecule in the 2D Builder first, then come back to spin it around here.'); wake(); return; }
    msg3('');
    var rx = relax(G), adj = adjOf(G);
    d3 = { G: G, adj: adj, rx: rx, cur: rx.seed.map(function (p) { return p.slice(); }), a: [], b: [], l: [], t0: performance.now(), sel: -1 };
    G.a.forEach(function (a, k) { var m = new T.Mesh(gS, matFor(a.s)); m.userData.i = k; grp.add(m); d3.a.push(m); });
    G.b.forEach(function (b, k) { for (var l = 0; l < b.o; l++) for (var h = 0; h < 2; h++) { var m = new T.Mesh(gC, matFor(G.a[h ? b.j : b.i].s)); grp.add(m); d3.b.push({ m: m, k: k, l: l, h: h, c: b.o }); } });
    rx.LP.forEach(function (q) { var m = new T.Mesh(gS, lpMat); grp.add(m); d3.l.push({ m: m, o: q.o, p: q.p }); });
    grp.add(haloMesh); haloMesh.visible = false;
    grp.quaternion.setFromEuler(new T.Euler(-.3, .45, 0));
    zoom = 1; camPlace(); layout3(calm() ? 1 : 0); need = true; wake();
  }
  function layout3(t) {
    if (!d3) return; var T = window.THREE, e = t >= 1 ? 1 : 1 - Math.pow(1 - t, 3), G = d3.G, rx = d3.rx, i;
    for (i = 0; i < G.a.length; i++) {
      var s = rx.seed[i], p = rx.P[i], c = d3.cur[i]; c[0] = s[0] + (p[0] - s[0]) * e; c[1] = s[1] + (p[1] - s[1]) * e; c[2] = s[2] + (p[2] - s[2]) * e;
      var r = rad3(G.a[i].s), m = d3.a[i]; m.position.set(c[0], c[1], c[2]); m.scale.set(r, r, r);
    }
    var U = [], PR = [], br = S.mode === 'stick' ? .12 : .085, sep = S.mode === 'stick' ? .24 : .17;
    G.b.forEach(function (b, k) {
      var A = d3.cur[b.i], B = d3.cur[b.j], ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], l = Math.hypot(ux, uy, uz) || 1e-6; ux /= l; uy /= l; uz /= l; U[k] = [ux, uy, uz];
      var cand = [], pv = null;
      d3.adj[b.i].forEach(function (q) { if (q.j !== b.j) cand.push([q.j, b.i]); }); d3.adj[b.j].forEach(function (q) { if (q.j !== b.i) cand.push([q.j, b.j]); });
      for (var z = 0; z < cand.length && !pv; z++) {
        var C = d3.cur[cand[z][0]], O = d3.cur[cand[z][1]], vx = C[0] - O[0], vy = C[1] - O[1], vz = C[2] - O[2], dd = vx * ux + vy * uy + vz * uz; vx -= ux * dd; vy -= uy * dd; vz -= uz * dd;
        var vl = Math.hypot(vx, vy, vz); if (vl > .25) pv = [vx / vl, vy / vl, vz / vl];
      }
      if (!pv) { var rx0 = Math.abs(uy) < .9 ? [0, 1, 0] : [1, 0, 0], cx = uy * rx0[2] - uz * rx0[1], cy = uz * rx0[0] - ux * rx0[2], cz = ux * rx0[1] - uy * rx0[0], cl = Math.hypot(cx, cy, cz) || 1; pv = [cx / cl, cy / cl, cz / cl]; }
      PR[k] = pv;
    });
    var Yv = new T.Vector3(0, 1, 0), dv = new T.Vector3();
    d3.b.forEach(function (q) {
      var b = G.b[q.k], A = d3.cur[b.i], B = d3.cur[b.j], pv = PR[q.k], off = (q.l - (q.c - 1) / 2) * sep, rr = q.c > 1 ? br * .78 : br;
      var a0 = [A[0] + pv[0] * off, A[1] + pv[1] * off, A[2] + pv[2] * off], b0 = [B[0] + pv[0] * off, B[1] + pv[1] * off, B[2] + pv[2] * off], mid = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2, (a0[2] + b0[2]) / 2];
      var f = q.h ? mid : a0, to = q.h ? b0 : mid, dx = to[0] - f[0], dy = to[1] - f[1], dz = to[2] - f[2], len = Math.hypot(dx, dy, dz);
      q.m.visible = S.mode !== 'space' && len > 1e-5; if (!q.m.visible) return;
      q.m.position.set((f[0] + to[0]) / 2, (f[1] + to[1]) / 2, (f[2] + to[2]) / 2); q.m.scale.set(rr, len, rr); dv.set(dx / len, dy / len, dz / len); q.m.quaternion.setFromUnitVectors(Yv, dv);
    });
    d3.l.forEach(function (q) {
      var O = rx.P[q.o], co = d3.cur[q.o], rx1 = q.p[0] - O[0], ry1 = q.p[1] - O[1], rz1 = q.p[2] - O[2], l = Math.hypot(rx1, ry1, rz1) || 1;
      q.m.visible = S.lps && S.mode !== 'space'; q.m.position.set(co[0] + rx1 * e, co[1] + ry1 * e, co[2] + rz1 * e); q.m.scale.set(.2, .34, .2); dv.set(rx1 / l, ry1 / l, rz1 / l); q.m.quaternion.setFromUnitVectors(Yv, dv);
    });
    if (d3.sel >= 0) { var cs = d3.cur[d3.sel], rh = rad3(G.a[d3.sel].s) + .13; haloMesh.visible = true; haloMesh.position.set(cs[0], cs[1], cs[2]); haloMesh.scale.set(rh, rh, rh); } else haloMesh.visible = false;
  }
  function wake() { if (!raf3 && alive && S.view === '3d' && rd) raf3 = requestAnimationFrame(loop3); }
  function loop3() {
    raf3 = 0; if (!alive || S.view !== '3d' || !rd) return;
    var animating = false;
    if (d3) {
      var t = (performance.now() - d3.t0) / 750; if (t < 1 && !calm()) { animating = true; layout3(t); } else if (d3.t0) { d3.t0 = 0; layout3(1); need = true; }
      if (spinning === false && S.auto && !calm() && !drag3 && !pin3) { qT.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .006); grp.quaternion.premultiply(qT); need = true; }
    }
    rd.render(sc3, cam); need = false;
    if (animating || (S.auto && !calm() && d3) || need) raf3 = requestAnimationFrame(loop3);
  }
  function on3Down(e) {
    pt3[e.pointerId] = { x: e.clientX, y: e.clientY }; try { rd.domElement.setPointerCapture(e.pointerId); } catch (x) { }
    var ids = Object.keys(pt3);
    if (ids.length === 2) { var a = pt3[ids[0]], b = pt3[ids[1]]; pin3 = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom }; drag3 = null; return; }
    drag3 = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false };
  }
  function on3Move(e) {
    if (!pt3[e.pointerId]) return; pt3[e.pointerId].x = e.clientX; pt3[e.pointerId].y = e.clientY;
    if (pin3) { var ids = Object.keys(pt3); if (ids.length < 2) return; var a = pt3[ids[0]], b = pt3[ids[1]]; zoom = clamp(pin3.z * pin3.d / (Math.hypot(a.x - b.x, a.y - b.y) || 1), .35, 2.5); camPlace(); need = true; wake(); return; }
    if (!drag3 || e.pointerId !== drag3.id) return;
    if (!drag3.moved && Math.hypot(e.clientX - drag3.x0, e.clientY - drag3.y0) > 4) drag3.moved = true; if (!drag3.moved) return;
    var T = window.THREE, dx = e.clientX - drag3.x, dy = e.clientY - drag3.y; drag3.x = e.clientX; drag3.y = e.clientY;
    qT.setFromAxisAngle(new T.Vector3(0, 1, 0), dx * .01); grp.quaternion.premultiply(qT); qT.setFromAxisAngle(new T.Vector3(1, 0, 0), dy * .01); grp.quaternion.premultiply(qT); need = true; wake();
  }
  function on3Up(e) {
    delete pt3[e.pointerId]; if (pin3) { if (Object.keys(pt3).length < 2) pin3 = null; return; }
    if (!drag3 || e.pointerId !== drag3.id) return; var d = drag3; drag3 = null; if (d.moved) { wake(); return; }
    pick3(e);
  }
  function on3Cancel(e) { delete pt3[e.pointerId]; if (drag3 && drag3.id === e.pointerId) drag3 = null; if (Object.keys(pt3).length < 2) pin3 = null; }
  function on3Wheel(e) { e.preventDefault(); zoom = clamp(zoom * Math.exp(e.deltaY * .0012), .35, 2.5); camPlace(); need = true; wake(); }
  function pick3(e) {
    if (!d3) return; var r = rd.domElement.getBoundingClientRect(); ray.setFromCamera({ x: (e.clientX - r.left) / r.width * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, cam);
    var hit = ray.intersectObjects(d3.a, false); d3.sel = hit.length ? hit[0].object.userData.i : -1;
    setInfo(d3.sel >= 0 ? atomInfoHtml(d3.G, d3.adj, d3.sel) : '3D view: drag to rotate, scroll or pinch to zoom, tap an atom to inspect it.'); layout3(1); need = true; wake();
  }
  function dispose3() {
    if (raf3) cancelAnimationFrame(raf3); raf3 = 0; if (ro3) { ro3.disconnect(); ro3 = null; }
    if (rd) {
      try { Object.keys(mats).forEach(function (k) { mats[k].dispose(); }); if (gS) gS.dispose(); if (gC) gC.dispose(); if (lpMat) lpMat.dispose(); if (haloMesh) haloMesh.material.dispose(); rd.dispose(); if (rd.forceContextLoss) rd.forceContextLoss(); } catch (e) { }
      if (rd.domElement && rd.domElement.parentNode) rd.domElement.parentNode.removeChild(rd.domElement);
    }
    rd = sc3 = cam = grp = gS = gC = d3 = lpMat = haloMesh = qT = ray = null; mats = {}; pt3 = {}; drag3 = pin3 = null;
  }

  /* ================= view switching, buttons, book overlay ================= */
  function setView(v) {
    if (v === S.view && v === '2d') return; S.view = v; var is3 = v === '3d';
    $('#mcv2').hidden = is3; $('#mcv3w').hidden = !is3; var seg = wrap.querySelectorAll('.mc-seg button'); seg.forEach(function (b) { b.classList.toggle('on', b.dataset.mc === 'v' + (is3 ? '3' : '2')); b.setAttribute('aria-pressed', b.dataset.mc === 'v' + (is3 ? '3' : '2')); });
    if (!is3) { if (raf3) { cancelAnimationFrame(raf3); raf3 = 0; } setInfo(selInfoHtml()); requestAnimationFrame(function () { sizeCv(); fitView(); }); return; }
    setInfo('3D view: drag to rotate, scroll or pinch to zoom, tap an atom to inspect it.');
    if (rd) { rebuild3(); fit3(); return; }
    msg3('Loading 3D...');
    loadThree().then(function () { if (!alive || S.view !== '3d') return; setup3(); if (rd) { msg3(''); rebuild3(); fit3(); } }).catch(function () { msg3('Could not load the 3D engine. Check your connection and <button type="button" class="lb-st" data-mc="retry3">try again</button>.'); });
  }
  function palHtml() {
    return PAL.map(function (s) { var e = EL[s]; return '<button type="button" class="mc-pa' + (S.el === s ? ' on' : '') + '" data-mcp="' + s + '" style="--c:' + e.c + ';--t:' + e.t + '" aria-label="' + esc(e.n) + ', ' + maxVal(s) + (maxVal(s) === 1 ? ' bond' : ' bonds') + '" aria-pressed="' + (S.el === s) + '"><i>' + s + '</i><small>' + maxVal(s) + '</small></button>'; }).join('');
  }
  function updateBits() {
    var emp = $('#mcempty'); if (emp) emp.hidden = S.g.a.length > 0;
    var u = $('[data-mc="undo"]'); if (u) u.disabled = !S.hist.length;
    var d = $('[data-mc="del"]'); if (d) d.disabled = S.sel.a < 0 && S.sel.b < 0;
    var c = $('[data-mc="clear"]'); if (c) c.disabled = !S.g.a.length;
    var pa = $('#mcpal'); if (pa) pa.querySelectorAll('.mc-pa').forEach(function (b) { b.classList.toggle('on', b.dataset.mcp === S.el); b.setAttribute('aria-pressed', b.dataset.mcp === S.el); });
  }
  function bookHtml() {
    var b = loadBook(), h = '<header><b>Molecule Book</b><button type="button" class="lb-x" data-mc="bookx" aria-label="Close">' + ic('x', 17) + '</button></header>';
    if (!b.length) return h + '<div class="lb-be">' + ic('book', 28) + '<b>Nothing yet</b><span>Molecules you build are saved here. Try building water: one oxygen and two hydrogens.</span></div>';
    return h + '<p class="lb-bc">' + b.length + (b.length === 1 ? ' molecule' : ' molecules') + ' on this device. Tap one to open it.</p><div class="lb-bg">' + b.map(function (x, i) {
      return '<button type="button" class="lb-be2" data-mcbk="' + i + '"><b>' + esc(x.f) + '</b><span>' + esc(x.n) + '</span>' + (x.st ? '<small class="' + esc(x.st) + '">' + esc(x.st) + '</small>' : '<small>custom</small>') + '</button>';
    }).join('') + '</div>';
  }
  function openBook() { closeBook(); wrap.insertAdjacentHTML('beforeend', '<div class="lb-ov" id="mcov"><div class="lb-sh" role="dialog" aria-modal="true">' + bookHtml() + '</div></div>'); var x = $('#mcov .lb-x'); if (x) x.focus({ preventScroll: true }); }
  function closeBook() { var o = $('#mcov'); if (o) o.remove(); }
  function noteText() {
    var R = S.an; if (!R || !R.complete) return null;
    return { text: (R.name || 'Custom molecule') + ' (' + R.formula + ')\n\nMolar mass: ' + R.mass.toFixed(2) + ' g/mol\nAtoms: ' + R.atoms + ', bonds: ' + R.bonds + '\nShape: ' + (R.geo.length ? R.geo.map(function (g) { return g.s + ' ' + g.n.toLowerCase(); }).join('; ') : 'linear') + '\nPolarity: ' + (R.pol.polar ? 'polar' : 'nonpolar') + (R.hit ? '\n\n' + R.hit.t : ''), question: 'What is the structure of ' + (R.name || R.formula) + '?', subject: 'General Sciences', msg: ('mol:' + R.key).slice(0, 60) };
  }
  function onClick(e) {
    var t = e.target;
    if (t.id === 'mcov') { closeBook(); return; }
    var pa = t.closest('[data-mcp]'); if (pa) { S.el = pa.dataset.mcp; updateBits(); if (S.sel.a >= 0) setInfo(selInfoHtml()); return; }
    var ex = t.closest('[data-mcx]'); if (ex) { loadSmi(EXAMPLES[+ex.dataset.mcx]); return; }
    var bk = t.closest('[data-mcbk]'); if (bk) { var it = loadBook()[+bk.dataset.mcbk], G = it && it.g && unpackG(it.g); if (G) { closeBook(); if (S.view === '3d') setView('2d'); loadGraph(G); } else toast('That molecule could not be opened.'); return; }
    var ms = t.closest('[data-mcs]'); if (ms) { S.mode = ms.dataset.mcs; wrap.querySelectorAll('[data-mcs]').forEach(function (b) { b.classList.toggle('on', b.dataset.mcs === S.mode); }); layout3(1); need = true; wake(); return; }
    var mt = t.closest('[data-mct]'); if (mt) { var k = mt.dataset.mct; S[k] = !S[k]; mt.classList.toggle('on', !!S[k]); mt.setAttribute('aria-pressed', !!S[k]); layout3(1); need = true; wake(); return; }
    var a = t.closest('[data-mc]'); if (!a) return;
    switch (a.dataset.mc) {
      case 'v2': setView('2d'); break;
      case 'v3': setView('3d'); break;
      case 'retry3': setView('3d'); break;
      case 'undo': undo(); break;
      case 'del': del(); break;
      case 'fillh': fillH(); break;
      case 'fit': fitView(); break;
      case 'clear': clearAll(); break;
      case 'book': openBook(); break;
      case 'bookx': closeBook(); break;
      case 'save': { var R = S.an; if (!R || !R.complete) { toast('Finish the molecule first.'); break; } toast(bookAdd(R, S.g, !R.hit) ? 'Saved to your Molecule Book' : 'Already in your Molecule Book'); var bn = $('#mcbn'); if (bn) bn.textContent = loadBook().length; break; }
      case 'note': { var n = noteText(); if (n && opts.onNote) opts.onNote(n); break; }
      case 'ask': { var R2 = S.an; if (R2 && R2.complete && opts.onAsk) opts.onAsk('Explain the structure of ' + (R2.name || 'this molecule') + ' (' + R2.formula + '): its bonds, its shape (VSEPR) and whether it is polar, step by step.'); break; }
    }
  }
  function shell() {
    return '<div class="lb-wrap mc"><header class="lb-hd"><button type="button" class="lb-bk2" data-a="hub" aria-label="Back to Lab">' + ic('back', 18) + '<span>Lab</span></button><div class="lb-tt"><h2>Molecular Constructor</h2></div>' +
      '<button type="button" class="lb-bk" data-mc="book">' + ic('book') + '<span>Molecule Book</span><em id="mcbn">' + loadBook().length + '</em></button></header>' +
      '<div class="lb-info mc-info" id="mcinfo" aria-live="polite"></div>' +
      '<div class="mc-grid"><div class="mc-stage"><div class="mc-bar"><div class="mc-seg" role="group" aria-label="View"><button type="button" class="on" data-mc="v2" aria-pressed="true">' + ic('pen', 15) + '<span>2D Builder</span></button><button type="button" data-mc="v3" aria-pressed="false">' + ic('cube', 15) + '<span>3D View</span></button></div></div>' +
      '<div id="mcv2"><div class="mc-pal" id="mcpal" role="group" aria-label="Atoms">' + palHtml() + '</div>' +
      '<div class="mc-cvw" id="mccvw"><canvas id="mccv" role="img" aria-label="Molecule builder canvas"></canvas><div class="mc-empty" id="mcempty"><b>Pick an atom, then tap here</b><span>Try carbon: tap the canvas, then tap again to grow a bonded chain.</span></div></div>' +
      '<div class="mc-tools"><button type="button" class="lb-clr" data-mc="undo">' + ic('undo', 15) + '<span>Undo</span></button><button type="button" class="lb-clr" data-mc="del">' + ic('trash', 15) + '<span>Delete</span></button><button type="button" class="lb-clr" data-mc="fillh">' + ic('hplus', 15) + '<span>Fill with H</span></button><button type="button" class="lb-clr" data-mc="fit">' + ic('fit', 15) + '<span>Fit</span></button><button type="button" class="lb-clr" data-mc="clear">' + ic('x', 15) + '<span>Clear</span></button></div></div>' +
      '<div id="mcv3w" hidden><div class="mc-v3t"><button type="button" class="lb-st on" data-mcs="ball">Ball and stick</button><button type="button" class="lb-st" data-mcs="space">Space-filling</button><button type="button" class="lb-st" data-mcs="stick">Sticks</button><span class="mc-sp"></span>' +
      '<button type="button" class="lb-st' + (S.lps ? ' on' : '') + '" data-mct="lps" aria-pressed="' + S.lps + '">Lone pairs</button><button type="button" class="lb-st' + (S.auto ? ' on' : '') + '" data-mct="auto" aria-pressed="' + S.auto + '">Spin</button></div>' +
      '<div class="mc-3h" id="mc3d"><div class="mc-3m" id="mc3m" hidden></div></div></div></div>' +
      '<aside class="mc-panel" id="mcpanel" aria-live="polite"></aside></div>' +
      '<div class="lb-try"><b>Try:</b>' + EXAMPLES.map(function (s, i) { var r = dbMap()[sigOf(parseSmi(s))]; return '<button type="button" class="lb-st" data-mcx="' + i + '">' + esc(r ? r[1].split(' (')[0] : s) + '</button>'; }).join('') + '</div></div>';
  }

  /* ================= mount / unmount ================= */
  function mount(host, o) {
    unmount(); opts = o || {}; alive = true; root = host; S.view = '2d'; S.v.init = false; lastW = lastH = 0; ptrs = {}; gest = pin = null;
    root.innerHTML = shell(); wrap = $('.lb-wrap', root);
    cv = $('#mccv'); cvw = $('#mccvw'); ctx = cv.getContext('2d'); host3 = $('#mc3d');
    wrap.querySelectorAll('[data-mcs]').forEach(function (b) { b.classList.toggle('on', b.dataset.mcs === S.mode); });
    wrap.addEventListener('click', onClick);
    cv.addEventListener('pointerdown', onCvDown); cv.addEventListener('pointermove', onCvMove); cv.addEventListener('pointerup', onCvUp); cv.addEventListener('pointercancel', onCvCancel); cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    ro = new ResizeObserver(sizeCv); ro.observe(cvw);
    mo = new MutationObserver(function () { dirty(); }); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    keyFn = function (e) {
      if (!alive || !wrap) return; var tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA') return;
      if (e.key === 'Escape') { if ($('#mcov')) { closeBook(); e.preventDefault(); } else if (S.sel.a >= 0 || S.sel.b >= 0) { S.sel = { a: -1, b: -1 }; dirty(); updateBits(); setInfo(selInfoHtml()); } }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && S.view === '2d' && !$('#mcov')) { if (S.sel.a >= 0 || S.sel.b >= 0) { del(); e.preventDefault(); } }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && S.view === '2d') { undo(); e.preventDefault(); }
    };
    document.addEventListener('keydown', keyFn);
    setInfo(selInfoHtml()); updateBits(); sizeCv(); refresh();
  }
  function unmount() {
    if (!alive && !root) return; alive = false; clearTimeout(anTimer); if (raf2) cancelAnimationFrame(raf2); raf2 = 0;
    if (ro) { ro.disconnect(); ro = null; } if (mo) { mo.disconnect(); mo = null; } if (keyFn) { document.removeEventListener('keydown', keyFn); keyFn = null; }
    dispose3(); cv = cvw = ctx = host3 = wrap = root = null; S.sel = { a: -1, b: -1 }; S.view = '2d';
  }

  window.SpectraMol = {
    mount: mount, unmount: unmount, loadSmiles: loadSmi,
    _t: { EL: EL, DB: DB, parseSmi: parseSmi, sigOf: sigOf, identify: identify, analyze: analyze, relax: relax, polarity: polarity, layout2D: layout2D, fdisp: fdisp, withH: withH, adjOf: adjOf, geoName: geoName, lpCount: lpCount, dbMap: dbMap, S: S }
  };
})();
