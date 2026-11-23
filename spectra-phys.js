/* Spectra Physics Sandbox (v7) for the Spectra Academics Lab.
   v7 (Phase 3): initiators. Toggle (tap it with Grab) and Collision initiators send a signal to a group; a Move initiator listens for that signal (or sim start) and moves a whole group along
   keyframes (time, X, Y, turn, easing) with a timeline editor in the Properties board. Loop modes, speed, what happens when the signal ends, safe squish. A placeable Initiator block in Special.
   Moving objects are kinematic. Initiators only run while the sandbox is running. Rewind resets them. Two demo scenes: Door switch and Elevator.
   v6 (Phase 2): object menu (hold an object on a phone, right-click on a computer): Properties, About, Ask Spectra, Delete. The Properties board (side panel on a computer,
   bottom sheet on a phone) edits group IDs (an object can be in several groups), bounciness and friction, and lists initiators (they arrive in Phase 3). About explains the physics of the object.
   v5 (Phase 1): category tabs (Blocks, Items, Special, Liquids, Tools). Blocks work as pick a block, then pick a shape. New blocks: Stone, Concrete, Metal (was Steel),
   Obsidian, Copper Block, Gold, Asphalt, each with density, bounciness, friction, health and flags (flammable, magnetic, lava-proof, melts). A stats card shows them.
   v4 (Phase 0): every block, item, liquid and tool now comes from the data tables near the top of this file, every object gets a props record
   (material, health, group ids, initiators) for the coming Properties board, and the scale is 100 px = 1 m. Nothing changes on screen.
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
  var LIQ = [
    { id: 'water', n: 'Water', c0: [120, 205, 255], c1: [10, 56, 160], g: 1, v: 0.05, a: 0.84, a0: 0.62, dl: 95, sg: 1, wg: 1, dot: '#38a0ff' },
    { id: 'oil', n: 'Oil', c0: [214, 168, 70], c1: [96, 58, 14], g: 0.3, v: 0.4, a: 0.92, a0: 0.8, dl: 80, sg: 0.25, wg: 0, dot: '#b9822b' },
    { id: 'lava', n: 'Lava', c0: [255, 226, 110], c1: [200, 38, 8], g: 1.15, v: 0.6, a: 1, a0: 1, dl: 60, sg: 0, wg: 0, dot: '#ff6a1a' }
  ];
  /* liquids: g = gravity multiplier (oil is lighter so it floats on water), v = thickness, c0/c1 = surface and deep colour, a = opacity, dl = how fast it darkens with depth, sg = light shafts, wg = surface ripples */
  var TG = LIQ.map(function (l) { return l.g; }), TV = LIQ.map(function (l) { return l.v; });

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
    rain: 'M7 14a4 4 0 112-7.5A5 5 0 1118 14zM8 17l-1 3M12 17l-1 3M16 17l-1 3', drain: 'M12 4v10M8 11l4 4 4-4M5 19h14',
    info: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v5M12 8h.01', sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4', x: 'M6 6l12 12M18 6L6 18', bolt: 'M13 3L5 14h6l-1 7 8-11h-6z', node: 'M13 3L5 14h6l-1 7 8-11h-6z', rewind: 'M11 6L4 12l7 6zM20 6l-7 6 7 6z', plus: 'M12 5v14M5 12h14'
  };
  var ic = function (n, s) { return '<svg viewBox="0 0 24 24" width="' + (s || 18) + '" height="' + (s || 18) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICO[n] + '"/></svg>'; };

  /* ================= DATA TABLES =================
     Everything the sandbox knows about its blocks, items, liquids and tools is listed here, so adding a new one is one table entry. */
  var PX_M = 100;   // scale: 100 px = 1 m, so the sandbox gravity of 1000 px/s^2 is 10 m/s^2
  var m2px = function (m) { return m * PX_M; }, px2m = function (px) { return px / PX_M; };
  var CATS = [{ id: 'block', n: 'Blocks' }, { id: 'item', n: 'Items' }, { id: 'special', n: 'Special' }, { id: 'liquid', n: 'Liquids' }, { id: 'tool', n: 'Tools' }];

  /* blocks (materials): d = density in Matter units (water is 0.001, so lighter floats and heavier sinks), r = bounciness, f = friction, c = colour,
     hp = health (for the breakage phase, tunable), flam = burns, mag = pulled by the magnet, melts = turns into water in lava, lava = lava-proof,
     smelt = melts slowly (used by the fire phase), fs = static friction (grip when resting), sh = shine, note = one line shown on the stats card */
  var MATS = [
    { id: 'wood', n: 'Wood', d: 0.0007, r: 0.2, f: 0.6, c: '#c68b59', hp: 60, flam: 1, note: 'Lighter than water, so it floats. It also burns.' },
    { id: 'stone', n: 'Stone', d: 0.0026, r: 0.1, f: 0.7, c: '#9a9fa8', hp: 220, note: 'Heavy and tough. It sinks fast.' },
    { id: 'concrete', n: 'Concrete', d: 0.0034, r: 0.05, f: 0.95, fs: 1.2, c: '#b7b2a7', hp: 380, note: 'Heavier than stone, with a lot of grip.' },
    { id: 'metal', n: 'Metal', d: 0.008, r: 0.1, f: 0.3, c: '#8b98a8', hp: 450, mag: 1, smelt: 1, sh: 0.9, note: 'Very heavy. The magnet pulls it, and it melts slowly in lava.' },
    { id: 'obsidian', n: 'Obsidian', d: 0.0028, r: 0.06, f: 0.4, c: '#2e2142', hp: 1500, lava: 1, sh: 1, note: 'Volcanic glass: very hard, and lava cannot hurt it.' },
    { id: 'copper', n: 'Copper Block', d: 0.0086, r: 0.15, f: 0.35, c: '#d17b4a', hp: 320, mag: 1, sh: 0.8, note: 'Heavy and metal-like. The magnet pulls it here.' },
    { id: 'gold', n: 'Gold', d: 0.0135, r: 0.1, f: 0.4, c: '#f2c230', hp: 90, sh: 1, note: 'The densest block. Soft, so it breaks easily, and it sinks fastest.' },
    { id: 'asphalt', n: 'Asphalt', d: 0.0022, r: 0.02, f: 1.3, fs: 3, c: '#3a3d44', hp: 240, note: 'Very grippy: it barely slides, even on a slope.' },
    { id: 'rubber', n: 'Rubber', d: 0.0012, r: 0.85, f: 0.9, c: '#ef4444', hp: 120, flam: 1, note: 'Very bouncy and grippy. It burns.' },
    { id: 'ice', n: 'Ice', d: 0.0009, r: 0.1, f: 0.02, c: '#8fd8ff', hp: 40, melts: 1, note: 'Almost no friction, and just light enough to float. It melts in lava.' },
    { id: 'foam', n: 'Foam', d: 0.0002, r: 0.3, f: 0.5, c: '#fbbf24', hp: 25, flam: 1, note: 'Super light, so it floats high. It burns.' }
  ];
  var MAT = {}; MATS.forEach(function (m) { MAT[m.id] = m; });
  /* object menu and About board: names, a fact per block, and a physics note per item */
  var SHAPE = { box: 'box', plank: 'plank', ball: 'ball', tri: 'triangle', hex: 'hexagon', wheel: 'wheel', platform: 'ramp' };
  var KINDN = { balloon: 'Balloon', tnt: 'TNT crate', rocket: 'Rocket', bomb: 'Bomb', wheelx: 'Paddle wheel', pad: 'Bounce pad', node: 'Initiator' };
  var KFLAGS = { balloon: ['Lighter than air', 'Pops'], tnt: ['Explosive'], rocket: ['Thrust'], bomb: ['Explosive', 'Fuse'], wheelx: ['Spins'], pad: ['Bouncy'] };
  var FACT = {
    wood: 'Wood is full of tiny air-filled cells, which is why it is light. It burns because it is mostly cellulose and lignin.',
    stone: 'Rock is packed mineral crystal with almost no gaps, so even a small piece is heavy.',
    concrete: 'Concrete is cement, sand and gravel. The rough, gritty surface creates a lot of friction.',
    metal: 'Metals pack their atoms tightly, so they are dense. Iron-based metals are ferromagnetic, which is why a magnet pulls on them.',
    obsidian: 'Obsidian is volcanic glass. Lava cooled so fast that crystals had no time to grow, which makes it hard and sharp.',
    copper: 'Copper carries heat and electricity very well. Real copper is not ferromagnetic, but in this sandbox the magnet pulls it so you can compare it with other metals.',
    gold: 'Real gold is about 19,300 kg/m\u00b3, one of the densest common metals. Here the numbers are scaled down, but it is still the heaviest block, and it is soft.',
    asphalt: 'Asphalt is gravel held together by sticky bitumen. The rough surface gives tyres strong grip.',
    rubber: 'Rubber is made of long, stretchy molecules that spring back after a squash, which is why it bounces.',
    ice: 'Water molecules lock into an open crystal shape when they freeze, so ice is less dense than liquid water and floats, with about 90% underwater.',
    foam: 'Foam is mostly trapped air, which makes it extremely light.'
  };
  var ABOUT = {
    balloon: 'A balloon rises because it is lighter than the air it pushes aside. Buoyancy works in air just like in water. Tie a few to a box and see how many it takes to lift it.',
    tnt: 'TNT stores chemical energy. When it goes off, that energy becomes heat, sound and the kinetic energy of the blast. Things that are closer and lighter get thrown harder.',
    rocket: 'A rocket pushes hot gas backward, and by Newton\u2019s third law the gas pushes the rocket forward. That push is called thrust.',
    bomb: 'A bomb works like TNT, with a fuse. The blast pushes harder the closer something is, and lighter things fly further than heavy ones.',
    wheelx: 'A wheel on an axle turns a push into rotation. Water hitting the paddles transfers momentum to them and makes a torque (a turning force).',
    pad: 'This pad has a bounciness above 1, so things leave faster than they arrive. Real surfaces cannot do that unless something adds energy, like a spring.',
    platform: 'On a slope, gravity splits into a part along the slope (g sin \u03b8) and a part pressing into it (g cos \u03b8). Friction decides whether things slide down.',
    node: 'An initiator block links cause and effect. A Toggle or Collision initiator sends a signal to a group number, and a Move initiator listens for it. That is how real machines work: a sensor triggers an actuator.'
  };
  var GRAV = [['Earth', 1], ['Moon', 0.165], ['Mars', 0.38], ['Jupiter', 2.5], ['Zero-G', 0], ['Upside down', -1]];
  var TABICO = { block: 'box', item: 'rocket', special: 'spring', liquid: 'water', tool: 'magnet' }, DEFT = { block: 'box', item: 'wheel', special: 'rope', liquid: 'water', tool: 'drag' };
  var BAL = ['#ef4444', '#3b82f6', '#ec4899', '#facc15', '#22c55e', '#a855f7'];

  /* things that are not made of a chosen material, or have their own health: defaults by kind (anything else uses its material's health) */
  var OBJ = { balloon: { cat: 'item', hp: 3 }, tnt: { cat: 'item', hp: 40 }, rocket: { cat: 'item', hp: 60 }, bomb: { cat: 'item', hp: 80 }, wheelx: { cat: 'item', hp: 150 }, pad: { cat: 'special', hp: 200 }, node: { cat: 'special', hp: 200 } };

  /* every toolbar entry: id, name, category, toolbar group (g, the separators), hint line */
  var REG = [
    { id: 'drag', n: 'Grab', cat: 'tool', g: 0, tip: 'Drag anything to move or throw it. A fast fling gives it more kinetic energy. Hold an object (or right-click it) for its menu.' },
    { id: 'box', n: 'Box', cat: 'block', g: 1, tip: 'Tap to drop a box. Pick a block first: density decides what floats and what sinks.' },
    { id: 'plank', n: 'Plank', cat: 'block', g: 1, tip: 'Tap to drop a long plank. Great for seesaws, boats and bridges.' },
    { id: 'ball', n: 'Ball', cat: 'block', g: 1, tip: 'Tap to drop a ball. Rubber bounces, metal does not. That is the coefficient of restitution.' },
    { id: 'tri', n: 'Triangle', cat: 'block', g: 1, tip: 'Tap to drop a triangle.' },
    { id: 'hex', n: 'Hexagon', cat: 'block', g: 1, tip: 'Tap to drop a hexagon.' },
    { id: 'wheel', n: 'Wheel', cat: 'item', g: 1, tip: 'Tap to drop a wheel, made of the material chosen below. Nail it to the wall or add a Motor and it spins.' },
    { id: 'balloon', n: 'Balloon', cat: 'item', g: 2, tip: 'Tap to release a balloon. It is lighter than air, so it floats up. Tie a few to a box with rope and lift it.' },
    { id: 'tnt', n: 'TNT', cat: 'item', g: 2, tip: 'Tap to place a TNT crate. It blows up if a blast reaches it or it hits something hard. A fall from high up is enough.' },
    { id: 'rocket', n: 'Rocket', cat: 'item', g: 2, tip: 'Tap to place a rocket. It lights after half a second and pushes forward for a few seconds: thrust. Tilt it by dropping it on a ramp.' },
    { id: 'bomb', n: 'Bomb', cat: 'item', g: 2, tip: 'Tap to place a bomb. It explodes after 2 seconds. The blast pushes things away, harder when they are closer, and lighter things fly further.' },
    { id: 'water', n: 'Pour', cat: 'liquid', g: 3, tip: 'Hold and drag to pour. Pick Water, Oil or Lava below. Wood, ice and foam float on water; stone, metal and gold sink. Oil floats on water. Lava burns wood and melts ice.' },
    { id: 'faucet', n: 'Faucet', cat: 'special', g: 3, tip: 'Tap to place a faucet that keeps pouring the liquid chosen below. Put a wheel under it, or fill a pool.' },
    { id: 'rope', n: 'Rope', cat: 'special', g: 4, tip: 'Drag to draw a rope. Each end attaches to whatever object it touches, or to the wall. Pull on it and you feel tension.' },
    { id: 'rod', n: 'Rod', cat: 'special', g: 4, tip: 'Drag to add a rigid rod between two things (or a thing and the wall).' },
    { id: 'spring', n: 'Spring', cat: 'special', g: 4, tip: 'Drag to add a spring. The pull grows with the stretch (Hooke\u2019s law, F = k x).' },
    { id: 'glue', n: 'Glue', cat: 'special', g: 4, tip: 'Drag from one object to another to glue them together into one rigid piece.' },
    { id: 'pin', n: 'Nail', cat: 'special', g: 4, tip: 'Tap an object to nail it to the wall. It will swing around the nail like a pendulum.' },
    { id: 'motor', n: 'Motor', cat: 'special', g: 4, tip: 'Tap an object to nail it at its center and spin it. Tap again to reverse, once more to stop.' },
    { id: 'platform', n: 'Ramp', cat: 'special', g: 5, tip: 'Drag to build a fixed ramp or platform from the material chosen below. Ice is slippery, rubber grips.' },
    { id: 'pad', n: 'Bounce pad', cat: 'special', g: 5, tip: 'Drag to build a bouncy pad. Things leave it faster than they hit it.' },
    { id: 'fan', n: 'Fan', cat: 'special', g: 6, tip: 'Drag to place a fan and aim it. It blows objects and liquids along the wind. Lighter things get pushed more.' },
    { id: 'node', n: 'Initiator', cat: 'special', g: 6, tip: 'Tap to place a fixed Initiator block, then pick Toggle, Collision or Move below. Open its Properties to link it to groups. Tap a Toggle with Grab to flip it.' },
    { id: 'magnet', n: 'Magnet', cat: 'tool', g: 6, tip: 'Hold it near metal things (Metal and Copper Block) to pull them toward you.' },
    { id: 'boom', n: 'Explosion', cat: 'tool', g: 6, tip: 'Tap anywhere for an instant explosion.' },
    { id: 'erase', n: 'Erase', cat: 'tool', g: 7, tip: 'Tap things (or drag across them) to delete them. Tap a rope, rod, spring, fan or faucet to remove it.' }
  ];
  var INFO = {}, CATOF = {};
  REG.forEach(function (t) { INFO[t.id] = [t.id, t.n, t.tip]; CATOF[t.id] = t.cat; });
  var catTools = function (cat) { return REG.filter(function (t) { return t.cat === cat; }); };
  var hasMat = function (b, flag) { var m = MAT[b.matId]; return !!(m && m[flag]); };   // material flags: flam, mag, melts

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
    var chip = function (m, i) { return '<button type="button" class="ph-m' + (i ? '' : ' on') + '" data-pm="' + m.id + '" style="--c:' + m.c + '"><s></s>' + m.n + '</button>'; };
    var lchip = function (l, i) { return '<button type="button" class="ph-m' + (i ? '' : ' on') + '" data-pf="' + i + '" style="--c:' + l.dot + '"><s></s>' + l.n + '</button>'; };
    var itchip = function (t, i) { return '<button type="button" class="ph-m' + (i ? '' : ' on') + '" data-pi="' + t + '"><s style="--c:#f59e0b"></s>' + cap(INAME[t]) + '</button>'; };
    var tbtn = function (t) { return '<button type="button" class="ph-t" data-pt="' + t.id + '">' + ic(t.id, 20) + '<span>' + t.n + '</span></button>'; };
    h += '<div class="ph-tabs" id="phtabs" role="tablist" aria-label="Categories">' + CATS.map(function (c, i) { return '<button type="button" role="tab" class="ph-tab' + (i ? '' : ' on') + '" data-pc="' + c.id + '" aria-selected="' + (i ? 'false' : 'true') + '">' + ic(TABICO[c.id], 18) + '<span>' + c.n + '</span></button>'; }).join('') + '</div>';
    h += '<div class="ph-panels" id="phtools">' + CATS.map(function (c, i) {
      var p = '<div class="ph-pn" data-cat="' + c.id + '"' + (i ? ' hidden' : '') + '>';
      if (c.id === 'block') p += '<div class="ph-row"><span class="ph-rl">Block</span>' + MATS.map(chip).join('') + '</div><div class="ph-row"><span class="ph-rl">Shape</span>' + catTools('block').map(tbtn).join('') + '</div>';
      else if (c.id === 'liquid') p += '<div class="ph-row">' + catTools('liquid').map(tbtn).join('') + '<i class="ph-sep"></i>' + LIQ.map(lchip).join('') + '</div>';
      else {
        p += '<div class="ph-row">' + catTools(c.id).map(tbtn).join('') + '</div>';
        if (c.id === 'item') p += '<div class="ph-row ph-sub" data-for="wheel" hidden><span class="ph-rl">Material</span>' + MATS.map(chip).join('') + '</div>';
        if (c.id === 'special') p += '<div class="ph-row ph-sub" data-for="platform" hidden><span class="ph-rl">Material</span>' + MATS.map(chip).join('') + '</div><div class="ph-row ph-sub" data-for="faucet" hidden><span class="ph-rl">Liquid</span>' + LIQ.map(lchip).join('') + '</div><div class="ph-row ph-sub" data-for="node" hidden><span class="ph-rl">Type</span>' + ['toggle', 'collision', 'move'].map(itchip).join('') + '</div>';
      }
      return p + '</div>';
    }).join('') + '</div>';
    h += '<div class="ph-stage"><canvas id="phcv" aria-label="Physics sandbox"></canvas><div class="ph-chip" id="phchip"></div><div class="ph-load" id="phload">Loading the physics engine...</div><div class="ph-menu" id="phmenu" role="menu" hidden></div><aside class="ph-board" id="phbd" aria-label="Object properties" hidden></aside></div>';
    h += '<div class="ph-info" id="phinfo"></div><div class="ph-card" id="phstats" hidden></div>';
    h += '<div class="ph-ctl">' +
      '<label class="ph-grp">Size<input type="range" id="phsz" min="10" max="60" value="28" aria-label="Object size"></label>' +
      '<label class="ph-grp">Gravity<select id="phg" aria-label="Gravity">' + GRAV.map(function (g, i) { return '<option value="' + i + '">' + g[0] + '</option>'; }).join('') + '</select></label>' +
      '<label class="ph-grp">Speed<select id="phsp" aria-label="Speed"><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option></select></label>' +
      '<div class="ph-grp"><button type="button" class="ph-b" data-pa="pause" id="phpa">' + ic('pause', 16) + '<span>Pause</span></button><button type="button" class="ph-b" data-pa="rewind">' + ic('rewind', 16) + '<span>Rewind</span></button><button type="button" class="ph-b" data-pa="rain" id="phrn">' + ic('rain', 16) + '<span>Rain</span></button>' +
      '<button type="button" class="ph-b" data-pa="drain">' + ic('drain', 16) + '<span>Drain</span></button><button type="button" class="ph-b" data-pa="clear">' + ic('trash', 16) + '<span>Clear</span></button></div></div>';
    h += '<div class="ph-try"><b>Scenes:</b><button type="button" class="ph-b" data-sc="tower">Box tower</button><button type="button" class="ph-b" data-sc="pendulum">Pendulum</button><button type="button" class="ph-b" data-sc="pool">Float or sink?</button>' +
      '<button type="button" class="ph-b" data-sc="wheel">Water wheel</button><button type="button" class="ph-b" data-sc="lava">Lava lake</button><button type="button" class="ph-b" data-sc="lift">Balloon lift</button><button type="button" class="ph-b" data-sc="ocean">Ocean</button><button type="button" class="ph-b" data-sc="door">Door switch</button><button type="button" class="ph-b" data-sc="elev">Elevator</button>' +
      '<button type="button" class="ph-b ph-ask" data-pa="ask">' + ic('chat', 16) + '<span>Ask Spectra</span></button></div></div>';
    return h;
  }

  function mount(root, opts) {
    unmount(); O = opts || {};
    S = { root: root, tool: 'box', cat: 'block', tlast: {}, sel: null, mt: null, tab: 'props', hold: null, held: false, pend: null, ptype: '', initType: 'toggle', adding: false, sig: {}, tap: null, mat: 'wood', fluid: 0, size: 28, grav: 1, speed: 1, paused: false, rain: false, W: 0, H: 0, dpr: 1, acc: 0, last: 0, shake: 0, fx: [], ropes: {}, walls: [], faucets: [], fans: [], line: null, grab: null, pid: null, pp: { x: 0, y: 0 }, pour: false, pourAcc: 0, frame: 0, tt: 0, full: 0, bg: '#f3f4f6', gridc: 'rgba(120,120,140,.18)' };
    root.innerHTML = shellHtml();
    var s = S, wrap = root.querySelector('.ph-wrap');
    wrap.addEventListener('pointerdown', onKd); wrap.addEventListener('click', onClick); wrap.addEventListener('change', onChange); wrap.addEventListener('input', onChange);
    s.onk = function (e) { if (e.code === 'Escape') { if (s.mt) closeMenu(); else if (s.sel) closeBoard(); return; } if (e.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test((e.target || {}).tagName || '')) { e.preventDefault(); togglePause(); } };
    document.addEventListener('keydown', s.onk);
    setTool('box');
    loadM().then(function () { if (S === s) boot(); }).catch(function () { var l = $('#phload'); if (l && S === s) l.textContent = 'Could not load the physics engine. Check your connection, then open the sandbox again.'; });
  }

  function unmount() {
    var s = S; if (!s) return; S = null;
    cancelAnimationFrame(s.raf); if (s.hold) clearTimeout(s.hold.id); if (s.ro) s.ro.disconnect(); if (s.onr) window.removeEventListener('resize', s.onr); if (s.onk) document.removeEventListener('keydown', s.onk);
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
    M.Events.on(s.eng, 'collisionStart', touchEv); M.Events.on(s.eng, 'collisionActive', touchEv);
    s.cv.addEventListener('pointerdown', down); s.cv.addEventListener('pointermove', move); s.cv.addEventListener('pointerup', up); s.cv.addEventListener('pointercancel', up);
    s.cv.addEventListener('contextmenu', onCtx);
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
    var o = { friction: m.f, restitution: m.r, density: m.d, frictionAir: 0.01, sleepThreshold: Infinity }; if (m.fs) o.frictionStatic = m.fs; for (var k in extra) o[k] = extra[k]; return o;
  }
  function objCount() { return M.Composite.allBodies(S.world).filter(function (b) { return !b.wall && !b.rope; }).length; }
  /* every object carries a props record: what it is, its health, and the group ids and initiators the Properties board will edit.
     It is filled in the first time it is read (a bomb or TNT gets its kind a moment after it is added) */
  function propsOf(b) {
    var p = b.props || (b.props = { groups: [], inits: [] });
    if (p.cat === undefined) {
      var k = b.kind, d = OBJ[k] || {}, m = MAT[b.matId], hp = d.hp != null ? d.hp : m ? m.hp : 0;
      p.cat = d.cat || CATOF[k] || 'block'; p.kind = k || null; p.mat = b.matId || null; p.hp = hp; p.hpMax = hp;
    }
    return p;
  }
  function addB(b) { if (!b.props) b.props = { groups: [], inits: [] }; M.Composite.add(S.world, b); return b; }
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
    var p = M.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len, pad ? 12 : 14, { isStatic: true, friction: pad ? 0.2 : m.f, frictionStatic: pad ? 0.5 : (m.fs || 0.5), restitution: pad ? 1.1 : m.r, angle: Math.atan2(b.y - a.y, b.x - a.x) });
    p.col = pad ? '#22c55e' : m.c; p.kind = pad ? 'pad' : 'platform'; if (!pad) p.matId = m.id; addB(p); return p;
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
    s.fl.clear(); s.stat = {}; s.sig = {}; s.ropes = {}; s.fx = []; s.faucets = []; s.fans = []; s.grab = null; s.line = null; s.pour = false;
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

  /* ================= initiators (Phase 3) =================
     Everything links by group ID. A Toggle or Collision initiator SENDS a signal to a group number (a channel).
     A Move initiator LISTENS to a channel (or to sim start) and moves every object that is in its target group, following keyframes.
     Moving objects are kinematic: scripted, they shove other things but nothing shoves them back. Initiators only run while the sandbox is running. */
  var INAME = { toggle: 'Toggle', collision: 'Collision', move: 'Move' };
  var NODEHINT = { toggle: 'Switch placed: tap it with Grab to flip it. Pick which group it signals in the board', collision: 'Pressure plate placed: it signals while something touches it', move: 'Mover placed: set what starts it and which group it moves' };
  var MAXINIT = 6;
  function newInit(type) {
    var o = { id: ++uid, type: type, to: 1 };
    if (type === 'toggle') o.on = false;
    else if (type === 'collision') { o.latch = false; o.latched = false; o.last = -1e9; }
    else { o.type = 'move'; o.from = 1; o.to = 2; o.dur = 4; o.kf = [{ t: 2, x: 100, y: 0, r: 0, e: 'smooth' }]; o.ks = 0; o.loop = 'once'; o.off = 'back'; o.speed = 1; o.safe = true; o.rt = { t: 0, dir: 0, pon: false, back: false, fin: false }; o.cur = { x: 0, y: 0, r: 0 }; }
    return o;
  }
  var colOn = function (i) { return i.latch ? i.latched : (S.tt - i.last) < 220; };
  function ease(e, u) {
    if (e === 'smooth') return u * u * (3 - 2 * u);
    if (e === 'bounce') { var n = 7.5625, d = 2.75; if (u < 1 / d) return n * u * u; if (u < 2 / d) { u -= 1.5 / d; return n * u * u + 0.75; } if (u < 2.5 / d) { u -= 2.25 / d; return n * u * u + 0.9375; } u -= 2.625 / d; return n * u * u + 0.984375; }
    return u;
  }
  function poseAt(ini, t) {   // the offset (px, px, degrees) at time t: start pose is 0, then keyframe to keyframe; after the last keyframe it holds
    var k = ini.kf, prev = { t: 0, x: 0, y: 0, r: 0 }, i, b, u;
    for (i = 0; i < k.length; i++) {
      b = k[i]; if (t <= b.t) { u = b.t > prev.t ? (t - prev.t) / (b.t - prev.t) : 1; u = ease(b.e, Math.max(0, Math.min(1, u))); return { x: prev.x + (b.x - prev.x) * u, y: prev.y + (b.y - prev.y) * u, r: prev.r + (b.r - prev.r) * u }; }
      prev = b;
    }
    return { x: prev.x, y: prev.y, r: prev.r };
  }
  function moveTick(ini, dtS, sig) {
    var rt = ini.rt, on = ini.from === 0 ? true : !!sig[ini.from], dur = Math.max(0.2, ini.dur);
    if (on && !rt.pon) { rt.back = false; rt.fin = false; if (rt.dir === 0 && rt.t >= dur - 1e-6) rt.t = 0; rt.dir = 1; }
    else if (!on && rt.pon) { if (ini.off === 'back') { rt.dir = -1; rt.back = true; } else if (ini.off === 'finish') rt.fin = true; else rt.dir = 0; }
    rt.pon = on;
    if (rt.dir) {
      rt.t += rt.dir * dtS * ini.speed;
      if (rt.t >= dur) { if (rt.fin) { rt.t = dur; rt.dir = 0; rt.fin = false; } else if (ini.loop === 'loop') rt.t -= dur; else if (ini.loop === 'ping') { rt.t = dur; rt.dir = -1; } else { rt.t = dur; rt.dir = 0; } }
      else if (rt.t <= 0) { if (ini.loop === 'ping' && !rt.back && !rt.fin) { rt.t = 0; rt.dir = 1; } else { rt.t = 0; rt.dir = 0; rt.back = false; rt.fin = false; } }
    }
    ini.cur = poseAt(ini, rt.t);
  }
  /* a body that is moved by a script gets a huge mass and no spin, so things bump off it but it never gives way */
  function takeOver(b, ox, oy, orr) {
    var st = b.isStatic; if (st) M.Body.setStatic(b, false);
    b.mv = { hx: b.position.x - ox, hy: b.position.y - oy, ha: b.angle - orr * Math.PI / 180, st: st, m: b.mass, inr: b.inertia, fa: b.fa0 };
    M.Body.setMass(b, 500000); M.Body.setInertia(b, Infinity); b.fa0 = 0.000001;
  }
  function giveBack(b) {
    var mv = b.mv; delete b.mv; M.Body.setMass(b, mv.m); M.Body.setInertia(b, mv.inr); b.fa0 = mv.fa;
    M.Body.setVelocity(b, { x: 0, y: 0 }); M.Body.setAngularVelocity(b, 0); if (mv.st) M.Body.setStatic(b, true);
  }
  function kin(b, tx, ty, ta, cap) {   // step toward the target pose, at most cap px per step (the safe-squish speed limit)
    var dx = tx - b.position.x, dy = ty - b.position.y, da = ta - b.angle, d = Math.hypot(dx, dy), ca = cap * 0.008;
    if (d > cap) { dx *= cap / d; dy *= cap / d; } if (da > ca) da = ca; else if (da < -ca) da = -ca;
    b.positionPrev.x = b.position.x - dx; b.positionPrev.y = b.position.y - dy; b.anglePrev = b.angle - da;
  }
  function moversStep(bodies, dt) {
    var s = S, dtS = dt / 1000, movers = [], sig = {};
    bodies.forEach(function (b) {
      var ii = b.props && b.props.inits; if (!ii || !ii.length || b.gone) return;
      ii.forEach(function (i) { if (i.type === 'toggle' ? i.on : i.type === 'collision' ? colOn(i) : false) sig[i.to] = 1; });
    });
    s.sig = sig;
    bodies.forEach(function (b) {
      var ii = b.props && b.props.inits; if (!ii || !ii.length || b.gone) return;
      ii.forEach(function (i) { if (i.type === 'move') { moveTick(i, dtS, sig); movers.push(i); } });
    });
    bodies.forEach(function (b) {
      if (b.wall || b.rope || b.gone) return;
      var g = b.props && b.props.groups, ox = 0, oy = 0, orr = 0, hit = false, safe = true;
      if (g && g.length && movers.length) movers.forEach(function (i) { if (g.indexOf(i.to) >= 0) { hit = true; ox += i.cur.x; oy += i.cur.y; orr += i.cur.r; if (!i.safe) safe = false; } });
      if (hit) { if (!b.mv) takeOver(b, ox, oy, orr); kin(b, b.mv.hx + ox, b.mv.hy + oy, b.mv.ha + orr * Math.PI / 180, safe ? 4 : 12); }
      else if (b.mv) giveBack(b);
    });
  }
  function touchEv(ev) {   // collision initiators: something (not a wall, not a fixed thing) touches the object
    ev.pairs.forEach(function (p) {
      var a = p.bodyA.parent || p.bodyA, b = p.bodyB.parent || p.bodyB;
      [[a, b], [b, a]].forEach(function (q) {
        var x = q[0], o = q[1], ii = x.props && x.props.inits; if (!ii || !ii.length || o.wall || o.isStatic) return;
        ii.forEach(function (i) { if (i.type === 'collision') { i.last = S.tt; if (i.latch) i.latched = true; } });
      });
    });
  }
  function flipToggles(b) {
    var ii = b.props && b.props.inits, any = null; if (!ii) return;
    ii.forEach(function (i) { if (i.type === 'toggle') { i.on = !i.on; any = i; } });
    if (any) { toast(any.on ? 'Switch ON \u00b7 signal sent to group ' + any.to : 'Switch OFF'); if (S.sel === b) renderBoard(); }
  }
  function rewind() {
    var s = S; if (!s || !s.eng) return; var bodies = M.Composite.allBodies(s.world);
    bodies.forEach(function (b) {
      var ii = b.props && b.props.inits; if (!ii) return;
      ii.forEach(function (i) {
        if (i.type === 'toggle') i.on = false; else if (i.type === 'collision') { i.latched = false; i.last = -1e9; }
        else if (i.type === 'move') { i.rt = { t: 0, dir: 0, pon: false, back: false, fin: false }; i.cur = { x: 0, y: 0, r: 0 }; }
      });
    });
    bodies.forEach(function (b) { if (b.mv) { M.Body.setPosition(b, { x: b.mv.hx, y: b.mv.hy }); M.Body.setAngle(b, b.mv.ha); M.Body.setVelocity(b, { x: 0, y: 0 }); M.Body.setAngularVelocity(b, 0); } });
    s.sig = {}; if (s.sel) renderBoard(); toast('Initiators rewound');
  }
  function mkNode(p, type) {
    if (full()) return null;
    var b = M.Bodies.rectangle(p.x, p.y, 30, 30, { isStatic: true, friction: 0.6, restitution: 0.1, chamfer: { radius: 7 } });
    b.col = '#f59e0b'; b.kind = 'node'; addB(b); propsOf(b).inits.push(newInit(type || S.initType)); return b;
  }
  function mkSolid(x, y, w, h, matId) {   // a fixed block of a material (used by the demo scenes)
    var m = MAT[matId] || MAT.stone, b = M.Bodies.rectangle(x, y, w, h, { isStatic: true, friction: m.f, frictionStatic: m.fs || 0.5, restitution: m.r });
    b.col = m.c; b.kind = 'platform'; b.matId = m.id; return addB(b);
  }

  /* ---- the initiator cards inside the Properties board ---- */
  var gsel = function (fld, val, ii, zero) {
    var o = '', i; if (zero) o += '<option value="0"' + (val === 0 ? ' selected' : '') + '>Sim start</option>';
    for (i = 1; i <= 12; i++) o += '<option value="' + i + '"' + (val === i ? ' selected' : '') + '>' + (zero ? 'Signal from group ' : 'Group ') + i + '</option>';
    return '<select class="ph-sel" data-fld="' + fld + '" data-ii="' + ii + '" aria-label="' + fld + '">' + o + '</select>';
  };
  var ssel = function (fld, val, ii, opts) { return '<select class="ph-sel" data-fld="' + fld + '" data-ii="' + ii + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (val === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
  var fr = function (label, ctl) { return '<label class="ph-fr"><span>' + label + '</span>' + ctl + '</label>'; };
  function tlHtml(ini, ii) {
    var dur = ini.dur, h = '<div class="ph-tl"><div class="ph-tk" data-ii="' + ii + '">';
    ini.kf.forEach(function (kf, k) { h += '<button type="button" class="ph-kd' + (ini.ks === k ? ' on' : '') + '" data-kd="' + k + '" data-ii="' + ii + '" style="--f:' + (kf.t / dur).toFixed(4) + '" aria-label="Keyframe ' + (k + 1) + ' at ' + kf.t + ' seconds"></button>'; });
    h += '<b class="ph-ph" data-ph="' + ii + '" style="--f:' + Math.min(1, ini.rt.t / dur).toFixed(4) + '"></b></div><div class="ph-tlr"><span>0 s</span><span>' + dur + ' s</span></div></div>';
    var kf = ini.kf[ini.ks];
    if (kf) {
      var ni = function (p, lbl, step, v) { return '<label class="ph-kf"><span>' + lbl + '</span><input type="number" step="' + step + '" value="' + v + '" data-kp="' + p + '" data-ii="' + ii + '" data-k="' + ini.ks + '" inputmode="decimal"></label>'; };
      h += '<div class="ph-kg">' + ni('t', 'Time (s)', 0.05, kf.t) + ni('x', 'X (px)', 5, Math.round(kf.x)) + ni('y', 'Y (px)', 5, Math.round(kf.y)) + ni('r', 'Turn (\u00b0)', 5, Math.round(kf.r)) +
        '<label class="ph-kf"><span>Easing</span><select class="ph-sel" data-kp="e" data-ii="' + ii + '" data-k="' + ini.ks + '">' + [['linear', 'Linear'], ['smooth', 'Smooth'], ['bounce', 'Bounce']].map(function (o) { return '<option value="' + o[0] + '"' + (kf.e === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
        '<button type="button" class="ph-b dg" data-bd="kdel" data-ii="' + ii + '" data-k="' + ini.ks + '">' + ic('trash', 15) + '<span>Delete</span></button></div>';
    } else h += '<p class="ph-bn">No keyframes yet. Add one to make it move.</p>';
    return h + '<div class="ph-rowb"><button type="button" class="ph-b" data-bd="kadd" data-ii="' + ii + '">' + ic('plus', 15) + '<span>Add keyframe</span></button></div>';
  }
  function initCard(ini, ii) {
    var st = ini.type === 'toggle' ? (ini.on ? 'ON' : 'OFF') : ini.type === 'collision' ? (colOn(ini) ? 'Touched' : 'Idle') : (ini.rt.dir ? 'Moving' : 'Idle');
    var h = '<div class="ph-in"><div class="ph-ih"><b>' + INAME[ini.type] + '</b><span class="ph-ist' + (st === 'ON' || st === 'Touched' || st === 'Moving' ? ' on' : '') + '">' + st + '</span><button type="button" class="ph-x sm" data-bd="idel" data-ii="' + ii + '" aria-label="Remove initiator">' + ic('x', 15) + '</button></div>';
    if (ini.type === 'toggle') h += '<p class="ph-bn">An on/off switch. Tap it with Grab to flip it.</p>' + fr('Sends to', gsel('to', ini.to, ii)) + '<div class="ph-rowb"><button type="button" class="ph-b" data-bd="iflip" data-ii="' + ii + '">' + ic('bolt', 15) + '<span>Flip now</span></button></div>';
    else if (ini.type === 'collision') h += '<p class="ph-bn">Sends ON while something touches it. Fixed things and walls do not count.</p>' + fr('Sends to', gsel('to', ini.to, ii)) +
      '<label class="ph-ck"><input type="checkbox" data-fld="latch" data-ii="' + ii + '"' + (ini.latch ? ' checked' : '') + '><span>Stay on after the first touch</span></label>';
    else {
      h += '<p class="ph-bn">Moves every object in the target group. Values are distances in px (100 px = 1 m); each object turns around its own center.</p>' +
        fr('Starts on', gsel('from', ini.from, ii, true)) + fr('Moves group', gsel('to', ini.to, ii)) + tlHtml(ini, ii) +
        '<label class="ph-fr"><span>Length</span><input type="range" min="1" max="20" step="0.5" value="' + ini.dur + '" data-fld="dur" data-ii="' + ii + '"><b class="ph-rv" id="phv-dur' + ii + '">' + ini.dur + ' s</b></label>' +
        fr('Loop', ssel('loop', ini.loop, ii, [['once', 'Once'], ['loop', 'Loop'], ['ping', 'Ping-pong']])) +
        fr('When signal ends', ssel('off', ini.off, ii, [['back', 'Go back to start'], ['freeze', 'Freeze in place'], ['finish', 'Finish the move']])) +
        '<label class="ph-fr"><span>Speed</span><input type="range" min="0.25" max="3" step="0.25" value="' + ini.speed + '" data-fld="speed" data-ii="' + ii + '"><b class="ph-rv" id="phv-speed' + ii + '">' + ini.speed + 'x</b></label>' +
        '<label class="ph-ck"><input type="checkbox" data-fld="safe" data-ii="' + ii + '"' + (ini.safe ? ' checked' : '') + '><span>Safe squish (slower, so nothing gets flung)</span></label>' +
        '<div class="ph-rowb"><button type="button" class="ph-b" data-bd="iplay" data-ii="' + ii + '">' + ic('play', 15) + '<span>Preview</span></button><button type="button" class="ph-b" data-bd="irew" data-ii="' + ii + '">' + ic('rewind', 15) + '<span>Rewind</span></button></div>';
    }
    return h + '</div>';
  }
  function initsHtml(b) {
    var p = propsOf(b), s = S, h = '<section class="ph-bs"><h4>Initiators <span class="ph-soon">' + p.inits.length + '</span></h4>';
    if (!p.inits.length) h += '<p class="ph-bn">None yet. An initiator says \u201cwhen X happens, do Y to group N\u201d.</p>';
    p.inits.forEach(function (i, ii) { if (i.type === 'move' && (i.ks == null || i.ks >= i.kf.length)) i.ks = i.kf.length ? 0 : -1; h += initCard(i, ii); });
    if (s.adding) h += '<div class="ph-ch">' + ['toggle', 'collision', 'move'].map(function (t) { return '<button type="button" class="ph-b" data-bd="inew" data-ty="' + t + '">' + INAME[t] + '</button>'; }).join('') + '<button type="button" class="ph-lk" data-bd="iadd">Cancel</button></div>';
    else h += '<div class="ph-rowb"><button type="button" class="ph-b" data-bd="iadd">' + ic('bolt', 16) + '<span>Add initiator</span></button></div>';
    return h + '</section>';
  }
  function sortKf(ini, sel) { ini.kf.sort(function (a, c) { return a.t - c.t; }); ini.ks = sel ? ini.kf.indexOf(sel) : ini.ks; }
  function onKd(e) {   // press and drag a keyframe diamond along the timeline
    var s = S, d = e.target.closest ? e.target.closest('.ph-kd') : null; if (!d || !s || !s.sel) return; e.preventDefault();
    var ii = +d.dataset.ii, k = +d.dataset.kd, ini = s.sel.props.inits[ii]; if (!ini) return;
    if (ini.ks !== k) { ini.ks = k; renderBoard(); }
    var kf = ini.kf[k], moved = false;
    var mv = function (ev) {
      var t = $('#phbd .ph-tk[data-ii="' + ii + '"]'); if (!t) return; var r = t.getBoundingClientRect(), f = Math.max(0, Math.min(1, (ev.clientX - r.left - 10) / Math.max(1, r.width - 20)));
      kf.t = Math.round(f * ini.dur * 20) / 20; moved = true;
      var el = $('#phbd .ph-kd[data-ii="' + ii + '"][data-kd="' + k + '"]'); if (el) el.style.setProperty('--f', (kf.t / ini.dur).toFixed(4));
      var inp = $('#phbd input[data-kp="t"][data-ii="' + ii + '"]'); if (inp) inp.value = kf.t;
    };
    var fin = function () { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', fin); window.removeEventListener('pointercancel', fin); if (moved && S === s && s.sel) { sortKf(ini, kf); renderBoard(); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', fin); window.addEventListener('pointercancel', fin);
  }
  function updPlayheads() {
    var s = S, b = s.sel, bd = $('#phbd'); if (!b || !bd || bd.hidden) return;
    b.props.inits.forEach(function (i, ii) { if (i.type !== 'move') return; var el = bd.querySelector('.ph-ph[data-ph="' + ii + '"]'); if (el) el.style.setProperty('--f', Math.min(1, i.rt.t / i.dur).toFixed(4)); });
  }
  function setField(t, type) {
    var s = S, ini = s.sel.props.inits[+t.dataset.ii]; if (!ini) return; var f = t.dataset.fld, v;
    if (t.type === 'checkbox') v = t.checked; else if (f === 'loop' || f === 'off') v = t.value; else { v = +t.value; if (isNaN(v)) return; }
    ini[f] = v;
    if (f === 'latch' && !v) ini.latched = false;
    if (f === 'dur') { ini.kf.forEach(function (k) { if (k.t > v) k.t = v; }); var o = $('#phv-dur' + t.dataset.ii); if (o) o.textContent = v + ' s'; }
    if (f === 'speed') { var o2 = $('#phv-speed' + t.dataset.ii); if (o2) o2.textContent = v + 'x'; }
    if (type === 'change') renderBoard();
  }
  function setKf(t, type) {
    var s = S, ini = s.sel.props.inits[+t.dataset.ii]; if (!ini) return; var kf = ini.kf[+t.dataset.k], p = t.dataset.kp; if (!kf) return;
    if (p === 'e') kf.e = t.value; else { var v = +t.value; if (t.value === '' || isNaN(v)) return; kf[p] = p === 't' ? Math.max(0, Math.min(ini.dur, v)) : v; }
    if (type === 'change') { if (p === 't') sortKf(ini, kf); renderBoard(); }
  }

  /* ================= scenes ================= */
  function scene(name) {
    var s = S; if (!s.eng) return; clearAll(); var W = s.W, H = s.H, i, j, pw, x0, x1;
    if (name === 'tower') {
      var rows = 6, sz = Math.max(12, Math.min(18, (W - 60) / (rows * 2.4)));
      for (i = 0; i < rows; i++) for (j = 0; j < rows - i; j++) addB(mk('box', W / 2 + (j - (rows - i - 1) / 2) * (sz * 2.05), H - sz - 1 - i * (sz * 2.02), sz, 'wood'));
      toast('Grab a ball or drop a bomb next to it');
    } else if (name === 'pendulum') {
      var ball = addB(mk('ball', W / 2 + Math.min(170, W * 0.3), 190, 16, 'metal'));
      mkRope({ x: W / 2, y: 40 }, { x: ball.position.x, y: ball.position.y }, null, ball, true);
      toast('Let go of the ball: potential energy turns into kinetic energy');
    } else if (name === 'pool') {
      pw = Math.min(300, W - 70); x0 = W / 2 - pw / 2; x1 = W / 2 + pw / 2;
      mkPlatform({ x: x0, y: H - 170 }, { x: x0, y: H - 4 }); mkPlatform({ x: x1, y: H - 170 }, { x: x1, y: H - 4 });
      fillRect(x0 + 8, H - 100, x1 - 8, H - 6, 0);
      addB(mk('box', W / 2 - pw / 4, H - 330, 22, 'wood')); addB(mk('ball', W / 2 + pw / 4, H - 330, 20, 'metal'));
      toast('Wood floats, metal sinks');
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
      addB(mk('box', W / 2 - pw / 3, H - 320, 18, 'wood')); addB(mk('hex', W / 2, H - 340, 18, 'ice')); addB(mk('ball', W / 2 + pw / 3, H - 320, 16, 'metal'));
      toast('Lava burns wood, melts ice, and metal just sits there');
    } else if (name === 'ocean') {
      var lvl = Math.round(H * 0.42), ob;
      fillRect(4, lvl, W - 4, H - 6, 0, true);
      addB(mk('plank', W * 0.3, lvl - 90, 26, 'wood')); addB(mk('box', W * 0.3 - 30, lvl - 150, 14, 'wood')); addB(mk('ball', W * 0.3 + 36, lvl - 190, 13, 'rubber'));
      addB(mk('ball', W * 0.62, lvl - 120, 16, 'metal')); addB(mk('hex', W * 0.74, lvl - 100, 15, 'ice')); addB(mk('box', W * 0.84, lvl - 130, 15, 'foam'));
      toast('A whole screen of water. It sleeps while calm, so it stays smooth. Go splash it');
    } else if (name === 'door') {
      var dx = W * 0.52, dh = Math.min(170, H * 0.38), door = mkSolid(dx, H - dh / 2 - 1, 16, dh, 'stone'), mi = newInit('move');
      door.props.groups.push(2); mi.from = 1; mi.to = 2; mi.dur = 2; mi.kf = [{ t: 1.5, x: 0, y: -(dh + 6), r: 0, e: 'smooth' }]; mi.off = 'back'; door.props.inits.push(mi);
      mkPlatform({ x: 20, y: H - 190 }, { x: dx - 26, y: H - 16 });
      for (i = 0; i < 3; i++) addB(mk('ball', 50 + i * 36, H - 250 - i * 8, 14, 'rubber'));
      var sw = mkNode({ x: Math.min(W - 30, W * 0.86), y: H - 16 }, 'toggle'); if (sw) sw.props.inits[0].to = 1;
      toast('Tap the orange switch with Grab: it signals group 1, and the door (group 2) slides up');
    } else if (name === 'elev') {
      var tr = Math.min(230, H * 0.5), lf = mkSolid(W * 0.3, H - 24, 120, 14, 'metal'), em = newInit('move');
      lf.props.groups.push(3); em.from = 4; em.to = 3; em.dur = 3; em.kf = [{ t: 2.5, x: 0, y: -tr, r: 0, e: 'smooth' }]; em.off = 'back'; lf.props.inits.push(em);
      addB(mk('box', W * 0.3, H - 70, 18, 'wood'));
      var pl = mkNode({ x: Math.min(W - 30, W * 0.74), y: H - 16 }, 'collision'); if (pl) { pl.props.inits[0].to = 4; pl.props.inits[0].latch = true; }
      addB(mk('ball', Math.min(W - 30, W * 0.74), H - 280, 16, 'metal'));
      toast('The ball lands on the plate, the plate signals group 4, and the lift (group 3) rises. Rewind to go again');
    } else if (name === 'lift') {
      var bx = addB(mk('box', W / 2, H - 22, 22, 'wood')), k;
      for (k = -1; k <= 1; k++) { var bl = addB(M.Bodies.circle(W / 2 + k * 50, 120 + Math.abs(k) * 24, 20, { density: 0.00008, restitution: 0.5, frictionAir: 0.03, sleepThreshold: Infinity })); bl.col = BAL[(k + 1) * 2 % BAL.length]; bl.kind = 'balloon'; bl.balloon = true; bl.fa0 = 0.03; mkRope({ x: bl.position.x, y: bl.position.y + 20 }, { x: bx.position.x + k * 12, y: bx.position.y - 22 }, bl, bx, true); }
      toast('Three balloons try to lift a box. Add more!');
    }
  }

  /* ================= input ================= */
  function pos(e) { var r = S.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  var INSTANT = { box: 1, ball: 1, tri: 1, hex: 1, plank: 1, wheel: 1, faucet: 1, bomb: 1, tnt: 1, balloon: 1, rocket: 1, boom: 1, motor: 1, pin: 1, node: 1 };   // tools that act the moment you press
  var NOHOLD = { water: 1, magnet: 1, erase: 1 };   // tools where holding means something else
  function holdTarget(p) { var b = bodyAt(p, false); return b && !b.rope && !b.wall ? b : null; }
  function act(T, p) {
    var s = S;
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
    else if (T === 'node') { var nb = mkNode(p); if (nb) { openBoard(nb, 'props'); toast(NODEHINT[s.initType]); } }
    else if (T === 'motor') motorAt(p);
    else if (T === 'pin') { var t = targetAt(p); if (t) mkPin(t, p); else toast('Tap an object to nail it'); }
    else if (T === 'rope' || T === 'rod' || T === 'spring' || T === 'glue' || T === 'platform' || T === 'pad' || T === 'fan') s.line = { a: p, ta: (T === 'platform' || T === 'pad' || T === 'fan') ? null : targetAt(p) };
  }
  function down(e) {
    var s = S; if (!s || !s.eng) return;
    s.ptype = e.pointerType || '';
    if (e.pointerType === 'mouse' && e.button !== 0) return;   // right-click opens the object menu (see onCtx)
    if (s.pid !== null) return; e.preventDefault();
    if (s.mt) { closeMenu(); return; }   // a tap away from the menu just closes it
    try { s.cv.setPointerCapture(e.pointerId); } catch (x) { }
    s.pid = e.pointerId; var p = pos(e), T = s.tool; s.pp = p; s.held = false; s.pend = null;
    s.tap = T === 'drag' ? { b: holdTarget(p), x: p.x, y: p.y, t: performance.now() } : null;
    /* on a phone, holding still on an object opens its menu. A tap that lands on an object waits for the finger to lift, so a hold does not drop something on top of it. */
    var hb = (e.pointerType !== 'mouse' && !NOHOLD[T]) ? holdTarget(p) : null;
    if (hb) s.hold = { b: hb, x: p.x, y: p.y, id: setTimeout(holdFire, 480) };
    if (hb && INSTANT[T]) s.pend = function () { act(T, p); }; else act(T, p);
  }
  function holdFire() {
    var s = S; if (!s || !s.hold) return; var h = s.hold; s.hold = null; if (s.pid === null || h.b.gone) return;
    s.held = true; s.pend = null; if (s.grab) { M.Composite.remove(s.world, s.grab); s.grab = null; } s.line = null;
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (x) { }
    openMenu(h.b, { x: h.x, y: h.y });
  }
  function onCtx(e) {
    e.preventDefault(); var s = S; if (!s || !s.eng || (s.ptype && s.ptype !== 'mouse')) return;   // a phone uses the hold
    var p = pos(e), b = holdTarget(p); if (b) openMenu(b, p); else closeMenu();
  }
  function move(e) {
    var s = S; if (!s || !s.eng || e.pointerId !== s.pid) return; var p = pos(e); s.pp = p;
    if (s.hold && Math.hypot(p.x - s.hold.x, p.y - s.hold.y) > 10) { clearTimeout(s.hold.id); s.hold = null; }
    if (s.grab) s.grab.pointA = { x: p.x, y: p.y };
    else if (s.tool === 'erase') eraseAt(p);
  }
  function up(e) {
    var s = S; if (!s || e.pointerId !== s.pid) return; var p = pos(e), T = s.tool;
    try { s.cv.releasePointerCapture(e.pointerId); } catch (x) { }
    s.pid = null; s.pour = false;
    if (s.hold) { clearTimeout(s.hold.id); s.hold = null; }
    if (s.held) { s.held = false; s.pend = null; return; }   // the hold opened the menu: nothing else happens on release
    if (s.pend) { var f = s.pend; s.pend = null; if (e.type !== 'pointercancel') f(); }
    if (s.tap) { var tp = s.tap; s.tap = null; if (tp.b && !tp.b.gone && e.type !== 'pointercancel' && performance.now() - tp.t < 400 && Math.hypot(p.x - tp.x, p.y - tp.y) < 10) flipToggles(tp.b); }   // a quick tap with Grab flips a Toggle
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

  /* ---- object menu, Properties board and About (Phase 2) ---- */
  var cap = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
  var gcol = function (id) { return 'hsl(' + ((id * 47) % 360) + ',68%,50%)'; };
  var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function nameOf(b) {
    var k = b.kind, m = MAT[b.matId]; if (KINDN[k]) return KINDN[k];
    var sh = SHAPE[k] || 'object'; return m ? m.n.replace(' Block', '') + ' ' + sh : cap(sh);
  }
  function colOf(b) { var m = MAT[b.matId]; return b.col || (m && m.c) || '#94a3b8'; }
  function partsOf(b) { return b.parts && b.parts.length > 1 ? b.parts.slice(1) : [b]; }
  function sizeText(b) {
    var f = function (v) { return px2m(v).toFixed(2); }, v = b.vertices, bb = b.bounds, ed = function (a, c) { return Math.hypot(c.x - a.x, c.y - a.y); };
    if (b.circleRadius) return f(b.circleRadius * 2) + ' m across';
    if (b.parts.length === 1 && v.length === 4) return f(ed(v[0], v[1])) + ' \u00d7 ' + f(ed(v[1], v[2])) + ' m';
    return f(bb.max.x - bb.min.x) + ' \u00d7 ' + f(bb.max.y - bb.min.y) + ' m';
  }
  function menuOpen() { return !!S.mt; }
  function openMenu(b, p) {
    var s = S, mn = $('#phmenu'); if (!mn || !b || b.gone) return; propsOf(b);
    s.mt = b;
    mn.innerHTML = '<div class="ph-mh"><s style="--c:' + colOf(b) + '"></s><b>' + esc(nameOf(b)) + '</b></div>' +
      '<button type="button" class="ph-mi" role="menuitem" data-mn="props">' + ic('sliders', 17) + '<span>Properties</span></button>' +
      '<button type="button" class="ph-mi" role="menuitem" data-mn="about">' + ic('info', 17) + '<span>About</span></button>' +
      '<button type="button" class="ph-mi" role="menuitem" data-mn="ask">' + ic('chat', 17) + '<span>Ask Spectra</span></button>' +
      '<button type="button" class="ph-mi dg" role="menuitem" data-mn="del">' + ic('trash', 17) + '<span>Delete</span></button>';
    mn.hidden = false;
    var w = 192, h = 4 * 40 + 46, x = Math.max(6, Math.min(p.x + 6, s.W - w - 6)), y = Math.max(6, Math.min(p.y + 6, s.H - h - 6)); mn.style.left = x + 'px'; mn.style.top = y + 'px';
  }
  function closeMenu() { var s = S; if (!s) return; s.mt = null; var mn = $('#phmenu'); if (mn) mn.hidden = true; }
  function menuAct(a) {
    var s = S, b = s.mt; closeMenu(); if (!b || b.gone) return;
    if (a === 'props' || a === 'about') openBoard(b, a === 'about' ? 'about' : 'props');
    else if (a === 'ask') askAbout(b);
    else if (a === 'del') { if (b === s.sel) closeBoard(); rm(b); }
  }
  function openBoard(b, tab) {
    var s = S, bd = $('#phbd'); if (!bd) return; propsOf(b); s.sel = b; s.tab = tab || 'props';
    var bb = b.position.x > s.W / 2; bd.classList.toggle('lf', bb); bd.hidden = false; renderBoard(true);
  }
  function closeBoard() { var s = S; if (!s) return; s.sel = null; var bd = $('#phbd'); if (bd) bd.hidden = true; }
  var groupCount = function (id) { var n = 0; M.Composite.allBodies(S.world).forEach(function (b) { if (b.props && b.props.groups.indexOf(id) >= 0) n++; }); return n; };
  function flagsOf(b) {
    var m = MAT[b.matId], fl = [];
    if (m) { if (m.flam) fl.push('Flammable'); if (m.mag) fl.push('Magnetic'); if (m.lava) fl.push('Lava-proof'); if (m.melts) fl.push('Melts'); if (m.smelt) fl.push('Melts slowly'); }
    (KFLAGS[b.kind] || []).forEach(function (f) { fl.push(f); }); if (b.isStatic) fl.push('Fixed in place');
    return fl;
  }
  function aboutHtml(b) {
    var m = MAT[b.matId], h = '', ex = ABOUT[b.kind];
    if (m) {
      var kg = Math.round(m.d * 1e6), rel = m.d / 0.001, e2 = Math.round(m.r * m.r * 100);
      h += '<section class="ph-bs"><h4>What it is</h4><p class="ph-bn">' + esc(m.note) + '</p></section>';
      h += '<section class="ph-bs"><h4>Float or sink?</h4><p class="ph-bn">' + m.n + ' is ' + kg + ' kg/m\u00b3 and water is 1000 kg/m\u00b3. ' +
        (rel < 0.995 ? 'It is only ' + rel.toFixed(2) + ' times as dense as water, so it floats with about ' + Math.round(rel * 100) + '% of it underwater. That is Archimedes\u2019 principle: the water pushes up with a force equal to the weight of the water the object pushes aside.'
          : rel > 1.005 ? 'It is ' + rel.toFixed(1) + ' times as dense as water, so the push of the water is smaller than its weight, and it sinks.' : 'It has almost the same density as water, so it hovers.') + '</p></section>';
      h += '<section class="ph-bs"><h4>Bounciness ' + m.r.toFixed(2) + '</h4><p class="ph-bn">This number is the coefficient of restitution: the share of its speed an object keeps after a bounce. Dropped from a height, it would climb back to about ' + e2 + '% of that height (the height goes with the speed squared).</p></section>';
      h += '<section class="ph-bs"><h4>Friction ' + m.f.toFixed(2) + '</h4><p class="ph-bn">' + (m.f < 0.1 ? 'Very slippery: it slides down even a gentle slope.' : m.f < 0.5 ? 'Fairly smooth, so it slides easily.' : m.f < 0.9 ? 'A medium grip.' : 'A strong grip: it resists sliding.') + ' Friction force = friction number \u00d7 the force pressing the surfaces together.</p></section>';
      if (FACT[m.id]) h += '<section class="ph-bs"><h4>Did you know?</h4><p class="ph-bn">' + esc(FACT[m.id]) + '</p></section>';
    }
    if (ex) h += '<section class="ph-bs"><h4>' + (m ? 'The ' + (b.kind === 'platform' ? 'ramp' : 'object') : 'The physics') + '</h4><p class="ph-bn">' + esc(ex) + '</p></section>';
    if (b.props && b.props.inits.length) h += '<section class="ph-bs"><h4>Initiators</h4><p class="ph-bn">Toggle and Collision initiators send a signal to a group number. A Move initiator listens for that signal and moves every object in its target group along its keyframes. Open Properties to link them.</p></section>';
    return h || '<p class="ph-bn">Not much to say about this one yet.</p>';
  }
  function askText(b) {
    var m = MAT[b.matId], nm = nameOf(b).toLowerCase(), ex = ABOUT[b.kind];
    var t = 'Teach me the physics of an object from my sandbox: a ' + nm + '.';
    if (m) t += ' Its density is ' + Math.round(m.d * 1e6) + ' kg/m\u00b3 (water is 1000), its bounciness (coefficient of restitution) is ' + m.r.toFixed(2) + ' and its friction is ' + m.f.toFixed(2) + '. Explain whether it floats or sinks and why, what bounciness and friction mean using this object as the example, and what would happen if I dropped it in water, onto a ramp, or next to an explosion.';
    else if (ex) t += ' Explain the physics behind it: ' + ex;
    return t + ' Use simple numbers and end with a short quiz.';
  }
  function askAbout(b) { if (O.onAsk) O.onAsk(askText(b)); }
  function boardHtml(b) {
    var p = propsOf(b), m = MAT[b.matId], tab = S.tab, cn = (CATS.filter(function (c) { return c.id === p.cat; })[0] || {}).n || '', fl = flagsOf(b), i;
    var h = '<div class="ph-bh"><s style="--c:' + colOf(b) + '"></s><div><b>' + esc(nameOf(b)) + '</b><span>' + cn + (m ? ' \u00b7 ' + m.n : '') + '</span></div><button type="button" class="ph-x" data-bd="close" aria-label="Close">' + ic('x', 17) + '</button></div>' +
      '<div class="ph-bt" role="tablist"><button type="button" role="tab" data-bd="tab" data-t="props" class="' + (tab === 'props' ? 'on' : '') + '" aria-selected="' + (tab === 'props') + '">Properties</button><button type="button" role="tab" data-bd="tab" data-t="about" class="' + (tab === 'about' ? 'on' : '') + '" aria-selected="' + (tab === 'about') + '">About</button></div><div class="ph-bb">';
    if (tab === 'about') h += aboutHtml(b);
    else {
      var gs = '', g = p.groups;
      for (i = 1; i <= 12; i++) { var on = g.indexOf(i) >= 0, n = groupCount(i); gs += '<button type="button" class="ph-g' + (on ? ' on' : '') + '" data-bd="grp" data-id="' + i + '" style="--gc:' + gcol(i) + '" aria-pressed="' + on + '" title="Group ' + i + ': ' + n + ' object' + (n === 1 ? '' : 's') + '">' + i + '</button>'; }
      h += '<section class="ph-bs"><h4>Group IDs</h4><p class="ph-bn">Groups link objects together. Initiators send signals to groups and move groups. One object can be in several groups.</p><div class="ph-gs">' + gs + '</div>' +
        '<p class="ph-bn">' + (g.length ? 'In group' + (g.length > 1 ? 's' : '') + ' ' + g.slice().sort(function (a, c) { return a - c; }).join(', ') + ' \u00b7 <button type="button" class="ph-lk" data-bd="clrg">Clear</button>' : 'Not in any group') + '</p></section>';
      var rel = m ? m.d / 0.001 : 0;
      h += '<section class="ph-bs"><h4>Material stats</h4><div class="ph-sg">' +
        '<div class="ph-sr"><span>Density</span><em></em><b>' + (m ? Math.round(m.d * 1e6) + ' kg/m\u00b3 \u00b7 ' + (rel < 0.995 ? 'floats' : rel > 1.005 ? 'sinks' : 'hovers') : 'n/a') + '</b></div>' +
        bar(p.hpMax ? p.hp / p.hpMax : 0, 'Health', p.hpMax ? p.hp + ' / ' + p.hpMax : 'n/a') +
        '<div class="ph-sr"><span>Bounciness</span><input type="range" min="0" max="1.2" step="0.01" value="' + b.restitution.toFixed(2) + '" data-bp="restitution" aria-label="Bounciness"><b id="phv-restitution">' + b.restitution.toFixed(2) + '</b></div>' +
        '<div class="ph-sr"><span>Friction</span><input type="range" min="0" max="1.5" step="0.01" value="' + b.friction.toFixed(2) + '" data-bp="friction" aria-label="Friction"><b id="phv-friction">' + b.friction.toFixed(2) + '</b></div>' +
        '<div class="ph-sr"><span>Size</span><em></em><b>' + sizeText(b) + '</b></div></div>' +
        '<div class="ph-fl">' + (fl.length ? fl.map(function (x) { return '<span>' + x + '</span>'; }).join('') : '<span class="no">No special flags</span>') + '</div></section>';
      h += initsHtml(b);
    }
    h += '<div class="ph-rowb ph-fo"><button type="button" class="ph-b" data-bd="ask">' + ic('chat', 16) + '<span>Ask Spectra</span></button><button type="button" class="ph-b dg" data-bd="del">' + ic('trash', 16) + '<span>Delete</span></button></div></div>';
    return h;
  }
  function renderBoard(top) {
    var s = S, bd = $('#phbd'), b = s && s.sel; if (!bd || !b) return;
    var old = bd.querySelector('.ph-bb'), st = old && !top ? old.scrollTop : 0; bd.innerHTML = boardHtml(b);
    var nb = bd.querySelector('.ph-bb'); if (nb) nb.scrollTop = st;
  }
  function boardAct(a, el) {
    var s = S, b = s.sel; if (a === 'close') { closeBoard(); return; } if (!b || b.gone) { closeBoard(); return; }
    var p = propsOf(b);
    if (a === 'tab') { s.tab = el.dataset.t === 'about' ? 'about' : 'props'; renderBoard(true); }
    else if (a === 'grp') { var id = +el.dataset.id, k = p.groups.indexOf(id); if (k >= 0) p.groups.splice(k, 1); else p.groups.push(id); renderBoard(); }
    else if (a === 'clrg') { p.groups.length = 0; renderBoard(); }
    else if (a === 'iadd') { s.adding = !s.adding; renderBoard(); }
    else if (a === 'inew') { if (p.inits.length >= MAXINIT) toast('That is plenty of initiators on one object'); else p.inits.push(newInit(el.dataset.ty)); s.adding = false; renderBoard(); }
    else if (a === 'idel') { p.inits.splice(+el.dataset.ii, 1); renderBoard(); }
    else if (a === 'iflip') { var fi = p.inits[+el.dataset.ii]; if (fi && fi.type === 'toggle') { fi.on = !fi.on; renderBoard(); } }
    else if (a === 'iplay') { var pm = p.inits[+el.dataset.ii]; if (pm && pm.type === 'move') { pm.rt = { t: 0, dir: 1, pon: pm.rt.pon, back: false, fin: false }; if (s.paused) toast('Press Play: initiators only run while the sandbox is running'); } }
    else if (a === 'irew') { var rm2 = p.inits[+el.dataset.ii]; if (rm2 && rm2.type === 'move') { rm2.rt = { t: 0, dir: 0, pon: rm2.rt.pon, back: false, fin: false }; rm2.cur = { x: 0, y: 0, r: 0 }; renderBoard(); } }
    else if (a === 'kadd') { var km = p.inits[+el.dataset.ii]; if (km && km.type === 'move') { var lk = km.kf[km.kf.length - 1], nk = lk ? { t: Math.min(km.dur, lk.t + 1), x: lk.x, y: lk.y, r: lk.r, e: 'smooth' } : { t: km.dur / 2, x: 100, y: 0, r: 0, e: 'smooth' }; km.kf.push(nk); sortKf(km, nk); renderBoard(); } }
    else if (a === 'kdel') { var kd = p.inits[+el.dataset.ii]; if (kd && kd.type === 'move') { kd.kf.splice(+el.dataset.k, 1); kd.ks = kd.kf.length ? Math.min(+el.dataset.k, kd.kf.length - 1) : -1; renderBoard(); } }
    else if (a === 'ask') askAbout(b);
    else if (a === 'del') { closeBoard(); rm(b); }
  }
  function setBodyProp(b, k, v) { partsOf(b).concat([b]).forEach(function (q) { q[k] = v; }); var o = $('#phv-' + k); if (o) o.textContent = v.toFixed(2); }

  /* ---- category tabs and the stats card ---- */
  function showCat(cat) {
    var s = S; if (!s) return; s.cat = cat;
    s.root.querySelectorAll('.ph-tab').forEach(function (b) { var on = b.dataset.pc === cat; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    s.root.querySelectorAll('.ph-pn').forEach(function (p) { p.hidden = p.dataset.cat !== cat; });
  }
  function setCat(cat) { var s = S; if (!s) return; showCat(cat); setTool(s.tlast[cat] || DEFT[cat]); }
  var bar = function (v, label, txt) { return '<div class="ph-sr"><span>' + label + '</span><div class="ph-bar"><i style="width:' + Math.max(3, Math.min(100, v * 100)).toFixed(0) + '%"></i></div><b>' + txt + '</b></div>'; };
  function statsHtml(id) {
    var m = MAT[id] || MAT.wood, rel = m.d / 0.001, fl = [];
    if (m.flam) fl.push('Flammable'); if (m.mag) fl.push('Magnetic'); if (m.lava) fl.push('Lava-proof'); if (m.melts) fl.push('Melts');
    return '<div class="ph-sh"><s style="--c:' + m.c + '"></s><div><b>' + m.n + '</b><span>' + m.note + '</span></div></div><div class="ph-sg">' +
      '<div class="ph-sr"><span>Density</span><em></em><b>' + Math.round(m.d * 1e6) + ' kg/m\u00b3 \u00b7 ' + (rel < 0.995 ? 'floats on water' : rel > 1.005 ? 'sinks in water' : 'hovers in water') + '</b></div>' +
      bar(m.r / 0.9, 'Bounciness', m.r.toFixed(2)) + bar(m.f / 1.3, 'Friction', m.f.toFixed(2)) + bar(Math.sqrt(m.hp / 1500), 'Max health', String(m.hp)) + '</div>' +
      '<div class="ph-fl">' + (fl.length ? fl.map(function (x) { return '<span>' + x + '</span>'; }).join('') : '<span class="no">No special flags</span>') + '</div>';
  }
  function refreshStats() {
    var s = S, st = $('#phstats'); if (!s || !st) return;
    var on = s.cat === 'block' || s.tool === 'platform' || s.tool === 'wheel'; st.hidden = !on; if (on) st.innerHTML = statsHtml(s.mat);
  }
  function setTool(id) {
    var s = S; if (!s) return; s.tool = id; s.line = null; closeMenu();
    var cat = CATOF[id]; if (cat) { s.tlast[cat] = id; if (cat !== s.cat) showCat(cat); }
    s.root.querySelectorAll('.ph-t').forEach(function (b) { b.classList.toggle('on', b.dataset.pt === id); });
    s.root.querySelectorAll('.ph-sub').forEach(function (r) { r.hidden = (r.dataset.for || '').split(' ').indexOf(id) < 0; });
    refreshStats();
    var t = INFO[id], inf = $('#phinfo'); if (inf && t) inf.innerHTML = '<b>' + t[1] + '</b>' + t[2];
    if (s.cv) s.cv.style.cursor = id === 'drag' ? 'grab' : 'crosshair';
  }
  function togglePause() {
    var s = S; if (!s) return; s.paused = !s.paused; var b = $('#phpa'); if (b) b.innerHTML = ic(s.paused ? 'play' : 'pause', 16) + '<span>' + (s.paused ? 'Play' : 'Pause') + '</span>';
  }
  function onClick(e) {
    var s = S; if (!s) return; var b = e.target.closest('[data-pc],[data-pt],[data-pm],[data-pf],[data-pa],[data-sc],[data-mn],[data-bd],[data-pi]'); if (!b) return;
    if (b.dataset.pc) setCat(b.dataset.pc);
    else if (b.dataset.pt) setTool(b.dataset.pt);
    else if (b.dataset.pm) { s.mat = b.dataset.pm; S.root.querySelectorAll('.ph-m[data-pm]').forEach(function (m) { m.classList.toggle('on', m.dataset.pm === s.mat); }); refreshStats(); }
    else if (b.dataset.pf !== undefined) { s.fluid = +b.dataset.pf; S.root.querySelectorAll('.ph-m[data-pf]').forEach(function (m) { m.classList.toggle('on', +m.dataset.pf === s.fluid); }); if (s.tool !== 'water' && s.tool !== 'faucet') setTool('water'); }
    else if (b.dataset.pi) { s.initType = b.dataset.pi; S.root.querySelectorAll('.ph-m[data-pi]').forEach(function (m) { m.classList.toggle('on', m.dataset.pi === s.initType); }); }
    else if (b.dataset.mn) menuAct(b.dataset.mn);
    else if (b.dataset.bd) boardAct(b.dataset.bd, b);
    else if (b.dataset.sc) scene(b.dataset.sc);
    else if (b.dataset.pa === 'pause') togglePause();
    else if (b.dataset.pa === 'rewind') rewind();
    else if (b.dataset.pa === 'rain') { s.rain = !s.rain; b.classList.toggle('on', s.rain); }
    else if (b.dataset.pa === 'drain') { if (s.fl) s.fl.clear(); }
    else if (b.dataset.pa === 'clear') { if (s.eng) clearAll(); }
    else if (b.dataset.pa === 'ask' && O.onAsk) O.onAsk('Teach me the physics behind a sandbox like this: gravity, buoyancy (why wood floats and metal sinks, and why oil floats on water), rope tension, springs (Hooke\u2019s law), thrust, and what happens in an explosion. Use simple examples and a short quiz at the end.');
  }
  function onChange(e) {
    var s = S; if (!s) return; var t = e.target;
    if (t.id === 'phsz') s.size = +t.value;
    else if (t.id === 'phg' && e.type === 'change') { s.grav = GRAV[+t.value][1]; if (s.eng) s.eng.gravity.y = s.grav; if (s.fl) s.fl.wakeAll(); }
    else if (t.id === 'phsp' && e.type === 'change') s.speed = +t.value;
    else if (t.dataset && t.dataset.bp && s.sel && !s.sel.gone) setBodyProp(s.sel, t.dataset.bp, +t.value);
    else if (t.dataset && t.dataset.fld && s.sel && !s.sel.gone) setField(t, e.type);
    else if (t.dataset && t.dataset.kp && s.sel && !s.sel.gone) setKf(t, e.type);
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
        if (b.isStatic || b.wall || !hasMat(b, 'mag')) return; var dx = s.pp.x - b.position.x, dy = s.pp.y - b.position.y, d = Math.hypot(dx, dy); if (d > 340 || d < 2) return;
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
        else if (hasMat(b, 'melts')) { if (h > 700) { var cnt = Math.min(26, Math.round((b.area || 900) / 55)), q; for (q = 0; q < cnt; q++) emit(x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 14, (rnd() - 0.5) * 80, 0, 0); burnFx(x, y); rm(b); } }
        else if (hasMat(b, 'flam') || b.kind === 'wheelx') { if (h > 1200) { burnFx(x, y); rm(b); } }
      });
    }
    moversStep(bodies, dt);
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
    if (s.sel && s.sel.gone) closeBoard(); if (s.mt && s.mt.gone) closeMenu();
    if (s.sel && s.frame % 3 === 0) updPlayheads();
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
    if (s.frame % 20 === 0) { var ch = $('#phchip'); if (ch) ch.textContent = objCount() + ' objects \u00b7 ' + s.fl.n + ' liquid' + (s.fl.n > 400 ? ' (' + s.fl.na + ' awake)' : '') + ' \u00b7 g = ' + (9.8 * s.grav).toFixed(1) + ' m/s\u00b2' + (Object.keys(s.sig).length ? ' \u00b7 signal: group ' + Object.keys(s.sig).join(', ') : '') + (s.paused ? ' \u00b7 paused' : ''); }
  }

  /* ================= drawing ================= */
  function path(c, p) {
    var v = p.vertices, i; c.beginPath(); c.moveTo(v[0].x, v[0].y); for (i = 1; i < v.length; i++) c.lineTo(v[i].x, v[i].y); c.closePath();
  }
  function drawBody(c, b) {
    var p = b.position, i, r, parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
    parts.forEach(function (q) {
      if (q.circleRadius) { c.beginPath(); c.arc(q.position.x, q.position.y, q.circleRadius, 0, 6.2832); } else path(c, q);
      c.fillStyle = q.col || b.col || '#94a3b8'; c.fill();
      var sm = b.matId && MAT[b.matId]; if (sm && sm.sh) { var bb = q.bounds, gr = c.createLinearGradient(bb.min.x, bb.min.y, bb.max.x, bb.max.y); gr.addColorStop(0, 'rgba(255,255,255,' + (0.38 * sm.sh).toFixed(2) + ')'); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,' + (0.2 * sm.sh).toFixed(2) + ')'); c.save(); c.clip(); c.fillStyle = gr; c.fillRect(bb.min.x - 2, bb.min.y - 2, bb.max.x - bb.min.x + 4, bb.max.y - bb.min.y + 4); c.restore(); }
      c.lineWidth = 2; c.strokeStyle = 'rgba(0,0,0,.35)'; c.stroke();
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
    if (b.kind === 'node' && window.Path2D) { var bp = S.bolt || (S.bolt = new Path2D(ICO.bolt)); c.save(); c.translate(p.x - 9, p.y - 9); c.scale(0.75, 0.75); c.lineWidth = 2.4; c.strokeStyle = '#fff'; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(bp); c.restore(); }
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
  /* the selected object's outline, and a small coloured tag for every group an object is in */
  function drawMarks(c) {
    var s = S, so = (s.mt && !s.mt.gone ? s.mt : null) || (s.sel && !s.sel.gone ? s.sel : null);
    M.Composite.allBodies(s.world).forEach(function (b) {
      var pr = b.props; if (!pr || b.wall || b.rope) return; var g = pr.groups, ins = pr.inits; if (!g.length && !ins.length) return;
      var bb = b.bounds, y = bb.min.y < 14 ? bb.min.y + 9 : bb.min.y - 8, x = bb.min.x + 8, k, n = Math.min(4, g.length);
      c.font = '700 9px Inter,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      for (k = 0; k < n; k++) {
        c.beginPath(); c.arc(x + k * 16, y, 7.5, 0, 6.2832); c.fillStyle = gcol(g[k]); c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.stroke();
        c.fillStyle = '#fff'; c.fillText(k === 3 && g.length > 4 ? '+' : String(g[k]), x + k * 16, y + 0.5);
      }
      var rx = bb.max.x - 8;   // one small marker per initiator, from the right: a pill for Toggle, a circle for Collision, a diamond for Move
      ins.slice(0, 4).forEach(function (i, q) {
        var cx = rx - q * 18, on = i.type === 'toggle' ? i.on : i.type === 'collision' ? colOn(i) : i.rt.dir !== 0;
        c.lineWidth = 1.5; c.strokeStyle = '#fff'; c.fillStyle = on ? (i.type === 'move' ? '#3b82f6' : '#22c55e') : '#94a3b8';
        c.beginPath();
        if (i.type === 'toggle') { c.moveTo(cx - 6, y - 4); c.lineTo(cx + 6, y - 4); c.arc(cx + 6, y, 4, -1.5708, 1.5708); c.lineTo(cx - 6, y + 4); c.arc(cx - 6, y, 4, 1.5708, 4.7124); c.closePath(); }
        else if (i.type === 'collision') c.arc(cx, y, 6, 0, 6.2832);
        else { c.moveTo(cx, y - 7); c.lineTo(cx + 7, y); c.lineTo(cx, y + 7); c.lineTo(cx - 7, y); c.closePath(); }
        c.fill(); c.stroke();
        if (i.type === 'toggle') { c.beginPath(); c.arc(cx + (i.on ? 3 : -3), y, 2.2, 0, 6.2832); c.fillStyle = '#fff'; c.fill(); }
      });
    });
    if (so) {
      c.save(); c.lineWidth = 3; c.strokeStyle = '#7c5cff'; c.shadowColor = '#7c5cff'; c.shadowBlur = 10; c.setLineDash([7, 5]); c.lineDashOffset = -s.tt * 0.02;
      partsOf(so).forEach(function (q) { if (q.circleRadius) { c.beginPath(); c.arc(q.position.x, q.position.y, q.circleRadius + 3, 0, 6.2832); } else path(c, q); c.stroke(); });
      c.restore();
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
    drawMarks(c);
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

  window.SpectraPhys = { mount: mount, unmount: unmount, props: propsOf, setCat: setCat, selected: function () { return S && S.sel; }, data: { PX_M: PX_M, CATS: CATS, REG: REG, MATS: MATS, LIQ: LIQ, OBJ: OBJ, GRAV: GRAV } };
})();
