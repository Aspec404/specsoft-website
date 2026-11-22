/* Spectra Physics Sandbox (v3) for the Spectra Academics Lab.
   v3: a whole screen of water without lag (calm water sleeps, only the water near things is simulated), ripples that travel across the surface, deeper-looking water, Ocean scene.
   v2: real particle water (water, oil and lava) that pushes objects and floats them, plus rope, rod, spring, glue, nail, motor,
   fan, magnet, faucet, rain, balloons, TNT, rockets, bomb, bounce pads and more.
   Runs fully in the browser. The rigid-body engine (Matter.js) is loaded from cdnjs the first time you open the sandbox.
   spectra-lab.js mounts it with SpectraPhys.mount(rootElement, { toast, onAsk }) and calls SpectraPhys.unmount() when you leave.
   Styles: spectra-phys.css. */
(function () {
  'use strict';
  var MJS = 'https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js';
  var M = null, loadP = null, S = null, O = {}, uid = 0;
  var STEP = 1000 / 120, MAXO = 140, CB = 1, CR = 4, FMAX = 18000, WAKE = 36;   // collision categories: bodies, rope
  var MP = 0.042, KB = 1.3;   // mass of one water particle (Matter units) and how strongly water pushes on things (tuned so wood floats and steel sinks)
  var TG = [1, 0.3, 1.15], TV = [0.05, 0.4, 0.6];   // per liquid: gravity multiplier (oil is lighter so it floats on water) and thickness
  var LIQ = [
    { id: 'water', n: 'Water', c0: [120, 205, 255], c1: [10, 56, 160], a: 0.84, a0: 0.62, dl: 95, sg: 1, wg: 1, dot: '#38a0ff' },
    { id: 'oil', n: 'Oil', c0: [214, 168, 70], c1: [96, 58, 14], a: 0.92, a0: 0.8, dl: 80, sg: 0.25, wg: 0, dot: '#b9822b' },
    { id: 'lava', n: 'Lava', c0: [255, 226, 110], c1: [200, 38, 8], a: 1, a0: 1, dl: 60, sg: 0, wg: 0, dot: '#ff6a1a' }
  ];

  var ICO = {
    back: 'M15 6l-6 6 6 6', drag: 'M5 3l14 7-6 2-2 6z', box: 'M5 5h14v14H5z', ball: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0', tri: 'M12 4l9 16H3z', plank: 'M2 9h20v6H2z',
    hex: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z', wheel: 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 4v16M4 12h16M6.3 6.3l11.4 11.4M17.7 6.3L6.3 17.7',
    balloon: 'M12 3a6 7 0 016 7c0 4-3 7-6 7s-6-3-6-7a6 7 0 016-7zM12 17l-1.5 3h3zM12 20c0 1-1 1.5-1 2.5', tnt: 'M4 7h16v11H4zM8.5 11.5h7M12 11.5v4',
    rocket: 'M12 3c3 3 4 7 3 12h-6c-1-5 0-9 3-12zM9 15l-3 4 3-1M15 15l3 4-3-1M12 18v3', bomb: 'M10 21a6 6 0 100-12 6 6 0 000 12zM14 9l3-3M17 6h3M18 3v3',
    boom: 'M12 2l2.5 6 6.5.6-5 4.3 1.6 6.3L12 15.6 6.4 19.2 8 12.9 3 8.6l6.5-.6z',
    water: 'M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z', faucet: 'M3 8h9a4 4 0 014 4M3 5h4v6H3zM16 15c0 1.4 1 2 1 3a1 1 0 01-2 0c0-1 1-1.6 1-3z',
    rope: 'M4 4c0 9 16 3 16 16', rod: 'M5 19L19 5M4 18a1.5 1.5 0 103 0a1.5 1.5 0 10-3 0M17 6a1.5 1.5 0 103 0a1.5 1.5 0 10-3 0', spring: 'M3 12h3l2-6 3 12 3-12 2 6h5',
    glue: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1', pin: 'M12 3a3 3 0 100 6 3 3 0 000-6zM12 9v12',
    motor: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
    platform: 'M3 16l18-6v5L3 21z', pad: 'M3 20h18M6 20l2-5h8l2 5M9 15l-1-3h8l-1 3',
    fan: 'M12 11a1 1 0 100 2 1 1 0 000-2zM12 10.5c0-4 4-5 5-3s-2 3-5 3zM13.5 12c4 0 5 4 3 5s-3-2-3-5zM12 13.5c0 4-4 5-5 3s2-3 5-3zM10.5 12c-4 0-5-4-3-5s3 2 3 5z',
    magnet: 'M6 4v9a6 6 0 0012 0V4h-4v9a2 2 0 01-4 0V4zM6 8h4M14 8h4', erase: 'M4 17l9-11 7 6-6 8H8zM8 20h12',
    pause: 'M8 5v14M16 5v14', play: 'M8 5v14l11-7z', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', chat: 'M4 5h16v11H9l-5 4z',
    rain: 'M7 14a4 4 0 112-7.5A5 5 0 1118 14zM8 17l-1 3M12 17l-1 3M16 17l-1 3', drain: 'M12 4v10M8 11l4 4 4-4M5 19h14'
  };
  var ic = function (n, s) { return '<svg viewBox="0 0 24 24" width="' + (s || 18) + '" height="' + (s || 18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICO[n] + '"/></svg>'; };

  /* density is in Matter units: water is 0.001, so anything lighter floats and anything heavier sinks */
  var MATS = [
    { id: 'wood', n: 'Wood', d: 0.0007, r: 0.2, f: 0.6, c: '#c68b59' }, { id: 'steel', n: 'Steel', d: 0.008, r: 0.1, f: 0.3, c: '#8b98a8' },
    { id: 'rubber', n: 'Rubber', d: 0.0012, r: 0.85, f: 0.9, c: '#ef4444' }, { id: 'ice', n: 'Ice', d: 0.0009, r: 0.1, f: 0.02, c: '#8fd8ff' },
    { id: 'foam', n: 'Foam', d: 0.0002, r: 0.3, f: 0.5, c: '#fbbf24' }
  ];
  var MAT = {}; MATS.forEach(function (m) { MAT[m.id] = m; });
  var GRAV = [['Earth', 1], ['Moon', 0.165], ['Mars', 0.38], ['Jupiter', 2.5], ['Zero-G', 0], ['Upside down', -1]];
  var BAL = ['#ef4444', '#3b82f6', '#ec4899', '#facc15', '#22c55e', '#a855f7'];
  var GROUPS = [
    [['drag', 'Grab', 'Drag anything to move or throw it. A fast fling gives it more kinetic energy.']],
    [['box', 'Box', 'Tap to drop a box. Pick a material: density decides what floats and what sinks.'], ['ball', 'Ball', 'Tap to drop a ball. Rubber bounces, steel does not. That is the coefficient of restitution.'],
    ['tri', 'Triangle', 'Tap to drop a triangle.'], ['hex', 'Hexagon', 'Tap to drop a hexagon.'], ['plank', 'Plank', 'Tap to drop a long plank. Great for seesaws, boats and bridges.'],
    ['wheel', 'Wheel', 'Tap to drop a wheel. Nail it to the wall or add a Motor and it spins.']],
    [['balloon', 'Balloon', 'Tap to release a balloon. It is lighter than air, so it floats up. Tie a few to a box with rope and lift it.'],
    ['tnt', 'TNT', 'Tap to place a TNT crate. It blows up if a blast reaches it or it hits something hard. A fall from high up is enough.'],
    ['rocket', 'Rocket', 'Tap to place a rocket. It lights after half a second and pushes forward for a few seconds: thrust. Tilt it by dropping it on a ramp.'],
    ['bomb', 'Bomb', 'Tap to place a bomb. It explodes after 2 seconds. The blast pushes things away, harder when they are closer, and lighter things fly further.']],
    [['water', 'Liquid', 'Hold and drag to pour. Pick Water, Oil or Lava below. Wood, ice and foam float on water, steel sinks. Oil floats on water. Lava burns wood and melts ice.'],
    ['faucet', 'Faucet', 'Tap to place a faucet that keeps pouring the chosen liquid. Put a wheel under it, or fill a pool.']],
    [['rope', 'Rope', 'Drag to draw a rope. Each end attaches to whatever object it touches, or to the wall. Pull on it and you feel tension.'], ['rod', 'Rod', 'Drag to add a rigid rod between two things (or a thing and the wall).'],
    ['spring', 'Spring', 'Drag to add a spring. The pull grows with the stretch (Hooke\u2019s law, F = k x).'], ['glue', 'Glue', 'Drag from one object to another to glue them together into one rigid piece.'],
    ['pin', 'Nail', 'Tap an object to nail it to the wall. It will swing around the nail like a pendulum.'], ['motor', 'Motor', 'Tap an object to nail it at its center and spin it. Tap again to reverse, once more to stop.']],
    [['platform', 'Ramp', 'Drag to build a fixed ramp or platform from the chosen material. Ice is slippery, rubber grips.'], ['pad', 'Bounce pad', 'Drag to build a bouncy pad. Things leave it faster than they hit it.']],
    [['fan', 'Fan', 'Drag to place a fan and aim it. It blows objects and liquids along the wind. Lighter things get pushed more.'], ['magnet', 'Magnet', 'Hold it near steel things to pull them toward you.'],
    ['boom', 'Boom', 'Tap anywhere for an instant explosion.']],
    [['erase', 'Erase', 'Tap things (or drag across them) to delete them. Tap a rope, rod, spring, fan or faucet to remove it.']]
  ];
  var INFO = {}; GROUPS.forEach(function (g) { g.forEach(function (t) { INFO[t[0]] = t; }); });
  var FLAM = { wood: 1, foam: 1, rubber: 1 };

  var calm = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var toast = function (t) { if (O.toast) O.toast(t); };
  var $ = function (q) { return S && S.root ? S.root.querySelector(q) : null; };
  var rnd = Math.random;

  function loadM() {
    if (window.Matter) { M = window.Matter; return Promise.resolve(M); }
    if (loadP) return loadP;
    loadP = new Promise(function (ok, no) {
      var el = document.createElement('script'); el.src = MJS;
      el.onload = function () { if (window.Matter) { M = window.Matter; ok(M); } else { loadP = null; no(new Error('no Matter')); } };
      el.onerror = function () { loadP = null; no(new Error('load')); };
      document.head.appendChild(el);
    });
    return loadP;
  }

  /* ---- the liquid: a particle fluid (double density relaxation) that pushes on, and is pushed by, the rigid bodies.
     Particles that sit still for a moment fall asleep (they stop costing anything but still push back on awake neighbours), and wake when something disturbs them. ---- */
  function Fluid(max) {
    var i, j;
    this.max = max; this.n = 0; this.h = 14; this.d = 7; this.cell = 14;
    this.x = new Float32Array(max); this.y = new Float32Array(max); this.vx = new Float32Array(max); this.vy = new Float32Array(max);
    this.ox = new Float32Array(max); this.oy = new Float32Array(max); this.ax = new Float32Array(max); this.ay = new Float32Array(max);
    this.rho = new Float32Array(max); this.rn = new Float32Array(max); this.t = new Uint8Array(max); this.nc = new Uint8Array(max);
    this.order = new Int32Array(max); this.cs = new Int32Array(8); this.cur = new Int32Array(8); this.gw = 1; this.gh = 1;
    this.sl = new Uint8Array(max); this.cm = new Uint8Array(max); this.s2 = new Float32Array(max); this.act = new Int32Array(max); this.wl = new Int32Array(max); this.gen = new Uint8Array(max);
    this.na = 0; this.gn = -1; this.G = 6; this.vs = 12; this.vw = 150; this.sN = 40;   // sleep when slower than vs (px/s) for sN steps; a neighbour faster than vw wakes it
    this.ks = 0.04; this.kn = 0.5; this.vis = 0.05; this.damp = 0.996; this.rho0 = 0;
    var r0 = 0;
    for (j = -5; j <= 5; j++) for (i = -5; i <= 5; i++) { if (!i && !j) continue; var px = (i + (j & 1 ? 0.5 : 0)) * this.d, py = j * this.d * 0.866, q = Math.hypot(px, py) / this.h; if (q < 1) r0 += (1 - q) * (1 - q); }
    this.rho0 = r0;
  }
  Fluid.prototype.add = function (x, y, vx, vy, t, asleep) {
    if (this.n >= this.max) return -1; var i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx || 0; this.vy[i] = vy || 0; this.t[i] = t || 0; this.sl[i] = asleep ? 1 : 0; this.cm[i] = 0; this.gen[i] = 0; this.nc[i] = asleep ? 12 : 0; this.s2[i] = 0; return i;
  };
  Fluid.prototype.clear = function () { this.n = 0; this.na = 0; this.gn = -1; };
  Fluid.prototype.wakeAll = function () { for (var i = 0; i < this.n; i++) { this.sl[i] = 0; this.cm[i] = 0; this.gen[i] = 0; } };
  Fluid.prototype.grid = function (W, H) {
    var n = this.n, c = this.cell, gw = Math.ceil(W / c) + 3, gh = Math.ceil(H / c) + 3, size = gw * gh, i, k, cx, cy, ci;
    this.gw = gw; this.gh = gh;
    if (this.cs.length < size + 2) { this.cs = new Int32Array(size + 2); this.cur = new Int32Array(size + 2); }
    var cs = this.cs, cur = this.cur, x = this.x, y = this.y, order = this.order;
    for (k = 0; k <= size; k++) cs[k] = 0;
    for (i = 0; i < n; i++) { cx = (x[i] / c | 0) + 1; cy = (y[i] / c | 0) + 1; cx = cx < 0 ? 0 : cx >= gw ? gw - 1 : cx; cy = cy < 0 ? 0 : cy >= gh ? gh - 1 : cy; ci = cx + cy * gw; order[i] = ci; cs[ci + 1]++; }
    for (k = 0; k < size; k++) cs[k + 1] += cs[k];
    for (k = 0; k < size; k++) cur[k] = cs[k];
    var tmp = this.tmp || (this.tmp = new Int32Array(this.max));
    for (i = 0; i < n; i++) { ci = order[i]; tmp[cur[ci]++] = i; }
    this.sorted = tmp; this.gn = n;
  };
  /* wake every sleeping particle inside a box (uses the grid from the last step) */
  Fluid.prototype.wake = function (x0, y0, x1, y1) {
    if (!this.sorted || this.gn < 0) return;
    var c = this.cell, gw = this.gw, gh = this.gh, cs = this.cs, s = this.sorted, sl = this.sl, cm = this.cm, n = this.n, gg = this.gen, G2 = Math.max(0, this.G - 2);
    var a0 = (x0 / c | 0) + 1, a1 = (x1 / c | 0) + 1, b0 = (y0 / c | 0) + 1, b1 = (y1 / c | 0) + 1, gx, gy, k, j;
    a0 = a0 < 0 ? 0 : a0; b0 = b0 < 0 ? 0 : b0; a1 = a1 >= gw ? gw - 1 : a1; b1 = b1 >= gh ? gh - 1 : b1;
    for (gy = b0; gy <= b1; gy++) for (gx = a0; gx <= a1; gx++) { var cc = gx + gy * gw; for (k = cs[cc]; k < cs[cc + 1]; k++) { j = s[k]; if (j < n) { sl[j] = 0; cm[j] = 0; gg[j] = G2; } } }
  };
  /* count neighbours once (for a freshly filled, sleeping tank) */
  Fluid.prototype.recount = function (W, H) {
    this.grid(W, H); var n = this.n, x = this.x, y = this.y, c = this.cell, gw = this.gw, gh = this.gh, cs = this.cs, s = this.sorted, h2 = this.h * this.h, i, dx, dy, k, j;
    for (i = 0; i < n; i++) {
      var cx = (x[i] / c | 0) + 1, cy = (y[i] / c | 0) + 1, nb = 0;
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) { var gx = cx + dx, gy = cy + dy; if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue; var cc = gx + gy * gw; for (k = cs[cc]; k < cs[cc + 1]; k++) { j = s[k]; if (j === i) continue; var ex = x[j] - x[i], ey = y[j] - y[i]; if (ex * ex + ey * ey < h2) nb++; } }
      this.nc[i] = nb > 255 ? 255 : nb;
    }
  };
  /* one step. dt in seconds. Sleeping particles (calm water deep in a pool) are skipped: they still push on the awake ones, and wake up when something disturbs them. */
  Fluid.prototype.step = function (dt, gy, gx, W, H, solids, tg, tv) {
    var n = this.n; if (!n) { this.na = 0; return; }
    var x = this.x, y = this.y, vx = this.vx, vy = this.vy, ox = this.ox, oy = this.oy, ax = this.ax, ay = this.ay, rho = this.rho, rn = this.rn, t = this.t, sl = this.sl, cm = this.cm, s2 = this.s2, act = this.act, wl = this.wl, nc = this.nc, gen = this.gen, G = this.G;
    var h = this.h, h2 = h * h, i, j, k, c = this.cell, a, na = 0, nw = 0;
    for (i = 0; i < n; i++) if (!sl[i]) act[na++] = i;
    this.na = na;
    if (!na) { if (this.gn !== n) this.grid(W, H); return; }
    for (a = 0; a < na; a++) { i = act[a]; var g = tg ? tg[t[i]] : 1; vy[i] += gy * g * dt; vx[i] += gx * g * dt; ox[i] = x[i]; oy[i] = y[i]; x[i] += vx[i] * dt; y[i] += vy[i] * dt; }
    this.grid(W, H);
    var gw = this.gw, gh = this.gh, cs = this.cs, s = this.sorted, rho0 = this.rho0, ks = this.ks, kn = this.kn, vw2 = this.vw * this.vw;
    /* pass 1: densities (and neighbour counts) */
    for (a = 0; a < na; a++) {
      i = act[a]; var cx = (x[i] / c | 0) + 1, cy = (y[i] / c | 0) + 1, r1 = 0, r2 = 0, nb = 0, dx, dy;
      for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= 1; dx++) {
        var gx2 = cx + dx, gy2 = cy + dy; if (gx2 < 0 || gy2 < 0 || gx2 >= gw || gy2 >= gh) continue; var cc = gx2 + gy2 * gw;
        for (k = cs[cc]; k < cs[cc + 1]; k++) { j = s[k]; if (j === i) continue; var ex = x[j] - x[i], ey = y[j] - y[i], d2 = ex * ex + ey * ey; if (d2 >= h2) continue; var q = 1 - Math.sqrt(d2) / h; r1 += q * q; r2 += q * q * q; nb++; }
      }
      rho[i] = r1; rn[i] = r2; nc[i] = nb > 255 ? 255 : nb; ax[i] = 0; ay[i] = 0;
    }
    /* pass 2: pressure displacements + viscosity */
    for (a = 0; a < na; a++) {
      i = act[a]; var P = ks * (rho[i] - rho0), Pn = ks * kn * rn[i], cx2 = (x[i] / c | 0) + 1, cy2 = (y[i] / c | 0) + 1, dx2, dy2, fast = s2[i] > vw2 && gen[i] < G;
      if (P < 0) P = 0;   // stretched: no suction
      for (dy2 = -1; dy2 <= 1; dy2++) for (dx2 = -1; dx2 <= 1; dx2++) {
        var gx3 = cx2 + dx2, gy3 = cy2 + dy2; if (gx3 < 0 || gy3 < 0 || gx3 >= gw || gy3 >= gh) continue; var c3 = gx3 + gy3 * gw;
        for (k = cs[c3]; k < cs[c3 + 1]; k++) {
          j = s[k]; if (j === i) continue; var ex2 = x[j] - x[i], ey2 = y[j] - y[i], dd = ex2 * ex2 + ey2 * ey2; if (dd >= h2 || dd < 1e-8) continue;
          var dist = Math.sqrt(dd), qq = 1 - dist / h, D = h * (P * qq + Pn * qq * qq) * 0.5, ux = ex2 / dist, uy = ey2 / dist, u = ((vx[i] - vx[j]) * ux + (vy[i] - vy[j]) * uy), I = 0;
          if (u > 0) I = (tv ? (tv[t[i]] + tv[t[j]]) * 0.5 : this.vis) * qq * u * 0.5 * dt;
          if (sl[j]) {   // a sleeping neighbour acts like a wall; a fast awake one wakes it up next step
            ax[i] -= 2 * ux * D + I * ux; ay[i] -= 2 * uy * D + I * uy;
            if (fast && cm[j] !== 255) { cm[j] = 255; wl[nw++] = j; gen[j] = gen[i] + 1; }
          } else {
            ax[j] += ux * D; ay[j] += uy * D; ax[i] -= ux * D; ay[i] -= uy * D;
            if (I) { ax[i] -= I * ux; ay[i] -= I * uy; ax[j] += I * ux; ay[j] += I * uy; }
          }
        }
      }
    }
    var maxD = h * 0.35;
    for (a = 0; a < na; a++) { i = act[a]; var mx = ax[i], my = ay[i], m = Math.sqrt(mx * mx + my * my); if (m > maxD) { mx *= maxD / m; my *= maxD / m; } x[i] += mx; y[i] += my; }
    /* walls and rigid bodies (twice, so a particle pushed out of one thing is not pushed into the next) */
    var mg = 3.2, pass, ns = solids ? solids.length : 0, si;
    for (pass = 0; pass < 2; pass++) for (a = 0; a < na; a++) {
      i = act[a]; var px = x[i], py = y[i];
      for (si = 0; si < ns; si++) {
        var S = solids[si]; if (px < S.x0 - mg || px > S.x1 + mg || py < S.y0 - mg || py > S.y1 + mg) continue;
        var nx = 0, ny = 0, pen = 0;
        if (S.k === 0) { var cdx = px - S.x, cdy = py - S.y, cd = Math.sqrt(cdx * cdx + cdy * cdy), R = S.r + mg; if (cd >= R) continue; if (cd < 1e-4) { nx = 0; ny = -1; } else { nx = cdx / cd; ny = cdy / cd; } pen = R - cd; }
        else {
          var best = -1e9, bi = -1, e, ne = S.nx.length; for (e = 0; e < ne; e++) { var dd2 = S.nx[e] * px + S.ny[e] * py - S.nd[e]; if (dd2 > best) { best = dd2; bi = e; } }
          if (best >= mg) continue; nx = S.nx[bi]; ny = S.ny[bi]; pen = mg - best;
        }
        px += nx * pen; py += ny * pen; S.fx -= nx * pen; S.fy -= ny * pen; S.cx += px; S.cy += py; S.cnt++; if (t[i] === 2) S.hot++;
      }
      if (px < mg) px = mg; else if (px > W - mg) px = W - mg; if (py > H - mg) py = H - mg; if (py < mg) py = mg;
      x[i] = px; y[i] = py;
    }
    var inv = 1 / dt, vmax = 2600, vs2 = this.vs * this.vs, sN = this.sN, dm = this.damp;
    for (a = 0; a < na; a++) {
      i = act[a]; var nvx = (x[i] - ox[i]) * inv, nvy = (y[i] - oy[i]) * inv, sp = nvx * nvx + nvy * nvy; if (sp > vmax * vmax) { var kk = vmax / Math.sqrt(sp); nvx *= kk; nvy *= kk; sp = vmax * vmax; }
      vx[i] = nvx * dm; vy[i] = nvy * dm; s2[i] = sp;
      if (sp < vs2 && nc[i] >= 5) { if (++cm[i] > sN) { sl[i] = 1; vx[i] = 0; vy[i] = 0; s2[i] = 0; gen[i] = 0; } } else cm[i] = 0;
    }
    for (k = 0; k < nw; k++) { j = wl[k]; sl[j] = 0; cm[j] = 0; }
  };


  /* ================= page ================= */
  function shellHtml() {
    var h = '<div class="lb-wrap ph-wrap"><header class="lb-hd"><button type="button" class="lb-bk2" data-a="hub" aria-label="Back to Lab">' + ic('back', 18) + '<span>Lab</span></button>' +
      '<div class="lb-tt"><h2>Physics Sandbox</h2><p>Build it, pour it, tie it, blow it up.</p></div></header>';
    h += '<div class="ph-tools" id="phtools">';
    GROUPS.forEach(function (g, i) {
      if (i) h += '<i class="ph-sep"></i>';
      g.forEach(function (t) { h += '<button type="button" class="ph-t" data-pt="' + t[0] + '">' + ic(t[0], 20) + '<span>' + t[1] + '</span></button>'; });
    });
    h += '</div><div class="ph-stage"><canvas id="phcv" aria-label="Physics sandbox"></canvas><div class="ph-chip" id="phchip"></div><div class="ph-load" id="phload">Loading the physics engine...</div></div>';
    h += '<div class="ph-info" id="phinfo"></div>';
    h += '<div class="ph-ctl"><div class="ph-grp" id="phmat">' + MATS.map(function (m, i) { return '<button type="button" class="ph-m' + (i ? '' : ' on') + '" data-pm="' + m.id + '" style="--c:' + m.c + '"><s></s>' + m.n + '</button>'; }).join('') + '</div>' +
      '<div class="ph-grp" id="phfl">' + LIQ.map(function (l, i) { return '<button type="button" class="ph-m' + (i ? '' : ' on') + '" data-pf="' + i + '" style="--c:' + l.dot + '"><s></s>' + l.n + '</button>'; }).join('') + '</div>' +
      '<label class="ph-grp">Size<input type="range" id="phsz" min="10" max="60" value="28" aria-label="Object size"></label>' +
      '<label class="ph-grp">Gravity<select id="phg" aria-label="Gravity">' + GRAV.map(function (g, i) { return '<option value="' + i + '">' + g[0] + '</option>'; }).join('') + '</select></label>' +
      '<label class="ph-grp">Speed<select id="phsp" aria-label="Speed"><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option></select></label>' +
      '<div class="ph-grp"><button type="button" class="ph-b" data-pa="pause" id="phpa">' + ic('pause', 16) + '<span>Pause</span></button><button type="button" class="ph-b" data-pa="rain" id="phrn">' + ic('rain', 16) + '<span>Rain</span></button>' +
      '<button type="button" class="ph-b" data-pa="drain">' + ic('drain', 16) + '<span>Drain</span></button><button type="button" class="ph-b" data-pa="clear">' + ic('trash', 16) + '<span>Clear</span></button></div></div>';
    h += '<div class="ph-try"><b>Scenes:</b><button type="button" class="ph-b" data-sc="tower">Box tower</button><button type="button" class="ph-b" data-sc="pendulum">Pendulum</button><button type="button" class="ph-b" data-sc="pool">Float or sink?</button>' +
      '<button type="button" class="ph-b" data-sc="wheel">Water wheel</button><button type="button" class="ph-b" data-sc="lava">Lava lake</button><button type="button" class="ph-b" data-sc="lift">Balloon lift</button><button type="button" class="ph-b" data-sc="ocean">Ocean</button>' +
      '<button type="button" class="ph-b ph-ask" data-pa="ask">' + ic('chat', 16) + '<span>Ask Spectra</span></button></div></div>';
    return h;
  }

  function mount(root, opts) {
    unmount(); O = opts || {};
    S = { root: root, tool: 'drag', mat: 'wood', fluid: 0, size: 28, grav: 1, speed: 1, paused: false, rain: false, W: 0, H: 0, dpr: 1, acc: 0, last: 0, shake: 0, fx: [], ropes: {}, walls: [], faucets: [], fans: [], line: null, grab: null, pid: null, pp: { x: 0, y: 0 }, pour: false, pourAcc: 0, frame: 0, tt: 0, full: 0, bg: '#f3f4f6', gridc: 'rgba(120,120,140,.18)' };
    root.innerHTML = shellHtml();
    var s = S, wrap = root.querySelector('.ph-wrap');
    wrap.addEventListener('click', onClick); wrap.addEventListener('change', onChange); wrap.addEventListener('input', onChange);
    s.onk = function (e) { if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test((e.target || {}).tagName || '')) { e.preventDefault(); togglePause(); } };
    document.addEventListener('keydown', s.onk);
    setTool('drag');
    loadM().then(function () { if (S === s) boot(); }).catch(function () { var l = $('#phload'); if (l && S === s) l.textContent = 'Could not load the physics engine. Check your connection, then open the sandbox again.'; });
  }

  function unmount() {
    var s = S; if (!s) return; S = null;
    cancelAnimationFrame(s.raf); if (s.ro) s.ro.disconnect(); if (s.onr) window.removeEventListener('resize', s.onr); if (s.onk) document.removeEventListener('keydown', s.onk);
    try { if (s.eng && M) { M.Composite.clear(s.world, false); M.Engine.clear(s.eng); } } catch (e) { }
  }

  function boot() {
    var s = S; if (!s) return;
    s.eng = M.Engine.create();
    s.eng.positionIterations = 8; s.eng.velocityIterations = 6; s.eng.constraintIterations = 8; s.eng.gravity.y = s.grav; s.world = s.eng.world;
    s.cv = $('#phcv'); s.ctx = s.cv.getContext('2d');
    s.fl = new Fluid(FMAX); s.fl.ks = 0.04; s.fl.kn = 0.5; s.fl.damp = 0.996; s.wm = WAKE; s.ld = 0; s.stat = {}; s.st = { dc: null, rb: null, lc: null, top: null, ys: null, wv: null, T: 0, flip: false, amb: false };
    s.spr = document.createElement('canvas'); s.spr.width = s.spr.height = 32;
    var sx = s.spr.getContext('2d'), g = sx.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,.27)'); g.addColorStop(0.55, 'rgba(255,255,255,.17)'); g.addColorStop(1, 'rgba(255,255,255,0)'); sx.fillStyle = g; sx.fillRect(0, 0, 32, 32);
    s.wc = document.createElement('canvas'); s.wx = s.wc.getContext('2d', { willReadFrequently: true });
    fit(true);
    M.Events.on(s.eng, 'collisionStart', function (ev) {   // TNT goes off when it hits something hard
      ev.pairs.forEach(function (p) {
        var a = p.bodyA, b = p.bodyB; if (!a.tnt && !b.tnt) return;
        var rv = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        if (rv > 13) { if (a.tnt && a.fuse == null) a.fuse = 90; if (b.tnt && b.fuse == null) b.fuse = 90; }
      });
    });
    s.cv.addEventListener('pointerdown', down); s.cv.addEventListener('pointermove', move); s.cv.addEventListener('pointerup', up); s.cv.addEventListener('pointercancel', up);
    s.cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    if (window.ResizeObserver) { s.ro = new ResizeObserver(function () { fit(); }); s.ro.observe(s.cv); } else { s.onr = function () { fit(); }; window.addEventListener('resize', s.onr); }
    var l = $('#phload'); if (l) l.style.display = 'none';
    colors(); s.raf = requestAnimationFrame(frame);
  }

  function colors() {
    var s = S, cs = getComputedStyle(s.root), bg = cs.getPropertyValue('--soft').trim(), ln = cs.getPropertyValue('--line').trim();
    s.bg = bg || '#f3f4f6'; s.gridc = ln || 'rgba(120,120,140,.25)';
  }

  function fit(force) {
    var s = S; if (!s || !s.cv) return; var r = s.cv.getBoundingClientRect(); if (r.width < 20 || r.height < 20) return;
    var W = Math.round(r.width), H = Math.round(r.height); if (!force && W === s.W && H === s.H) return;
    s.W = W; s.H = H; s.dpr = Math.min(2, window.devicePixelRatio || 1); s.cv.width = Math.round(W * s.dpr); s.cv.height = Math.round(H * s.dpr);
    s.wsc = Math.min(0.5, Math.sqrt(90000 / (W * H))); s.lw = Math.max(8, Math.ceil(W * s.wsc)); s.lh = Math.max(8, Math.ceil(H * s.wsc)); s.wc.width = s.lw; s.wc.height = s.lh; s.dc = new Uint16Array(s.lw); s.rb = new Float32Array(s.lw);
    s.top = new Int16Array(s.lw); s.ys = new Float32Array(s.lw); for (var q0 = 0; q0 < s.lw; q0++) s.top[q0] = -1; s.wv = new Float32Array(s.lw); s.wu = new Float32Array(s.lw); s.lc = new Float32Array(s.lw);
    s.st.dc = s.dc; s.st.rb = s.rb; s.st.ys = s.ys; s.st.lc = s.lc; s.st.wv = s.wv; s.lut = LIQ.map(function (L) { return mkLut(L, s.wsc, s.lh + 6); });
    s.maxw = Math.min(FMAX, Math.max(450, Math.round(W * H / (W < 520 ? 52 : 40)))); if (s.fl) s.fl.wakeAll();
    if (s.eng) {
      mkWalls();
      M.Composite.allBodies(s.world).forEach(function (b) { if (b.isStatic) return; if (b.position.x > W - 8) M.Body.setPosition(b, { x: W - 24, y: b.position.y }); if (b.position.y > H - 2) M.Body.setPosition(b, { x: b.position.x, y: H - 24 }); });
    }
  }

  function mkWalls() {
    var s = S, W = s.W, H = s.H, T = 200, o = { isStatic: true, friction: 0.8, restitution: 0.05, label: 'wall' };
    s.walls.forEach(function (w) { M.Composite.remove(s.world, w); });
    s.walls = [M.Bodies.rectangle(W / 2, H + T / 2, W + 2 * T, T, o), M.Bodies.rectangle(W / 2, -T / 2 - 80, W + 2 * T, T, o), M.Bodies.rectangle(-T / 2, H / 2 - 150, T, H + 800, o), M.Bodies.rectangle(W + T / 2, H / 2 - 150, T, H + 800, o)];
    s.walls.forEach(function (w) { w.wall = true; });
    M.Composite.add(s.world, s.walls);
  }

  /* ================= building things ================= */
  function opts(m, extra) {
    var o = { friction: m.f, restitution: m.r, density: m.d, frictionAir: 0.01, sleepThreshold: Infinity }; for (var k in extra) o[k] = extra[k]; return o;
  }
  function objCount() { return M.Composite.allBodies(S.world).filter(function (b) { return !b.wall && !b.rope; }).length; }
  function addB(b) { M.Composite.add(S.world, b); return b; }
  function full() { if (objCount() >= MAXO) { toast('That is a lot of stuff. Clear some first.'); return true; } return false; }

  function mk(kind, x, y, sz, matId, extra) {
    var m = MAT[matId] || MAT.wood, o = opts(m, extra || {}), b;
    if (kind === 'ball' || kind === 'wheel') b = M.Bodies.circle(x, y, sz, o);
    else if (kind === 'tri') b = M.Bodies.polygon(x, y, 3, sz * 1.2, o);
    else if (kind === 'hex') b = M.Bodies.polygon(x, y, 6, sz * 1.1, o);
    else if (kind === 'plank') b = M.Bodies.rectangle(x, y, sz * 5, Math.max(10, sz * 0.45), o);
    else b = M.Bodies.rectangle(x, y, sz * 2, sz * 2, o);
    b.col = m.c; b.kind = kind; b.matId = m.id; return b;
  }
  function place(kind, p) {
    if (full()) return; var b = addB(mk(kind, p.x, p.y, S.size, S.mat)); M.Body.setAngle(b, (rnd() - 0.5) * 0.4); return b;
  }
  function mkBomb(p) {
    if (full()) return;
    var b = addB(M.Bodies.circle(p.x, p.y, 13, { density: 0.004, restitution: 0.4, friction: 0.5, frictionAir: 0.01, sleepThreshold: Infinity }));
    b.col = '#1f2937'; b.kind = 'bomb'; b.bomb = { t: 2300 };
  }
  function mkTnt(p) {
    if (full()) return;
    var b = addB(M.Bodies.rectangle(p.x, p.y, 38, 38, { density: 0.0022, restitution: 0.1, friction: 0.6, frictionAir: 0.01, sleepThreshold: Infinity }));
    b.col = '#b45309'; b.kind = 'tnt'; b.tnt = true; M.Body.setAngle(b, (rnd() - 0.5) * 0.3);
  }
  function mkBalloon(p) {
    if (full()) return;
    var r = Math.max(14, S.size * 0.8), b = addB(M.Bodies.circle(p.x, p.y, r, { density: 0.00008, restitution: 0.5, friction: 0.2, frictionAir: 0.03, sleepThreshold: Infinity }));
    b.col = BAL[(rnd() * BAL.length) | 0]; b.kind = 'balloon'; b.balloon = true; b.fa0 = 0.03;
  }
  function mkRocket(p) {
    if (full()) return;
    var k = Math.max(0.6, S.size / 28), v = [[0, -30], [9, -12], [9, 24], [-9, 24], [-9, -12]].map(function (a) { return { x: a[0] * k, y: a[1] * k }; }), b;
    try { b = M.Bodies.fromVertices(p.x, p.y, [v], { density: 0.0016, friction: 0.4, restitution: 0.2, frictionAir: 0.01, sleepThreshold: Infinity }); } catch (e) { b = null; }
    if (!b || !b.position) b = M.Bodies.rectangle(p.x, p.y, 18 * k, 54 * k, { density: 0.0016, friction: 0.4, restitution: 0.2, sleepThreshold: Infinity });
    b.col = '#e5e7eb'; b.kind = 'rocket'; b.rk = { t: 600, burn: 2800, on: false }; b.rkk = k; addB(b);
  }
  function mkPlatform(a, b, kind) {
    var m = MAT[S.mat] || MAT.wood, pad = kind === 'pad', len = Math.hypot(b.x - a.x, b.y - a.y);
    var p = M.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len, pad ? 12 : 14, { isStatic: true, friction: pad ? 0.2 : m.f, restitution: pad ? 1.1 : m.r, angle: Math.atan2(b.y - a.y, b.x - a.x) });
    p.col = pad ? '#22c55e' : m.c; p.kind = pad ? 'pad' : 'platform'; addB(p);
  }

  /* liquids */
  function emit(x, y, vx, vy, t) {
    var s = S, f = s.fl; if (f.n >= s.maxw) { if (!s.full || s.frame - s.full > 120) { s.full = s.frame; toast('The tank is full. Tap Drain to empty it.'); } return false; }
    f.add(x, y, vx, vy, t); return true;
  }
  function pourAt(p) { emit(p.x + (rnd() - 0.5) * 9, p.y + (rnd() - 0.5) * 4, (rnd() - 0.5) * 60, 90 + rnd() * 80, S.fluid); }
  function fillRect(x0, y0, x1, y1, t, asleep) {   // fill from the bottom edge up with neat rows (asleep: already at rest, so a big tank costs nothing until it is disturbed)
    var row = 0, y, f = S.fl, x, full = false; for (y = y1; y > y0 && !full; y -= 6.06, row++) for (x = x0 + (row & 1) * 3.5; x < x1; x += 7) { if (f.n >= S.maxw) { full = true; break; } f.add(x, y, 0, 0, t, asleep); }
    if (asleep) f.recount(S.W, S.H);
  }

  /* ropes, rods, springs, glue, nails */
  function bodyAt(p, movable) {
    var list = M.Composite.allBodies(S.world).filter(function (b) { return !b.wall && !b.rope && (!movable || !b.isStatic); });
    var hit = M.Query.point(list, p); return hit.length ? hit[hit.length - 1].parent || hit[hit.length - 1] : null;
  }
  function nodeAt(p, rad) {
    var best = null, bd = rad, R = S.ropes;
    for (var id in R) R[id].nodes.forEach(function (n) { var d = Math.hypot(n.position.x - p.x, n.position.y - p.y); if (d < bd) { bd = d; best = n; } });
    return best;
  }
  function targetAt(p) { return bodyAt(p, false) || nodeAt(p, 12); }
  function offs(body, p) { return { x: p.x - body.position.x, y: p.y - body.position.y }; }
  function endCon(node, tgt, p) {
    var o = { bodyB: node, pointB: { x: 0, y: 0 }, length: 0, stiffness: 1, damping: 0.1 };
    if (tgt) {
      o.bodyA = tgt; o.pointA = offs(tgt, p);
      var g = tgt.collisionFilter.group || (tgt.collisionFilter.group = -tgt.id); node.collisionFilter.group = g;   // the end of a rope does not push against the thing it is tied to
    } else o.pointA = { x: p.x, y: p.y };
    var c = M.Constraint.create(o); c.kind = 'rend'; M.Composite.add(S.world, c);
  }
  function mkRope(a, b, ta, tb, taut) {
    var s = S, dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), n = Math.max(3, Math.min(72, Math.round(dist / 11) + 1)), sp = dist / (n - 1), id = ++uid;
    var sag = taut ? 0 : Math.min(dist * 0.04, 16) * (s.eng.gravity.y >= 0 ? 1 : -1), nodes = [], cons = [], i, t;
    for (i = 0; i < n; i++) {
      t = i / (n - 1);
      var nd = M.Bodies.circle(a.x + dx * t, a.y + dy * t + Math.sin(Math.PI * t) * sag, 3.5, { density: 0.01, friction: 0.3, frictionAir: 0.02, restitution: 0, sleepThreshold: Infinity, collisionFilter: { category: CR, mask: CB } }, 8);
      nd.rope = id; nd.fa0 = 0.02; nodes.push(nd);
    }
    M.Composite.add(s.world, nodes);
    for (i = 0; i < n - 1; i++) { var c = M.Constraint.create({ bodyA: nodes[i], bodyB: nodes[i + 1], length: sp * (taut ? 1 : 1.05), stiffness: 0.9, damping: 0.1 }); c.kind = 'rseg'; cons.push(c); }
    M.Composite.add(s.world, cons); s.ropes[id] = { nodes: nodes, cons: cons };
    endCon(nodes[0], ta, a); endCon(nodes[n - 1], tb, b); return id;
  }
  function mkLink(kind, a, b, ta, tb) {
    if (!ta && !tb) { toast('Attach at least one end to an object'); return; }
    if (ta && tb && ta === tb) { toast('Pick two different things'); return; }
    var o = { stiffness: kind === 'rod' ? 1 : 0.03, damping: kind === 'rod' ? 0 : 0.05 };
    if (ta) { o.bodyA = ta; o.pointA = offs(ta, a); } else o.pointA = { x: a.x, y: a.y };
    if (tb) { o.bodyB = tb; o.pointB = offs(tb, b); } else o.pointB = { x: b.x, y: b.y };
    var c = M.Constraint.create(o); c.kind = kind; M.Composite.add(S.world, c);
  }
  function mkGlue(a, b, ta, tb) {
    if (!ta || !tb || ta === tb || ta.rope || tb.rope) { toast('Drag from one object to a different object'); return; }
    var g = ++uid; [a, b].forEach(function (w) {
      var c = M.Constraint.create({ bodyA: ta, pointA: offs(ta, w), bodyB: tb, pointB: offs(tb, w), length: 0, stiffness: 1 }); c.kind = 'glue'; c.g = g; M.Composite.add(S.world, c);
    });
  }
  function mkPin(body, p) {
    var c = M.Constraint.create({ bodyA: body, pointA: offs(body, p), pointB: { x: p.x, y: p.y }, length: 0, stiffness: 1 }); c.kind = 'pin'; M.Composite.add(S.world, c); return c;
  }
  function motorAt(p) {
    var b = bodyAt(p, true); if (!b || b.rope) { toast('Tap an object to put a motor on it'); return; }
    if (!b.motor) { if (!b.motorPin) b.motorPin = mkPin(b, b.position); b.motor = 1; toast('Motor on'); }
    else if (b.motor === 1) { b.motor = -1; toast('Reversed'); }
    else { b.motor = 0; toast('Motor off'); }
  }
  function mkFan(a, b) {
    var d = Math.hypot(b.x - a.x, b.y - a.y), ang = d < 16 ? -Math.PI / 2 : Math.atan2(b.y - a.y, b.x - a.x);
    if (S.fans.length >= 6) { toast('That is plenty of fans'); return; } S.fans.push({ x: a.x, y: a.y, a: ang });
  }

  /* removing */
  function kill(b) {
    var s = S;
    M.Composite.allConstraints(s.world).forEach(function (c) { if (c.bodyA === b || c.bodyB === b) M.Composite.remove(s.world, c); });
    M.Composite.remove(s.world, b); b.gone = true;
  }
  function rm(b) {
    var s = S;
    if (b.rope && s.ropes[b.rope]) { var R = s.ropes[b.rope]; delete s.ropes[b.rope]; R.nodes.forEach(kill); } else kill(b);
  }
  function endsOf(c) {
    return { a: c.bodyA ? { x: c.bodyA.position.x + c.pointA.x, y: c.bodyA.position.y + c.pointA.y } : c.pointA, b: c.bodyB ? { x: c.bodyB.position.x + c.pointB.x, y: c.bodyB.position.y + c.pointB.y } : c.pointB };
  }
  function segDist(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }
  function conAt(p) {
    var best = null, bd = 11;
    M.Composite.allConstraints(S.world).forEach(function (c) {
      var k = c.kind; if (k !== 'rod' && k !== 'spring' && k !== 'pin' && k !== 'rend' && k !== 'glue') return;
      var e = endsOf(c), d = (k === 'pin') ? Math.hypot(p.x - c.pointB.x, p.y - c.pointB.y) : (k === 'rend' || k === 'glue') ? Math.hypot(p.x - e.a.x, p.y - e.a.y) : segDist(p, e.a, e.b);
      if (d < bd) { bd = d; best = c; }
    });
    return best;
  }
  function eraseAt(p) {
    var i;
    for (i = S.fans.length - 1; i >= 0; i--) if (Math.hypot(S.fans[i].x - p.x, S.fans[i].y - p.y) < 24) { S.fans.splice(i, 1); return; }
    for (i = S.faucets.length - 1; i >= 0; i--) if (Math.abs(S.faucets[i].x - 14 - p.x) < 26 && Math.abs(S.faucets[i].y - p.y) < 16) { S.faucets.splice(i, 1); return; }
    var b = bodyAt(p, false) || nodeAt(p, 12);
    if (b) { rm(b); return; }
    var c = conAt(p);
    if (c) { if (c.g) M.Composite.allConstraints(S.world).forEach(function (k) { if (k.g === c.g) M.Composite.remove(S.world, k); }); else M.Composite.remove(S.world, c); }
  }
  function clearAll() {
    var s = S;
    M.Composite.allConstraints(s.world).forEach(function (c) { M.Composite.remove(s.world, c); });
    M.Composite.allBodies(s.world).forEach(function (b) { if (!b.wall) { M.Composite.remove(s.world, b); b.gone = true; } });
    s.fl.clear(); s.stat = {}; s.ropes = {}; s.fx = []; s.faucets = []; s.fans = []; s.grab = null; s.line = null; s.pour = false;
  }

  /* ================= explosions ================= */
  function boom(x, y, R, P) {
    var s = S, f = s.fl, pops = [];
    M.Composite.allBodies(s.world).forEach(function (b) {
      if (b.isStatic) return;
      var dx = b.position.x - x, dy = b.position.y - y, d = Math.hypot(dx, dy); if (d > R) return;
      var k = Math.pow(1 - d / R, 1.2), nx, ny;
      if (d < 1) { var a = rnd() * 6.283; nx = Math.cos(a); ny = Math.sin(a); } else { nx = dx / d; ny = dy / d; }
      var dv = P * k / Math.sqrt(b.mass + 0.3), vx = b.velocity.x + nx * dv, vy = b.velocity.y + ny * dv, sp = Math.hypot(vx, vy);
      if (sp > 38) { vx *= 38 / sp; vy *= 38 / sp; }
      M.Body.setVelocity(b, { x: vx, y: vy }); M.Body.setAngularVelocity(b, b.angularVelocity + (rnd() - 0.5) * k * 0.6);
      if (b.bomb) b.bomb.t = Math.min(b.bomb.t, 120);   // other bombs and TNT in range go off too
      if (b.tnt && b.fuse == null) b.fuse = 110;
      if (b.balloon) pops.push(b);
    });
    pops.forEach(function (b) { popFx(b); rm(b); });
    for (var i = 0; i < f.n; i++) {   // the liquid gets thrown too
      var ex = f.x[i] - x, ey = f.y[i] - y, ed = Math.sqrt(ex * ex + ey * ey); if (ed > R) continue; f.sl[i] = 0; f.cm[i] = 0; f.gen[i] = 0;
      var ek = Math.pow(1 - ed / R, 1.2), en = ed < 1 ? 1 : ed, dv2 = P * ek * 55;
      f.vx[i] += ex / en * dv2; f.vy[i] += ey / en * dv2;
    }
    s.fx.push({ t: 'ring', x: x, y: y, R: R, l: 1, dec: 0.0022 }, { t: 'flash', x: x, y: y, R: R * 0.7, l: 1, dec: 0.004 });
    var n = calm() ? 8 : 40, i2, a2, v;
    for (i2 = 0; i2 < n; i2++) { a2 = rnd() * 6.283; v = 2 + rnd() * 9; s.fx.push({ t: 'sp', x: x, y: y, vx: Math.cos(a2) * v, vy: Math.sin(a2) * v, l: 1, dec: 0.0012 / (0.8 + rnd()), c: rnd() < 0.5 ? '#ffb347' : '#ff5e3a' }); }
    for (i2 = 0; i2 < (calm() ? 2 : 9); i2++) { a2 = rnd() * 6.283; v = 0.4 + rnd() * 2.2; s.fx.push({ t: 'sm', x: x, y: y, vx: Math.cos(a2) * v, vy: Math.sin(a2) * v - 0.4, r: 10 + rnd() * 16, l: 1, dec: 0.0008 }); }
    if (!calm()) s.shake = Math.max(s.shake, Math.min(14, R / 16));
  }
  function popFx(b) {
    var s = S, x = b.position.x, y = b.position.y, i, a;
    s.fx.push({ t: 'ring', x: x, y: y, R: 36, l: 1, dec: 0.006 });
    for (i = 0; i < 10; i++) { a = rnd() * 6.283; s.fx.push({ t: 'sp', x: x, y: y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, l: 1, dec: 0.003, c: b.col || '#ef4444' }); }
  }
  function burnFx(x, y) {
    var s = S, i; for (i = 0; i < 12; i++) s.fx.push({ t: 'sp', x: x + (rnd() - 0.5) * 20, y: y + (rnd() - 0.5) * 20, vx: (rnd() - 0.5) * 2, vy: -1 - rnd() * 3, l: 1, dec: 0.0016, c: rnd() < 0.5 ? '#ffb347' : '#ff5e3a' });
    for (i = 0; i < 4; i++) s.fx.push({ t: 'sm', x: x, y: y, vx: (rnd() - 0.5), vy: -0.8 - rnd(), r: 8 + rnd() * 8, l: 1, dec: 0.0009 });
  }

  /* ================= scenes ================= */
  function scene(name) {
    var s = S; if (!s.eng) return; clearAll(); var W = s.W, H = s.H, i, j, pw, x0, x1;
    if (name === 'tower') {
      var rows = 6, sz = Math.max(12, Math.min(18, (W - 60) / (rows * 2.4)));
      for (i = 0; i < rows; i++) for (j = 0; j < rows - i; j++) addB(mk('box', W / 2 + (j - (rows - i - 1) / 2) * (sz * 2.05), H - sz - 1 - i * (sz * 2.02), sz, 'wood'));
      toast('Grab a ball or drop a bomb next to it');
    } else if (name === 'pendulum') {
      var ball = addB(mk('ball', W / 2 + Math.min(170, W * 0.3), 190, 16, 'steel'));
      mkRope({ x: W / 2, y: 40 }, { x: ball.position.x, y: ball.position.y }, null, ball, true);
      toast('Let go of the ball: potential energy turns into kinetic energy');
    } else if (name === 'pool') {
      pw = Math.min(300, W - 70); x0 = W / 2 - pw / 2; x1 = W / 2 + pw / 2;
      mkPlatform({ x: x0, y: H - 170 }, { x: x0, y: H - 4 }); mkPlatform({ x: x1, y: H - 170 }, { x: x1, y: H - 4 });
      fillRect(x0 + 8, H - 100, x1 - 8, H - 6, 0);
      addB(mk('box', W / 2 - pw / 4, H - 330, 22, 'wood')); addB(mk('ball', W / 2 + pw / 4, H - 330, 20, 'steel'));
      toast('Wood floats, steel sinks');
    } else if (name === 'wheel') {
      var cx = W / 2, cy = H - 170, arm = Math.min(70, W * 0.18);
      var pa = M.Bodies.rectangle(cx, cy, arm * 2, 12, { density: 0.0012, friction: 0.5, frictionAir: 0.02, sleepThreshold: Infinity }), pb = M.Bodies.rectangle(cx, cy, 12, arm * 2, { density: 0.0012, friction: 0.5, frictionAir: 0.02, sleepThreshold: Infinity });
      var wh = M.Body.create({ parts: [pa, pb], friction: 0.5, frictionAir: 0.02, sleepThreshold: Infinity }); wh.col = '#c68b59'; wh.kind = 'wheelx'; wh.fa0 = 0.02; pa.col = pb.col = '#c68b59'; addB(wh); mkPin(wh, { x: cx, y: cy });
      mkPlatform({ x: cx - arm - 20, y: H - 60 }, { x: cx + arm + 20, y: H - 60 });
      s.faucets.push({ x: cx + arm * 0.7 + 14, y: 46, t: 0 });
      toast('The water pushes the paddles. Water has momentum too');
    } else if (name === 'lava') {
      pw = Math.min(300, W - 60); x0 = W / 2 - pw / 2; x1 = W / 2 + pw / 2;
      mkPlatform({ x: x0, y: H - 150 }, { x: x0, y: H - 4 }); mkPlatform({ x: x1, y: H - 150 }, { x: x1, y: H - 4 });
      fillRect(x0 + 8, H - 90, x1 - 8, H - 6, 2);
      addB(mk('box', W / 2 - pw / 3, H - 320, 18, 'wood')); addB(mk('hex', W / 2, H - 340, 18, 'ice')); addB(mk('ball', W / 2 + pw / 3, H - 320, 16, 'steel'));
      toast('Lava burns wood, melts ice, and steel just sits there');
    } else if (name === 'ocean') {
      var lvl = Math.round(H * 0.42), ob;
      fillRect(4, lvl, W - 4, H - 6, 0, true);
      addB(mk('plank', W * 0.3, lvl - 90, 26, 'wood')); addB(mk('box', W * 0.3 - 30, lvl - 150, 14, 'wood')); addB(mk('ball', W * 0.3 + 36, lvl - 190, 13, 'rubber'));
      addB(mk('ball', W * 0.62, lvl - 120, 16, 'steel')); addB(mk('hex', W * 0.74, lvl - 100, 15, 'ice')); addB(mk('box', W * 0.84, lvl - 130, 15, 'foam'));
      toast('A whole screen of water. It sleeps while calm, so it stays smooth. Go splash it');
    } else if (name === 'lift') {
      var bx = addB(mk('box', W / 2, H - 22, 22, 'wood')), k;
      for (k = -1; k <= 1; k++) { var bl = addB(M.Bodies.circle(W / 2 + k * 50, 120 + Math.abs(k) * 24, 20, { density: 0.00008, restitution: 0.5, frictionAir: 0.03, sleepThreshold: Infinity })); bl.col = BAL[(k + 1) * 2 % BAL.length]; bl.kind = 'balloon'; bl.balloon = true; bl.fa0 = 0.03; mkRope({ x: bl.position.x, y: bl.position.y + 20 }, { x: bx.position.x + k * 12, y: bx.position.y - 22 }, bl, bx, true); }
      toast('Three balloons try to lift a box. Add more!');
    }
  }

  /* ================= input ================= */
  function pos(e) { var r = S.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function down(e) {
    var s = S; if (!s || !s.eng || s.pid !== null) return; e.preventDefault();
    try { s.cv.setPointerCapture(e.pointerId); } catch (x) { }
    s.pid = e.pointerId; var p = pos(e), T = s.tool; s.pp = p;
    if (T === 'drag') {
      var b = bodyAt(p, true) || nodeAt(p, 16);
      if (b) {
        var c = M.Constraint.create({ bodyB: b, pointB: offs(b, p), pointA: { x: p.x, y: p.y }, length: 0, stiffness: 0.18, damping: 0.12 }); c.kind = 'grab'; M.Composite.add(s.world, c); s.grab = c;
        s.cv.style.cursor = 'grabbing';
      }
    } else if (T === 'box' || T === 'ball' || T === 'tri' || T === 'hex' || T === 'plank' || T === 'wheel') place(T, p);
    else if (T === 'water') s.pour = true;
    else if (T === 'faucet') { if (s.faucets.length >= 5) toast('That is plenty of faucets'); else s.faucets.push({ x: p.x + 14, y: p.y, t: s.fluid }); }
    else if (T === 'bomb') mkBomb(p);
    else if (T === 'tnt') mkTnt(p);
    else if (T === 'balloon') mkBalloon(p);
    else if (T === 'rocket') mkRocket(p);
    else if (T === 'boom') boom(p.x, p.y, 200, 34);
    else if (T === 'erase') eraseAt(p);
    else if (T === 'motor') motorAt(p);
    else if (T === 'pin') { var t = targetAt(p); if (t) mkPin(t, p); else toast('Tap an object to nail it'); }
    else if (T === 'rope' || T === 'rod' || T === 'spring' || T === 'glue' || T === 'platform' || T === 'pad' || T === 'fan') s.line = { a: p, ta: (T === 'platform' || T === 'pad' || T === 'fan') ? null : targetAt(p) };
  }
  function move(e) {
    var s = S; if (!s || !s.eng || e.pointerId !== s.pid) return; var p = pos(e); s.pp = p;
    if (s.grab) s.grab.pointA = { x: p.x, y: p.y };
    else if (s.tool === 'erase') eraseAt(p);
  }
  function up(e) {
    var s = S; if (!s || e.pointerId !== s.pid) return; var p = pos(e), T = s.tool;
    try { s.cv.releasePointerCapture(e.pointerId); } catch (x) { }
    s.pid = null; s.pour = false;
    if (s.grab) { M.Composite.remove(s.world, s.grab); s.grab = null; s.cv.style.cursor = 'grab'; }
    if (s.line) {
      var L = s.line; s.line = null;
      if (e.type !== 'pointercancel') {
        if (T === 'fan') mkFan(L.a, p);
        else if (Math.hypot(p.x - L.a.x, p.y - L.a.y) < 16) toast('Drag a longer line');
        else if (T === 'platform' || T === 'pad') mkPlatform(L.a, p, T);
        else if (T === 'rope') mkRope(L.a, p, L.ta, targetAt(p), false);
        else if (T === 'glue') mkGlue(L.a, p, L.ta, targetAt(p));
        else mkLink(T, L.a, p, L.ta, targetAt(p));
      }
    }
  }

  function setTool(id) {
    var s = S; if (!s) return; s.tool = id; s.line = null;
    S.root.querySelectorAll('.ph-t').forEach(function (b) { b.classList.toggle('on', b.dataset.pt === id); });
    var t = INFO[id], inf = $('#phinfo'); if (inf && t) inf.innerHTML = '<b>' + t[1] + '</b>' + t[2];
    if (s.cv) s.cv.style.cursor = id === 'drag' ? 'grab' : 'crosshair';
  }
  function togglePause() {
    var s = S; if (!s) return; s.paused = !s.paused; var b = $('#phpa'); if (b) b.innerHTML = ic(s.paused ? 'play' : 'pause', 16) + '<span>' + (s.paused ? 'Play' : 'Pause') + '</span>';
  }
  function onClick(e) {
    var s = S; if (!s) return; var b = e.target.closest('[data-pt],[data-pm],[data-pf],[data-pa],[data-sc]'); if (!b) return;
    if (b.dataset.pt) setTool(b.dataset.pt);
    else if (b.dataset.pm) { s.mat = b.dataset.pm; S.root.querySelectorAll('.ph-m[data-pm]').forEach(function (m) { m.classList.toggle('on', m.dataset.pm === s.mat); }); }
    else if (b.dataset.pf !== undefined) { s.fluid = +b.dataset.pf; S.root.querySelectorAll('.ph-m[data-pf]').forEach(function (m) { m.classList.toggle('on', +m.dataset.pf === s.fluid); }); if (s.tool !== 'water' && s.tool !== 'faucet') setTool('water'); }
    else if (b.dataset.sc) scene(b.dataset.sc);
    else if (b.dataset.pa === 'pause') togglePause();
    else if (b.dataset.pa === 'rain') { s.rain = !s.rain; b.classList.toggle('on', s.rain); }
    else if (b.dataset.pa === 'drain') { if (s.fl) s.fl.clear(); }
    else if (b.dataset.pa === 'clear') { if (s.eng) clearAll(); }
    else if (b.dataset.pa === 'ask' && O.onAsk) O.onAsk('Teach me the physics behind a sandbox like this: gravity, buoyancy (why wood floats and steel sinks, and why oil floats on water), rope tension, springs (Hooke\u2019s law), thrust, and what happens in an explosion. Use simple examples and a short quiz at the end.');
  }
  function onChange(e) {
    var s = S; if (!s) return; var t = e.target;
    if (t.id === 'phsz') s.size = +t.value;
    else if (t.id === 'phg' && e.type === 'change') { s.grav = GRAV[+t.value][1]; if (s.eng) s.eng.gravity.y = s.grav; if (s.fl) s.fl.wakeAll(); }
    else if (t.id === 'phsp' && e.type === 'change') s.speed = +t.value;
  }

  /* ================= simulation ================= */
  function solidsFor() {   // the things the liquid bumps into, as simple circles and convex polygons
    var s = S, f = s.fl, out = [], i, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (i = 0; i < f.n; i++) { if (f.x[i] < x0) x0 = f.x[i]; if (f.x[i] > x1) x1 = f.x[i]; if (f.y[i] < y0) y0 = f.y[i]; if (f.y[i] > y1) y1 = f.y[i]; }
    M.Composite.allBodies(s.world).forEach(function (b) {
      if (b.wall) return;
      (b.parts.length > 1 ? b.parts.slice(1) : [b]).forEach(function (p) {
        var bb = p.bounds; if (bb.max.x < x0 - 6 || bb.min.x > x1 + 6 || bb.max.y < y0 - 6 || bb.min.y > y1 + 6) return;
        var o = { b: b, k: 0, x0: bb.min.x, y0: bb.min.y, x1: bb.max.x, y1: bb.max.y, fx: 0, fy: 0, cx: 0, cy: 0, cnt: 0, hot: 0, nof: !!b.rope };
        if (p.circleRadius) { o.x = p.position.x; o.y = p.position.y; o.r = p.circleRadius; }
        else {
          var v = p.vertices, n = v.length, nx = [], ny = [], nd = [], e;
          for (e = 0; e < n; e++) {
            var a = v[e], c = v[(e + 1) % n], ex = c.x - a.x, ey = c.y - a.y, l = Math.hypot(ex, ey) || 1, qx = ey / l, qy = -ex / l;
            if (((a.x + c.x) / 2 - p.position.x) * qx + ((a.y + c.y) / 2 - p.position.y) * qy < 0) { qx = -qx; qy = -qy; }
            nx.push(qx); ny.push(qy); nd.push(qx * a.x + qy * a.y);
          }
          o.k = 1; o.nx = nx; o.ny = ny; o.nd = nd;
        }
        out.push(o);
      });
    });
    return out;
  }
  function windAt(fan, x, y) {   // 0 outside the wind cone, up to 1 right at the fan
    var dx = x - fan.x, dy = y - fan.y, ca = Math.cos(fan.a), sa = Math.sin(fan.a), al = dx * ca + dy * sa, la = Math.abs(-dx * sa + dy * ca);
    if (al < 8 || al > 280 || la > 50 + al * 0.22) return 0; return (1 - al / 280) * (1 - la / (50 + al * 0.22) * 0.5);
  }
  function step(dt) {
    var s = S, f = s.fl, bodies = M.Composite.allBodies(s.world), acts = [], g = s.eng.gravity.y * s.eng.gravity.scale, i, k;
    s.tt += dt;
    bodies.forEach(function (b) {
      if (b.wall || b.isStatic) return;
      b.frictionAir = b.fa0 || 0.01;
      if (b.bomb) { b.bomb.t -= dt; if (b.bomb.t <= 0) acts.push(['boom', b, 190, 30]); }
      if (b.tnt && b.fuse != null) { b.fuse -= dt; if (b.fuse <= 0) acts.push(['boom', b, 170, 27]); }
      if (b.balloon) b.force.y -= b.area * 0.00055 * g;   // lighter than air: lift grows with size
      if (b.rk) {
        var r = b.rk; if (!r.on) { r.t -= dt; if (r.t <= 0) r.on = true; } else if (r.burn > 0) {
          r.burn -= dt; var F = b.mass * 0.0032, fx = Math.sin(b.angle), fy = -Math.cos(b.angle); b.force.x += fx * F; b.force.y += fy * F;
          if (!calm()) { var k2 = b.rkk || 1; s.fx.push({ t: 'sp', x: b.position.x - fx * 24 * k2, y: b.position.y - fy * 24 * k2, vx: -fx * (4 + rnd() * 4) + (rnd() - 0.5) * 1.5, vy: -fy * (4 + rnd() * 4) + (rnd() - 0.5) * 1.5, l: 1, dec: 0.004, c: rnd() < 0.5 ? '#fde047' : '#fb923c' }); }
        } else r.on = false;
      }
      if (b.motor) M.Body.setAngularVelocity(b, 0.07 * b.motor);
      if (b.heat > 0) b.heat = Math.max(0, b.heat - dt * 0.4);
    });
    acts.forEach(function (a) { var b = a[1]; if (b.gone) return; var x = b.position.x, y = b.position.y; kill(b); boom(x, y, a[2], a[3]); });
    s.fans.forEach(function (fan) {   // wind on objects
      var ca = Math.cos(fan.a), sa = Math.sin(fan.a);
      bodies.forEach(function (b) {
        if (b.wall || b.isStatic) return; var w = windAt(fan, b.position.x, b.position.y); if (!w) return;
        var width = Math.sqrt(b.area || 100), acc = Math.min(0.012, 4.2e-5 * width * w * (b.area ? 1 : 0.2) / Math.max(b.mass, 0.02) * (b.rope ? 0.3 : 1)), F = b.mass * acc; b.force.x += ca * F; b.force.y += sa * F;
      });
    });
    if (s.tool === 'magnet' && s.pid !== null) {
      bodies.forEach(function (b) {
        if (b.isStatic || b.wall || b.matId !== 'steel') return; var dx = s.pp.x - b.position.x, dy = s.pp.y - b.position.y, d = Math.hypot(dx, dy); if (d > 340 || d < 2) return;
        var acc = 0.0034 * (1 - d / 340), F = b.mass * acc; b.force.x += dx / d * F; b.force.y += dy / d * F; b.frictionAir = 0.04;
      });
    }
    /* faucets and rain */
    s.faucets.forEach(function (fc) { fc.acc = (fc.acc || 0) + dt; while (fc.acc >= 38) { fc.acc -= 38; emit(fc.x + (rnd() - 0.5) * 3, fc.y + 6, (rnd() - 0.5) * 20, 150, fc.t); } });
    if (s.rain) { s.rainAcc = (s.rainAcc || 0) + dt; while (s.rainAcc >= 30) { s.rainAcc -= 30; emit(rnd() * s.W, 6, 0, 120, 0); } }
    if (s.pour) { s.pourAcc += dt; while (s.pourAcc > 18) { s.pourAcc -= 18; pourAt(s.pp); } }
    /* the liquid */
    if (f.n) {
      var sol = solidsFor(), gy = s.eng.gravity.y * 1000, dtm = dt, dtf = dt / 2000, sub;
      wakeAround(sol, bodies);
      s.fans.forEach(function (fan) { var ca = Math.cos(fan.a), sa = Math.sin(fan.a); for (i = 0; i < f.n; i++) { var w = windAt(fan, f.x[i], f.y[i]); if (w) { f.vx[i] += ca * w * 2200 * dtm / 1000; f.vy[i] += sa * w * 2200 * dtm / 1000; f.sl[i] = 0; f.cm[i] = 0; f.gen[i] = 0; } } });
      for (sub = 0; sub < 2; sub++) f.step(dtf, gy, 0, s.W, s.H, sol, TG, TV);
      var hotSet = [];
      sol.forEach(function (o) {
        if (!o.cnt) return; var b = o.b;
        if (!o.nof && !b.isStatic) {
          var c = MP * KB / (dtf * 1000 * dtm), fx = o.fx * c, fy = o.fy * c, mx = b.mass * 0.03 / dtm, fm = Math.hypot(fx, fy);
          if (fm > mx) { fx *= mx / fm; fy *= mx / fm; }
          M.Body.applyForce(b, { x: o.cx / o.cnt, y: o.cy / o.cnt }, { x: fx, y: fy });
          b.frictionAir = (b.fa0 || 0.01) + Math.min(o.cnt, 14) * 0.004;
        }
        if (o.hot) { b.heat = (b.heat || 0) + dtm * Math.min(1, o.hot / 5) * 1.4; hotSet.push(b); }
      });
      hotSet.forEach(function (b) {
        if (b.gone) return; var h = b.heat, x = b.position.x, y = b.position.y;
        if (b.rope) { if (h > 300) { burnFx(x, y); rm(b); } }
        else if (b.balloon) { popFx(b); rm(b); }
        else if (b.tnt) { if (b.fuse == null) b.fuse = 80; }
        else if (b.bomb) { b.bomb.t = Math.min(b.bomb.t, 100); }
        else if (b.matId === 'ice') { if (h > 700) { var cnt = Math.min(26, Math.round((b.area || 900) / 55)), q; for (q = 0; q < cnt; q++) emit(x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 14, (rnd() - 0.5) * 80, 0, 0); burnFx(x, y); rm(b); } }
        else if (FLAM[b.matId] || b.kind === 'wheelx') { if (h > 1200) { burnFx(x, y); rm(b); } }
      });
    }
    M.Engine.update(s.eng, dt);
  }
  /* ---- far-field ripples: a cheap 1D wave on the water surface, so a splash sends ripples across the whole screen even though the water far away is asleep ---- */
  function waveStep() {
    var s = S, w = s.wv, u = s.wu, top = s.top, lw = s.lw, i, k; if (!w || s.grav <= 0) return;
    for (k = 0; k < 2; k++) {
      for (i = 1; i < lw - 1; i++) { if (top[i] < 0) { u[i] = 0; w[i] = 0; continue; } u[i] = (u[i] + 0.3 * (w[i - 1] + w[i + 1] - 2 * w[i]) - 0.004 * w[i]) * 0.988; }
      for (i = 1; i < lw - 1; i++) { if (top[i] < 0) continue; w[i] += u[i]; if (w[i] > 4) w[i] = 4; else if (w[i] < -4) w[i] = -4; }
    }
  }
  function kickWaves() {   // things hitting or moving through the surface push the ripple layer
    var s = S, f = s.fl, sc = s.wsc, u = s.wu, top = s.top, lw = s.lw, i, a, col, tp, dy, vy, na = f.na; if (!u || s.grav <= 0) return;
    for (a = 0; a < na; a++) {
      i = f.act[a]; if (f.t[i] !== 0) continue; vy = f.vy[i]; if (vy > -60 && vy < 60) continue;
      col = (f.x[i] * sc) | 0; if (col < 1 || col >= lw - 1) continue; tp = top[col]; if (tp < 0) continue; dy = f.y[i] * sc - tp; if (dy < -4 || dy > 7) continue;
      u[col] -= vy * 0.0004; if (u[col] > 1.2) u[col] = 1.2; else if (u[col] < -1.2) u[col] = -1.2;
    }
    M.Composite.allBodies(s.world).forEach(function (b) {
      if (b.isStatic || b.wall) return; var bb = b.bounds, c0 = Math.max(1, (bb.min.x * sc) | 0), c1 = Math.min(lw - 2, (bb.max.x * sc) | 0), v = b.velocity.y, col2;
      if (v > -0.8 && v < 0.8) return;
      for (col2 = c0; col2 <= c1; col2++) { var t2 = top[col2]; if (t2 >= 0 && t2 >= bb.min.y * sc - 2 && t2 <= bb.max.y * sc + 2) { u[col2] -= v * 0.05; if (u[col2] > 1.2) u[col2] = 1.2; else if (u[col2] < -1.2) u[col2] = -1.2; } }
    });
  }
  function wakeAround(sol, bodies) {   // wake sleeping water near anything that moves, and near anything that was built or erased
    var s = S, f = s.fl, seen = {}, st = s.stat, pad = 60, id;
    bodies.forEach(function (b) {
      if (b.wall || !b.isStatic) return; var bb = b.bounds, o = st[b.id], x0 = bb.min.x, y0 = bb.min.y, x1 = bb.max.x, y1 = bb.max.y; seen[b.id] = 1;
      if (!o || o[0] !== x0 || o[1] !== y0 || o[2] !== x1 || o[3] !== y1) { f.wake(x0 - pad, y0 - pad, x1 + pad, y1 + pad); st[b.id] = [x0, y0, x1, y1]; }
    });
    for (id in st) if (!seen[id]) { var o2 = st[id]; f.wake(o2[0] - pad, o2[1] - pad, o2[2] + pad, o2[3] + pad); delete st[id]; }
    sol.forEach(function (o) { if (o.b.isStatic) return; var v = o.b.velocity, m = s.wm + 1.5 * (Math.abs(v.x) + Math.abs(v.y)); f.wake(o.x0 - m, o.y0 - m, o.x1 + m, o.y1 + m); });
  }
  function tune() {   // if physics takes too long, let water fall asleep sooner and wake less; relax back when there is time to spare
    var s = S, f = s.fl;
    if (s.ld > 11) { f.vs = Math.min(40, f.vs * 1.08); f.sN = Math.max(14, f.sN - 2); s.wm = Math.max(20, s.wm - 1); }
    else if (s.ld < 6) { f.vs = Math.max(12, f.vs * 0.98); f.sN = Math.min(40, f.sN + 1); s.wm = Math.min(WAKE, s.wm + 0.5); }
  }
  function fxTick(ms) {
    var s = S, k = ms / 16.7;
    for (var i = s.fx.length - 1; i >= 0; i--) {
      var f = s.fx[i]; f.l -= f.dec * ms; if (f.l <= 0) { s.fx.splice(i, 1); continue; }
      if (f.t === 'sp') { f.x += f.vx * k; f.y += f.vy * k; f.vy += 0.18 * k; f.vx *= 0.985; }
      else if (f.t === 'sm') { f.x += f.vx * k; f.y += f.vy * k; f.vx *= 0.98; f.vy *= 0.98; f.r += 0.25 * k; }
      else if (f.t === 'wd') { f.x += f.vx * k; f.y += f.vy * k; }
    }
    s.shake *= Math.pow(0.9, k);
    if (!calm() && s.fans.length && s.frame % 3 === 0) s.fans.forEach(function (fan) {
      var ca = Math.cos(fan.a), sa = Math.sin(fan.a), o = (rnd() - 0.5) * 40; s.fx.push({ t: 'wd', x: fan.x + ca * 24 - sa * o, y: fan.y + sa * 24 + ca * o, vx: ca * 9, vy: sa * 9, l: 1, dec: 0.0026 });
    });
  }
  function frame(t) {
    var s = S; if (!s || !s.eng) return; s.raf = requestAnimationFrame(frame);
    var dt = Math.min(50, t - (s.last || t)); s.last = t; s.frame++;
    if (s.frame % 90 === 1) colors();
    if (!s.paused) {
      s.acc += dt * s.speed; var n = 0, t0 = performance.now(), cut = false;
      while (s.acc >= STEP && n < 6) { step(STEP); s.acc -= STEP; n++; if (performance.now() - t0 > 13) { cut = true; break; } }
      if (s.acc > STEP * 6 || (cut && s.acc > STEP * 2)) s.acc = 0;   // fell behind: slow motion instead of freezing
      s.ld = s.ld * 0.9 + (performance.now() - t0) * 0.1; if (s.fl.n > 1500 && s.frame % 6 === 0) tune();
      if (s.fl.n) { kickWaves(); waveStep(); }
      fxTick(dt * s.speed);
    }
    draw();
    if (s.frame % 20 === 0) { var ch = $('#phchip'); if (ch) ch.textContent = objCount() + ' objects \u00b7 ' + s.fl.n + ' liquid' + (s.fl.n > 400 ? ' (' + s.fl.na + ' awake)' : '') + ' \u00b7 g = ' + (9.8 * s.grav).toFixed(1) + ' m/s\u00b2' + (s.paused ? ' \u00b7 paused' : ''); }
  }

  /* ================= drawing ================= */
  function path(c, p) {
    var v = p.vertices, i; c.beginPath(); c.moveTo(v[0].x, v[0].y); for (i = 1; i < v.length; i++) c.lineTo(v[i].x, v[i].y); c.closePath();
  }
  function drawBody(c, b) {
    var p = b.position, i, r, parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
    parts.forEach(function (q) {
      if (q.circleRadius) { c.beginPath(); c.arc(q.position.x, q.position.y, q.circleRadius, 0, 6.2832); } else path(c, q);
      c.fillStyle = q.col || b.col || '#94a3b8'; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.35)'; c.stroke();
    });
    if (b.kind === 'wheel' || b.kind === 'ball') {
      r = b.circleRadius; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(b.angle) * r * 0.8, p.y + Math.sin(b.angle) * r * 0.8);
      if (b.kind === 'wheel') for (i = 1; i < 6; i++) { c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(b.angle + i * 1.0472) * r * 0.9, p.y + Math.sin(b.angle + i * 1.0472) * r * 0.9); }
      c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.3)'; c.stroke();
      if (b.kind === 'wheel') { c.beginPath(); c.arc(p.x, p.y, r * 0.18, 0, 6.2832); c.fillStyle = 'rgba(0,0,0,.35)'; c.fill(); c.beginPath(); c.arc(p.x, p.y, r * 0.78, 0, 6.2832); c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.2)'; c.stroke(); }
    }
    if (b.balloon) {
      r = b.circleRadius; c.beginPath(); c.arc(p.x - r * 0.3, p.y - r * 0.35, r * 0.22, 0, 6.2832); c.fillStyle = 'rgba(255,255,255,.55)'; c.fill();
      c.beginPath(); c.moveTo(p.x, p.y + r); c.lineTo(p.x - 4, p.y + r + 7); c.lineTo(p.x + 4, p.y + r + 7); c.closePath(); c.fillStyle = b.col; c.fill();
    }
    if (b.tnt) {
      c.save(); c.translate(p.x, p.y); c.rotate(b.angle); c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(-19, -5, 38, 3); c.fillRect(-19, 3, 38, 3);
      c.fillStyle = '#fef3c7'; c.font = '800 12px Inter,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('TNT', 0, 0); c.restore();
      if (b.fuse != null && Math.sin(b.fuse * 0.08) > 0) { path(c, b); c.fillStyle = 'rgba(255,255,255,.55)'; c.fill(); }
    }
    if (b.rk) {
      var k = b.rkk || 1; c.save(); c.translate(p.x, p.y); c.rotate(b.angle);
      c.fillStyle = '#ef4444'; c.beginPath(); c.moveTo(0, -30 * k); c.lineTo(9 * k, -12 * k); c.lineTo(-9 * k, -12 * k); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(9 * k, 12 * k); c.lineTo(17 * k, 26 * k); c.lineTo(9 * k, 24 * k); c.closePath(); c.moveTo(-9 * k, 12 * k); c.lineTo(-17 * k, 26 * k); c.lineTo(-9 * k, 24 * k); c.closePath(); c.fill();
      c.beginPath(); c.arc(0, -2 * k, 4 * k, 0, 6.2832); c.fillStyle = '#38bdf8'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,.4)'; c.stroke();
      if (b.rk.on && b.rk.burn > 0) { c.beginPath(); c.moveTo(-6 * k, 24 * k); c.lineTo(0, (34 + rnd() * 16) * k); c.lineTo(6 * k, 24 * k); c.closePath(); c.fillStyle = rnd() < 0.5 ? '#fde047' : '#fb923c'; c.fill(); }
      c.restore();
    }
    if (b.bomb) {
      var t = b.bomb.t, a = t < 1100 ? 0.5 + 0.5 * Math.sin(t * 0.04) : 0; r = b.circleRadius;
      if (a) { c.beginPath(); c.arc(p.x, p.y, r, 0, 6.2832); c.fillStyle = 'rgba(239,68,68,' + (a * 0.85) + ')'; c.fill(); }
      var fx = p.x + Math.sin(b.angle) * (r + 4), fy = p.y - Math.cos(b.angle) * (r + 4);
      c.beginPath(); c.moveTo(p.x + Math.sin(b.angle) * r, p.y - Math.cos(b.angle) * r); c.lineTo(fx, fy); c.lineWidth = 2.5; c.strokeStyle = '#a16207'; c.stroke();
      c.beginPath(); c.arc(fx, fy, 3 + rnd() * 2, 0, 6.2832); c.fillStyle = rnd() < 0.5 ? '#fde047' : '#fb923c'; c.fill();
    }
    if (b.motor) { c.beginPath(); c.arc(p.x, p.y, 9, b.motor > 0 ? 0.3 : 2.84, b.motor > 0 ? 4.6 : 6.8, b.motor < 0); c.lineWidth = 3; c.strokeStyle = '#22c55e'; c.stroke(); }
    if (b.heat > 80) { var q = Math.min(0.7, b.heat / 1200); parts.forEach(function (pp) { if (pp.circleRadius) { c.beginPath(); c.arc(pp.position.x, pp.position.y, pp.circleRadius, 0, 6.2832); } else path(c, pp); c.fillStyle = 'rgba(255,90,20,' + q + ')'; c.fill(); }); }
  }
  function coil(c, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, n = Math.max(4, Math.floor(L / 9)), lead = Math.min(10, L * 0.15), span = L - 2 * lead, i;
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(a.x + ux * lead, a.y + uy * lead);
    for (i = 1; i <= n; i++) { var t = lead + span * (i - 0.5) / n, amp = (i % 2 ? 1 : -1) * 7; c.lineTo(a.x + ux * t + nx * amp, a.y + uy * t + ny * amp); }
    c.lineTo(b.x - ux * lead, b.y - uy * lead); c.lineTo(b.x, b.y); c.stroke();
  }
  function nail(c, p) { c.beginPath(); c.arc(p.x, p.y, 5, 0, 6.2832); c.fillStyle = '#475569'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#0f172a'; c.stroke(); c.beginPath(); c.arc(p.x - 1, p.y - 1, 1.6, 0, 6.2832); c.fillStyle = '#cbd5e1'; c.fill(); }

  /* ---- drawing the liquid ---- */
  /* colour, opacity and light-shaft tables by depth (one entry per low-res row), so the pixel loop below only does lookups */
  function mkLut(L, sc, K) {
    var r = new Float32Array(K + 1), g = new Float32Array(K + 1), b = new Float32Array(K + 1), a = new Float32Array(K + 1), sh = new Float32Array(K + 1), k, d, tt;
    for (k = 0; k <= K; k++) {
      d = k / sc; tt = 1 - Math.exp(-d / L.dl);
      r[k] = L.c0[0] + (L.c1[0] - L.c0[0]) * tt; g[k] = L.c0[1] + (L.c1[1] - L.c0[1]) * tt; b[k] = L.c0[2] + (L.c1[2] - L.c0[2]) * tt;
      a[k] = 255 * L.a * (L.a0 + (1 - L.a0) * tt); sh[k] = L.sg * 26 * Math.exp(-d / 120) * (1 - Math.exp(-d / 16));
    }
    return { r: r, g: g, b: b, a: a, s: sh, K: K };
  }
  /* turns the soft blob (alpha only) into the final water: a smoothed, wavy surface, depth colour, light shafts, a bright surface line */
  function shadeLiquid(d, lw, lh, L, lut, st) {
    var dc = st.dc, rb = st.rb, flip = st.flip, lc = st.lc, x, y, yy, idx, base, a, cov, dep, di, hl, sm, sn, q, nw, K = lut.K;
    var cr = lut.r, cg = lut.g, cb = lut.b, ca = lut.a, sh = lut.s;
    if (L.wg && !flip && st.top) {   // the calm top of the water: flatten the bumps between particles, then add ripples
      var top = st.top, ys = st.ys, wv = st.wv, T = st.T, y0, h, dd, ih, fr, k2, cn, sy;
      for (x = 0; x < lw; x++) {
        y0 = -1; for (y = 0; y < lh; y++) if (d[(y * lw + x) * 4 + 3] >= 128) { y0 = y; break; }
        if (y0 < 0 || y0 + 7 >= lh || d[((y0 + 3) * lw + x) * 4 + 3] < 128 || d[((y0 + 7) * lw + x) * 4 + 3] < 128) y0 = -1;
        top[x] = y0; ys[x] = y0;
      }
      for (x = 0; x < lw; x++) {
        y0 = top[x]; if (y0 < 0) continue;
        sy = 0; cn = 0; for (q = x - 2; q <= x + 2; q++) if (q >= 0 && q < lw && ys[q] >= 0) { sy += ys[q]; cn++; }
        h = wv[x]; if (st.amb) h += 0.7 * Math.sin(x * 0.045 + T * 0.0016) + 0.45 * Math.sin(x * 0.019 - T * 0.0011) + 0.2 * Math.sin(x * 0.11 + T * 0.0029);
        if (h > 5) h = 5; else if (h < -5) h = -5;
        dd = y0 - (sy / cn - h); if (dd > 6) dd = 6; else if (dd < -6) dd = -6;
        if (dd > 0.05) {
          ih = Math.floor(dd); fr = dd - ih;
          for (k2 = 1; k2 <= ih; k2++) { yy = y0 - k2; if (yy >= 0) d[(yy * lw + x) * 4 + 3] = 255; }
          yy = y0 - ih - 1; if (fr > 0.1 && yy >= 0) d[(yy * lw + x) * 4 + 3] = 77 + 49 * fr;
        } else if (dd < -0.05) {
          ih = Math.floor(-dd); fr = -dd - ih;
          for (k2 = 0; k2 < ih; k2++) d[((y0 + k2) * lw + x) * 4 + 3] = 0;
          if (fr > 0.1) d[((y0 + ih) * lw + x) * 4 + 3] = 126 - 49 * fr;
        }
      }
    }
    for (x = 0; x < lw; x++) dc[x] = 0;
    for (yy = 0; yy < lh; yy++) {
      y = flip ? lh - 1 - yy : yy; base = y * lw * 4; nw = 0;
      for (x = 0; x < lw; x++) {   // how far below the surface is each pixel (counted down each column)
        idx = base + x * 4; a = d[idx + 3];
        if (a < 76.5) { d[idx + 3] = 0; dc[x] = 0; rb[x] = -1; continue; }
        nw++; dep = dc[x]; rb[x] = dep; dc[x] = a > 127.5 ? dep + 1 : 0;
      }
      if (!nw) continue;
      sm = 0; sn = 0; for (q = 0; q < 2 && q < lw; q++) if (rb[q] >= 0) { sm += rb[q]; sn++; }
      for (x = 0; x < lw; x++) {   // smooth that sideways (sliding window of 5 columns) so the shading has no vertical stripes
        q = x + 2; if (q < lw && rb[q] >= 0) { sm += rb[q]; sn++; }
        q = x - 3; if (q >= 0 && rb[q] >= 0) { sm -= rb[q]; sn--; }
        if (rb[x] < 0) continue; idx = base + x * 4; a = d[idx + 3]; cov = a >= 127.5 ? 1 : (a * 0.00392157 - 0.3) * 5;
        dep = sm / sn; di = dep | 0; if (di > K) di = K;
        hl = (dep < 3 ? (1 - dep / 3) * 70 : 0) + (cov < 1 ? (1 - cov) * 45 : 0) + sh[di] * lc[x];
        d[idx] = cr[di] + hl; d[idx + 1] = cg[di] + hl; d[idx + 2] = cb[di] + hl; d[idx + 3] = ca[di] * cov;
      }
    }
  }
  /* the liquid is drawn as a smooth blob: soft sprites are added up on a small canvas, then thresholded into a surface.
     Calm water deep inside a pool is just stamped in (no sprite), which is what keeps a full screen of water cheap to draw. */
  function drawLiquid(c) {
    var s = S, f = s.fl, n = f.n, i, ty; if (!n) return;
    var sc = s.wsc, lw = s.lw, lh = s.lh, wx = s.wx, R = 12 * sc, cnt = [0, 0, 0], hs = Math.max(1, Math.round(5 * sc)), sl = f.sl, nc = f.nc, tp = f.t, fx = f.x, fy = f.y, T = calm() ? 0 : s.tt;
    for (i = 0; i < n; i++) cnt[tp[i]]++;
    for (i = 0; i < lw; i++) s.lc[i] = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(i * 0.21 + T * 0.0012)) * (0.5 + 0.5 * Math.sin(i * 0.067 - T * 0.0007 + 1.3));
    for (ty = 0; ty < 3; ty++) {
      if (!cnt[ty]) continue;
      wx.setTransform(1, 0, 0, 1, 0, 0); wx.clearRect(0, 0, lw, lh);
      for (i = 0; i < n; i++) if (tp[i] === ty && !(sl[i] && nc[i] >= 11)) wx.drawImage(s.spr, fx[i] * sc - R, fy[i] * sc - R, R * 2, R * 2);
      var img = wx.getImageData(0, 0, lw, lh), d = img.data, px, py, xx, yy;
      for (i = 0; i < n; i++) if (tp[i] === ty && sl[i] && nc[i] >= 11) {
        px = (fx[i] * sc) | 0; py = (fy[i] * sc) | 0;
        for (yy = py - hs; yy <= py + hs; yy++) { if (yy < 0 || yy >= lh) continue; for (xx = px - hs; xx <= px + hs; xx++) if (xx >= 0 && xx < lw) d[(yy * lw + xx) * 4 + 3] = 255; }
      }
      s.st.top = LIQ[ty].wg && !(cnt[1] || cnt[2]) ? s.top : null; s.st.T = T; s.st.flip = s.grav < 0; s.st.amb = !calm() && s.grav > 0;
      shadeLiquid(d, lw, lh, LIQ[ty], s.lut[ty], s.st);
      wx.putImageData(img, 0, 0);
      c.imageSmoothingEnabled = true; c.drawImage(s.wc, 0, 0, lw, lh, 0, 0, s.W, s.H);
    }
    /* single drops and splash foam */
    for (i = 0; i < n; i++) {
      var sp2 = f.vx[i] * f.vx[i] + f.vy[i] * f.vy[i], t2 = tp[i];
      if (nc[i] < 3) { c.beginPath(); c.arc(fx[i], fy[i], 2.6, 0, 6.2832); c.fillStyle = t2 === 2 ? '#ff7a1a' : t2 === 1 ? '#b9822b' : 'rgba(80,175,255,.9)'; c.fill(); c.beginPath(); c.arc(fx[i] - 0.8, fy[i] - 0.8, 0.9, 0, 6.2832); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill(); }
      else if (t2 === 0 && sp2 > 160000 && nc[i] < 9) { c.beginPath(); c.arc(fx[i], fy[i], 1.7, 0, 6.2832); c.fillStyle = 'rgba(255,255,255,.65)'; c.fill(); }
    }
  }
  function drawDevices(c) {
    var s = S;
    s.faucets.forEach(function (fc) {
      var col = LIQ[fc.t].dot; c.fillStyle = '#64748b'; c.strokeStyle = '#334155'; c.lineWidth = 2;
      c.beginPath(); c.rect(fc.x - 40, fc.y - 12, 36, 12); c.fill(); c.stroke(); c.beginPath(); c.rect(fc.x - 12, fc.y - 6, 20, 12); c.fill(); c.stroke();
      c.beginPath(); c.arc(fc.x - 2, fc.y + 6, 4, 0, 6.2832); c.fillStyle = col; c.fill(); c.beginPath(); c.arc(fc.x - 28, fc.y - 12, 5, 0, 6.2832); c.fillStyle = '#ef4444'; c.fill();
    });
    s.fans.forEach(function (fan) {
      c.save(); c.translate(fan.x, fan.y); c.rotate(fan.a); c.fillStyle = '#475569'; c.strokeStyle = '#1e293b'; c.lineWidth = 2; c.beginPath(); c.rect(-14, -20, 22, 40); c.fill(); c.stroke();
      c.rotate(s.tt * 0.03); c.fillStyle = '#cbd5e1'; for (var k = 0; k < 4; k++) { c.rotate(1.5708); c.beginPath(); c.ellipse(9, 0, 9, 3.4, 0, 0, 6.2832); c.fill(); } c.beginPath(); c.arc(0, 0, 3, 0, 6.2832); c.fillStyle = '#0f172a'; c.fill(); c.restore();
    });
    if (s.tool === 'magnet' && s.pid !== null) {
      c.beginPath(); c.arc(s.pp.x, s.pp.y, 340 * (0.9 + 0.1 * Math.sin(s.tt * 0.01)), 0, 6.2832); c.strokeStyle = 'rgba(239,68,68,.22)'; c.lineWidth = 2; c.setLineDash([6, 8]); c.stroke(); c.setLineDash([]);
      c.fillStyle = '#ef4444'; c.fillRect(s.pp.x - 12, s.pp.y - 8, 8, 16); c.fillStyle = '#e5e7eb'; c.fillRect(s.pp.x + 4, s.pp.y - 8, 8, 16);
    }
  }
  function draw() {
    var s = S, c = s.ctx, W = s.W, H = s.H, i, id; if (!W) return;
    c.setTransform(s.dpr, 0, 0, s.dpr, 0, 0); c.clearRect(0, 0, W, H); c.fillStyle = s.bg; c.fillRect(0, 0, W, H);
    c.strokeStyle = s.gridc; c.lineWidth = 1; c.beginPath(); for (i = 40; i < W; i += 40) { c.moveTo(i + 0.5, 0); c.lineTo(i + 0.5, H); } for (i = 40; i < H; i += 40) { c.moveTo(0, i + 0.5); c.lineTo(W, i + 0.5); } c.stroke();
    c.save(); if (s.shake > 0.3) c.translate((rnd() - 0.5) * s.shake, (rnd() - 0.5) * s.shake);
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (id in s.ropes) {
      var nd = s.ropes[id].nodes; c.beginPath(); c.moveTo(nd[0].position.x, nd[0].position.y); for (i = 1; i < nd.length; i++) c.lineTo(nd[i].position.x, nd[i].position.y);
      c.lineWidth = 6; c.strokeStyle = '#7a4a1f'; c.stroke(); c.lineWidth = 3; c.strokeStyle = '#d9a066'; c.stroke();
    }
    M.Composite.allBodies(s.world).forEach(function (b) { if (!b.wall && !b.rope) drawBody(c, b); });
    drawLiquid(c);
    drawDevices(c);
    M.Composite.allConstraints(s.world).forEach(function (k) {
      var e, kd = k.kind; if (!kd || kd === 'rseg') return; e = endsOf(k);
      if (kd === 'rod') { c.beginPath(); c.moveTo(e.a.x, e.a.y); c.lineTo(e.b.x, e.b.y); c.lineWidth = 6; c.strokeStyle = '#475569'; c.stroke(); c.lineWidth = 2.5; c.strokeStyle = '#cbd5e1'; c.stroke(); nail(c, e.a); nail(c, e.b); }
      else if (kd === 'spring') { c.lineWidth = 3; c.strokeStyle = '#a855f7'; coil(c, e.a, e.b); nail(c, e.a); nail(c, e.b); }
      else if (kd === 'pin') nail(c, k.pointB);
      else if (kd === 'glue') { c.beginPath(); c.arc(e.a.x, e.a.y, 4, 0, 6.2832); c.fillStyle = '#facc15'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,.5)'; c.stroke(); }
      else if (kd === 'rend') { if (!k.bodyA) nail(c, e.a); else { c.beginPath(); c.arc(e.a.x, e.a.y, 3, 0, 6.2832); c.fillStyle = '#475569'; c.fill(); } }
      else if (kd === 'grab') { c.beginPath(); c.moveTo(e.a.x, e.a.y); c.lineTo(e.b.x, e.b.y); c.lineWidth = 2; c.strokeStyle = 'rgba(100,116,139,.9)'; c.setLineDash([4, 4]); c.stroke(); c.setLineDash([]); }
    });
    if (s.line) {
      var L = s.line, T = s.tool;
      c.beginPath(); c.moveTo(L.a.x, L.a.y); c.lineTo(s.pp.x, s.pp.y); c.lineWidth = (T === 'platform' || T === 'pad') ? 14 : 4;
      c.strokeStyle = (T === 'platform' || T === 'pad') ? 'rgba(100,116,139,.5)' : T === 'spring' ? 'rgba(168,85,247,.7)' : T === 'glue' ? 'rgba(250,204,21,.8)' : T === 'fan' ? 'rgba(56,189,248,.7)' : 'rgba(180,120,60,.7)'; c.setLineDash((T === 'platform' || T === 'pad') ? [] : [6, 6]); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(L.a.x, L.a.y, L.ta ? 7 : 4, 0, 6.2832); c.fillStyle = L.ta ? '#22c55e' : '#94a3b8'; c.fill();
    }
    s.fx.forEach(function (f) {
      if (f.t === 'ring') { var r = f.R * (1 - Math.pow(f.l, 2.2)); c.beginPath(); c.arc(f.x, f.y, r, 0, 6.2832); c.lineWidth = 2 + 10 * f.l; c.strokeStyle = 'rgba(255,196,90,' + (f.l * 0.8) + ')'; c.stroke(); }
      else if (f.t === 'flash') { var g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.R); g.addColorStop(0, 'rgba(255,245,200,' + f.l + ')'); g.addColorStop(0.4, 'rgba(255,160,60,' + f.l * 0.55 + ')'); g.addColorStop(1, 'rgba(255,90,40,0)'); c.fillStyle = g; c.beginPath(); c.arc(f.x, f.y, f.R, 0, 6.2832); c.fill(); }
      else if (f.t === 'sp') { c.beginPath(); c.arc(f.x, f.y, 1.5 + 2 * f.l, 0, 6.2832); c.globalAlpha = Math.min(1, f.l * 1.5); c.fillStyle = f.c; c.fill(); c.globalAlpha = 1; }
      else if (f.t === 'sm') { c.beginPath(); c.arc(f.x, f.y, f.r, 0, 6.2832); c.fillStyle = 'rgba(70,70,80,' + (f.l * 0.28) + ')'; c.fill(); }
      else if (f.t === 'wd') { c.beginPath(); c.moveTo(f.x, f.y); c.lineTo(f.x - f.vx * 2.2, f.y - f.vy * 2.2); c.lineWidth = 2; c.strokeStyle = 'rgba(120,180,255,' + (f.l * 0.5) + ')'; c.stroke(); }
    });
    c.restore();
  }

  window.SpectraPhys = { mount: mount, unmount: unmount };
})();
