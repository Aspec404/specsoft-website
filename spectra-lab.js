/* Spectra Lab (v1) for Spectra Academics: science activities you can play with.
   v1 has the Periodic Table Mixer: grab elements, drop them in 5 slots, press Mix, see what you made.
   Everything runs in the browser (no database, no credits). The Lab Book is saved on this device (localStorage "sa.lab.book").
   Load this file AFTER spectra-academics.js. It needs the sidebar button #lab and the section #labv (see spectra-academics.html).
   Optional helpers it uses when they exist: window.SpectraAcad.paint / .toast, window.SpectraNotes.addFromAnswer. */
(function () {
  'use strict';
  var BOOK_KEY = 'sa.lab.book', NSLOT = 5;

  /* ================= element data ================= */
  var SYM = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');
  var NAME = 'Hydrogen,Helium,Lithium,Beryllium,Boron,Carbon,Nitrogen,Oxygen,Fluorine,Neon,Sodium,Magnesium,Aluminum,Silicon,Phosphorus,Sulfur,Chlorine,Argon,Potassium,Calcium,Scandium,Titanium,Vanadium,Chromium,Manganese,Iron,Cobalt,Nickel,Copper,Zinc,Gallium,Germanium,Arsenic,Selenium,Bromine,Krypton,Rubidium,Strontium,Yttrium,Zirconium,Niobium,Molybdenum,Technetium,Ruthenium,Rhodium,Palladium,Silver,Cadmium,Indium,Tin,Antimony,Tellurium,Iodine,Xenon,Cesium,Barium,Lanthanum,Cerium,Praseodymium,Neodymium,Promethium,Samarium,Europium,Gadolinium,Terbium,Dysprosium,Holmium,Erbium,Thulium,Ytterbium,Lutetium,Hafnium,Tantalum,Tungsten,Rhenium,Osmium,Iridium,Platinum,Gold,Mercury,Thallium,Lead,Bismuth,Polonium,Astatine,Radon,Francium,Radium,Actinium,Thorium,Protactinium,Uranium,Neptunium,Plutonium,Americium,Curium,Berkelium,Californium,Einsteinium,Fermium,Mendelevium,Nobelium,Lawrencium,Rutherfordium,Dubnium,Seaborgium,Bohrium,Hassium,Meitnerium,Darmstadtium,Roentgenium,Copernicium,Nihonium,Flerovium,Moscovium,Livermorium,Tennessine,Oganesson'.split(',');
  var MASS = [1.008, 4.0026, 6.94, 9.0122, 10.81, 12.011, 14.007, 15.999, 18.998, 20.18, 22.99, 24.305, 26.982, 28.085, 30.974, 32.06, 35.45, 39.948, 39.098, 40.078, 44.956, 47.867, 50.942, 51.996, 54.938, 55.845, 58.933, 58.693, 63.546, 65.38, 69.723, 72.63, 74.922, 78.971, 79.904, 83.798, 85.468, 87.62, 88.906, 91.224, 92.906, 95.95, 98, 101.07, 102.91, 106.42, 107.87, 112.41, 114.82, 118.71, 121.76, 127.6, 126.9, 131.29, 132.91, 137.33, 138.91, 140.12, 140.91, 144.24, 145, 150.36, 151.96, 157.25, 158.93, 162.5, 164.93, 167.26, 168.93, 173.05, 174.97, 178.49, 180.95, 183.84, 186.21, 190.23, 192.22, 195.08, 196.97, 200.59, 204.38, 207.2, 208.98, 209, 210, 222, 223, 226, 227, 232.04, 231.04, 238.03, 237, 244, 243, 247, 247, 251, 252, 257, 258, 259, 266, 267, 268, 269, 270, 277, 278, 281, 282, 285, 286, 289, 290, 293, 294, 294];
  var CAT_OF = {};
  var CATS = {
    alk: { n: 'Alkali metal', c: '#ef4444', s: 'Li Na K Rb Cs Fr' },
    alke: { n: 'Alkaline earth metal', c: '#f59e0b', s: 'Be Mg Ca Sr Ba Ra' },
    post: { n: 'Post-transition metal', c: '#14b8a6', s: 'Al Ga In Sn Tl Pb Bi Nh Fl Mc Lv' },
    meta: { n: 'Metalloid', c: '#84cc16', s: 'B Si Ge As Sb Te Po' },
    non: { n: 'Nonmetal', c: '#22c55e', s: 'H C N O P S Se' },
    hal: { n: 'Halogen', c: '#a855f7', s: 'F Cl Br I At Ts' },
    nob: { n: 'Noble gas', c: '#ec4899', s: 'He Ne Ar Kr Xe Rn Og' },
    lan: { n: 'Lanthanide', c: '#06b6d4', s: 'La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu' },
    act: { n: 'Actinide', c: '#8b5cf6', s: 'Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr' },
    tra: { n: 'Transition metal', c: '#3b82f6', s: '' }
  };
  Object.keys(CATS).forEach(function (k) { CATS[k].s.split(' ').forEach(function (s) { if (s) CAT_OF[s] = k; }); });
  var GAS = 'H He N O F Ne Cl Ar Kr Xe Rn'.split(' '), LIQ = ['Br', 'Hg'];
  var EL = {}, LAYOUT = [];
  SYM.forEach(function (s, i) {
    var z = i + 1, cat = CAT_OF[s] || 'tra', p, g;
    if (z === 1) { p = 1; g = 1; } else if (z === 2) { p = 1; g = 18; }
    else if (z <= 4) { p = 2; g = z - 2; } else if (z <= 10) { p = 2; g = z + 8; }
    else if (z <= 12) { p = 3; g = z - 10; } else if (z <= 18) { p = 3; g = z - 0; }
    else if (z <= 36) { p = 4; g = z - 18; } else if (z <= 54) { p = 5; g = z - 36; }
    else if (z <= 56) { p = 6; g = z - 54; } else if (z <= 71) { p = 8; g = z - 57 + 3; }
    else if (z <= 86) { p = 6; g = z - 68; } else if (z <= 88) { p = 7; g = z - 86; }
    else if (z <= 103) { p = 9; g = z - 89 + 3; } else { p = 7; g = z - 100; }
    EL[s] = { z: z, s: s, n: NAME[i], m: MASS[i], cat: cat, row: p, col: g, st: GAS.indexOf(s) >= 0 ? 'gas' : LIQ.indexOf(s) >= 0 ? 'liquid' : z >= 104 ? '' : 'solid' };
    LAYOUT.push(EL[s]);
  });
  var isMetal = function (s) { return ['alk', 'alke', 'tra', 'post', 'lan', 'act'].indexOf(EL[s].cat) >= 0; };

  /* ================= compounds ================= */
  var SUBS = '\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089';
  var sub = function (n) { return String(n).replace(/\d/g, function (d) { return SUBS[+d]; }); };
  var gcd = function (a, b) { return b ? gcd(b, a % b) : a; };
  var canon = function (c) { return Object.keys(c).sort().map(function (k) { return k + c[k]; }).join(''); };
  var parseF = function (f) { var c = {}, re = /([A-Z][a-z]?)(\d*)/g, m; while ((m = re.exec(f))) c[m[1]] = (c[m[1]] || 0) + (m[2] ? +m[2] : 1); return c; };
  var total = function (c) { var t = 0; for (var k in c) t += c[k]; return t; };
  var fdisp = function (f) { return f.replace(/(\d+)/g, function (m) { return sub(m); }); };

  /* [formula as counts, display or 0, name, state, priority (lower = more stable), text, warning] */
  var W_TOX = 'Real-life note: this is toxic. Only trained chemists handle it, with proper safety gear.';
  var W_COR = 'Real-life note: this is corrosive. Never touch, taste or mix unknown chemicals.';
  var W_BLE = 'Real-life note: never mix bleach with other cleaners. It can release harmful gases.';
  var DB = [
    ['H2', 0, 'Hydrogen gas', 'gas', 1, 'The lightest gas. Two hydrogen atoms share a pair of electrons (a covalent bond).'],
    ['N2', 0, 'Nitrogen gas', 'gas', 1, 'About 78% of the air we breathe. The triple bond between the two atoms is very strong, so nitrogen gas rarely reacts.'],
    ['O2', 0, 'Oxygen gas', 'gas', 1, 'The gas we breathe, about 21% of air. Needed for burning and for cellular respiration.'],
    ['F2', 0, 'Fluorine gas', 'gas', 1, 'A pale yellow gas and the most reactive nonmetal.', W_TOX],
    ['Cl2', 0, 'Chlorine gas', 'gas', 1, 'A greenish-yellow gas. Tiny amounts are used to disinfect drinking water and pools.', W_TOX],
    ['Br2', 0, 'Bromine', 'liquid', 1, 'One of only two elements that are liquid at room temperature (the other is mercury). Red-brown with harmful fumes.', W_TOX],
    ['I2', 0, 'Iodine', 'solid', 1, 'A dark purple-black solid that turns into purple vapor when warmed. Iodine solutions are used as antiseptics.'],
    ['O3', 0, 'Ozone', 'gas', 4, 'Three oxygen atoms bonded together. High in the atmosphere, the ozone layer blocks harmful UV light from the Sun.'],
    ['H2O', 0, 'Water', 'liquid', 0, 'Two hydrogens bonded to one oxygen. Its bent, polar shape makes water a great solvent and is why life depends on it.'],
    ['H2O2', 0, 'Hydrogen peroxide', 'liquid', 3, 'Like water with an extra oxygen. Diluted, it is a mild antiseptic; strong versions are powerful bleaches and hazardous.', W_COR],
    ['NH3', 0, 'Ammonia', 'gas', 1, 'A sharp-smelling gas and a key ingredient in fertilizers. Factories make it with the Haber process.', W_COR],
    ['CH4', 0, 'Methane', 'gas', 1, 'The main part of natural gas. One carbon bonded to four hydrogens in a tetrahedron shape.'],
    ['HF', 0, 'Hydrogen fluoride', 'gas', 2, 'Dissolves in water to make hydrofluoric acid, which can even etch glass.', W_TOX],
    ['HCl', 0, 'Hydrogen chloride', 'gas', 1, 'Dissolves in water to make hydrochloric acid. Your stomach makes a dilute version to help digest food.', W_COR],
    ['HBr', 0, 'Hydrogen bromide', 'gas', 2, 'A gas that forms hydrobromic acid, a strong acid, when dissolved in water.', W_COR],
    ['HI', 0, 'Hydrogen iodide', 'gas', 2, 'A gas that forms hydroiodic acid, a strong acid, when dissolved in water.', W_COR],
    ['H2S', 0, 'Hydrogen sulfide', 'gas', 2, 'Smells like rotten eggs. Found around volcanoes, swamps and sewers.', W_TOX],
    ['CO', 0, 'Carbon monoxide', 'gas', 2, 'Colorless, odorless and poisonous. It forms when fuel burns without enough oxygen.', W_TOX],
    ['CO2', 0, 'Carbon dioxide', 'gas', 1, 'Plants take it in for photosynthesis and we breathe it out. It is also a greenhouse gas.'],
    ['SO2', 0, 'Sulfur dioxide', 'gas', 2, 'A sharp-smelling gas from volcanoes and from burning fuels that contain sulfur. A cause of acid rain.', W_TOX],
    ['SO3', 0, 'Sulfur trioxide', 'gas', 3, 'Reacts with water to make sulfuric acid, one of the most-made chemicals in industry.', W_COR],
    ['NO', 0, 'Nitric oxide', 'gas', 3, 'Forms in hot engines and in lightning. Your body also uses it as a signaling molecule.', W_TOX],
    ['NO2', 0, 'Nitrogen dioxide', 'gas', 3, 'A reddish-brown, sharp-smelling gas that is part of smog and acid rain.', W_TOX],
    ['N2O', 0, 'Nitrous oxide', 'gas', 3, 'Known as "laughing gas" and used by dentists for pain relief. Also a greenhouse gas.'],
    ['SiO2', 0, 'Silicon dioxide', 'solid', 1, 'Quartz and sand. A giant network of atoms, which is why it is a hard solid.'],
    ['NaCl', 0, 'Sodium chloride (table salt)', 'solid', 0, 'Table salt! Sodium gives an electron to chlorine, and the opposite charges stick together in a crystal.'],
    ['KCl', 0, 'Potassium chloride', 'solid', 1, 'Used in fertilizers and as a salt substitute.'],
    ['MgO', 0, 'Magnesium oxide', 'solid', 1, 'A white powder. It forms when magnesium burns in air with a dazzling white flame.'],
    ['CaO', 0, 'Calcium oxide (quicklime)', 'solid', 1, 'Made by heating limestone. Used in cement and to treat soil.', W_COR],
    ['CaCl2', 0, 'Calcium chloride', 'solid', 1, 'Absorbs water from the air. Used to melt ice on roads.'],
    ['MgCl2', 0, 'Magnesium chloride', 'solid', 1, 'Found in seawater. In some places it is used to make tofu (as nigari).'],
    ['Al2O3', 0, 'Aluminum oxide', 'solid', 0, 'The thin coating that protects aluminum. As the mineral corundum, its colored forms are rubies and sapphires.'],
    ['Fe2O3', 0, 'Iron(III) oxide (rust)', 'solid', 1, 'The main part of rust. Iron, oxygen and water slowly make it.'],
    ['FeO', 0, 'Iron(II) oxide', 'solid', 3, 'A black powder, another oxide of iron.'],
    ['FeS', 0, 'Iron(II) sulfide', 'solid', 1, 'A dark solid. Heating iron with sulfur makes it, a classic school demonstration.'],
    ['FeCl2', 0, 'Iron(II) chloride', 'solid', 3, 'A pale green solid.'],
    ['FeCl3', 0, 'Iron(III) chloride', 'solid', 2, 'A yellow-brown solid used to treat water and to etch circuit boards.'],
    ['CuO', 0, 'Copper(II) oxide', 'solid', 1, 'A black solid. It is what forms when copper is heated in air.'],
    ['Cu2O', 0, 'Copper(I) oxide', 'solid', 2, 'A red solid used in some pigments and paints.'],
    ['CuCl', 0, 'Copper(I) chloride', 'solid', 3, 'A white solid that slowly turns green in air.'],
    ['CuCl2', 0, 'Copper(II) chloride', 'solid', 2, 'Blue-green crystals. Copper compounds color flames green-blue.'],
    ['NiO', 0, 'Nickel(II) oxide', 'solid', 2, 'A green-black solid used in ceramics and batteries.'],
    ['TiO2', 0, 'Titanium dioxide', 'solid', 1, 'The bright white pigment in paint and sunscreen.'],
    ['MnO2', 0, 'Manganese dioxide', 'solid', 1, 'A black solid used in dry-cell batteries.'],
    ['Cr2O3', 0, 'Chromium(III) oxide', 'solid', 1, 'A green pigment.'],
    ['SnO2', 0, 'Tin(IV) oxide', 'solid', 1, 'The main ore of tin, found as the mineral cassiterite.'],
    ['ZnO', 0, 'Zinc oxide', 'solid', 1, 'A white powder found in sunscreen and diaper cream.'],
    ['ZnS', 0, 'Zinc sulfide', 'solid', 1, 'Used in glow-in-the-dark materials.'],
    ['Ag2S', 0, 'Silver sulfide', 'solid', 1, 'The black tarnish that forms on silver.'],
    ['AgCl', 0, 'Silver chloride', 'solid', 1, 'A white solid that darkens in light. It was used in old-fashioned photography.'],
    ['NaF', 0, 'Sodium fluoride', 'solid', 1, 'Added to some toothpastes to help protect teeth.'],
    ['KI', 0, 'Potassium iodide', 'solid', 1, 'Added to table salt to make iodized salt.'],
    ['NaOH', 0, 'Sodium hydroxide', 'solid', 1, 'A strong base, also called lye. Used in soap-making and drain cleaners.', W_COR],
    ['KOH', 0, 'Potassium hydroxide', 'solid', 1, 'A strong base used in soft soaps and alkaline batteries.', W_COR],
    ['LiOH', 0, 'Lithium hydroxide', 'solid', 1, 'A strong base. Spacecraft use it to scrub carbon dioxide out of the air.', W_COR],
    ['CaO2H2', 'Ca(OH)2', 'Calcium hydroxide', 'solid', 1, 'Also called slaked lime. Used in mortar and to treat soil and water.', W_COR],
    ['MgO2H2', 'Mg(OH)2', 'Magnesium hydroxide', 'solid', 1, 'The antacid known as milk of magnesia.'],
    ['NaNO3', 0, 'Sodium nitrate', 'solid', 1, 'Used in fertilizers and to preserve some foods.'],
    ['KNO3', 0, 'Potassium nitrate', 'solid', 1, 'Used as a fertilizer and a food preservative.'],
    ['HNO3', 0, 'Nitric acid', 'liquid', 1, 'A strong acid used to make fertilizers.', W_COR],
    ['CaCO3', 0, 'Calcium carbonate', 'solid', 0, 'Limestone, chalk, marble, eggshells and seashells are mostly calcium carbonate.'],
    ['MgCO3', 0, 'Magnesium carbonate', 'solid', 1, 'The white chalk that gymnasts and climbers rub on their hands.'],
    ['NaClO', 0, 'Sodium hypochlorite', 'solid', 2, 'The active ingredient in household bleach, which is a water solution of it.', W_BLE],
    ['SiC', 0, 'Silicon carbide', 'solid', 1, 'Extremely hard. Used as an abrasive in sandpaper and grinding wheels.'],
    ['BN', 0, 'Boron nitride', 'solid', 1, 'A hard, heat-resistant material sometimes called "white graphite".'],
    ['B2O3', 0, 'Boron trioxide', 'solid', 1, 'A glassy solid used to make heat-resistant glass.']
  ];
  var ANION = { F: [1, 'fluoride'], Cl: [1, 'chloride'], Br: [1, 'bromide'], I: [1, 'iodide'], O: [2, 'oxide'], S: [2, 'sulfide'], Se: [2, 'selenide'], N: [3, 'nitride'], P: [3, 'phosphide'] };
  var CATION = { Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1, Fr: 1, Be: 2, Mg: 2, Ca: 2, Sr: 2, Ba: 2, Ra: 2, Al: 3, Zn: 2, Cd: 2, Ag: 1, Ga: 3 };
  var HYD = ['Li', 'Na', 'K', 'Rb', 'Cs', 'Mg', 'Ca', 'Sr', 'Ba'];
  var UNITS = [], UBY = {};
  function addUnit(u) { u.counts = u.counts || parseF(u.f); u.size = total(u.counts); u.id = canon(u.counts); if (u.size > NSLOT) return; if (UBY[u.id]) { Object.assign(UBY[u.id], u); return; } UBY[u.id] = u; UNITS.push(u); }
  Object.keys(CATION).forEach(function (m) {   // metal + nonmetal ionic compounds that follow the charge rules
    var x = CATION[m], list = Object.keys(ANION).map(function (a) { return [a, ANION[a][0], ANION[a][1]]; });
    if (HYD.indexOf(m) >= 0) list.push(['H', 1, 'hydride']);
    list.forEach(function (a) {
      var y = a[1], g = gcd(x, y), mm = y / g, nn = x / g; if (mm + nn > NSLOT) return;
      var c = {}; c[m] = mm; c[a[0]] = (c[a[0]] || 0) + nn;
      var txt = a[0] === 'H' ? 'Hydrogen takes an electron from the metal and becomes a hydride ion (H\u207B). Hydrides like this react with water and give off hydrogen gas.' :
        'Each ' + EL[m].n.toLowerCase() + ' atom loses ' + x + (x > 1 ? ' electrons' : ' electron') + ' and each ' + EL[a[0]].n.toLowerCase() + ' atom gains ' + y + '. The opposite charges hold the crystal together.';
      addUnit({ counts: c, d: m + (mm > 1 ? sub(mm) : '') + a[0] + (nn > 1 ? sub(nn) : ''), n: EL[m].n + ' ' + a[2], st: 'solid', p: 2, t: txt, w: '', ionic: true });
    });
  });
  DB.forEach(function (r) { addUnit({ f: r[0], d: fdisp(r[1] || r[0]), n: r[2], st: r[3], p: r[4], t: r[5], w: r[6] || '' }); });

  /* ================= the mixing engine ================= */
  function countsOf(syms) { var c = {}; syms.forEach(function (s) { c[s] = (c[s] || 0) + 1; }); return c; }
  function solve(cnt) {   // the way of splitting the atoms into known compounds that uses the most atoms, then the fewest pieces
    var fit = UNITS.filter(function (u) { for (var k in u.counts) if (!cnt[k] || cnt[k] < u.counts[k]) return false; return true; });
    var best = null;
    (function rec(start, rem, chosen) {
      var left = total(rem), pri = 0; chosen.forEach(function (i) { pri += fit[i].p; });
      var score = left * 100 + chosen.length * 10 + pri;
      if (!best || score < best.score) best = { score: score, chosen: chosen.slice(), rem: Object.assign({}, rem) };
      for (var i = start; i < fit.length; i++) {
        var u = fit[i], ok = true; for (var k in u.counts) if ((rem[k] || 0) < u.counts[k]) { ok = false; break; }
        if (!ok) continue;
        var nr = Object.assign({}, rem); for (var k2 in u.counts) nr[k2] -= u.counts[k2];
        chosen.push(i); rec(i, nr, chosen); chosen.pop();
      }
    })(0, Object.assign({}, cnt), []);
    var made = {}, order = [];
    best.chosen.forEach(function (i) { var u = fit[i]; if (!made[u.id]) { made[u.id] = { u: u, n: 0 }; order.push(u.id); } made[u.id].n++; });
    var left = {}; for (var k in best.rem) if (best.rem[k] > 0) left[k] = best.rem[k];
    return { products: order.map(function (id) { return made[id]; }), left: left };
  }
  function atomsText(cnt, ref) {   // "2 H + O" (atoms listed in the order they appear in the result, otherwise by atomic number)
    var order = {}, n = 0; String(ref || '').replace(/[A-Z][a-z]?/g, function (t) { if (order[t] == null) order[t] = n++; return t; });
    return Object.keys(cnt).sort(function (a, b) { var x = order[a] == null ? 99 : order[a], y = order[b] == null ? 99 : order[b]; return x - y || EL[a].z - EL[b].z; }).map(function (k) { return (cnt[k] > 1 ? cnt[k] + ' ' : '') + k; }).join(' + ');
  }
  function leftText(left) {
    var ks = Object.keys(left); if (!ks.length) return '';
    return ks.map(function (k) { return left[k] + ' ' + EL[k].n.toLowerCase() + (left[k] > 1 ? ' atoms' : ' atom'); }).join(' and ');
  }
  function hintsFor(cnt) {   // compounds that could be built from what is in the slots plus a few more atoms
    var out = [];
    UNITS.forEach(function (u) { var ok = true; for (var k in cnt) if (!u.counts[k] || u.counts[k] < cnt[k]) { ok = false; break; } if (ok && u.size > total(cnt)) out.push(u); });
    out.sort(function (a, b) { return a.p - b.p || a.size - b.size; });
    return out.slice(0, 3);
  }
  function evaluate(syms) {
    var cnt = countsOf(syms), r = solve(cnt), eqLeft = atomsText(cnt), n = syms.length, uniq = Object.keys(cnt);
    var R = { cnt: cnt, eq: eqLeft, left: r.left, leftText: leftText(r.left), others: [] };
    if (r.products.length) {
      var main = r.products.slice().sort(function (a, b) { return b.u.size - a.u.size; })[0];
      R.kind = 'compound'; R.key = main.u.id; R.formula = main.u.d; R.name = main.u.n; R.state = main.u.st; R.text = main.u.t; R.warn = main.u.w; R.n = main.n;
      R.others = r.products.filter(function (p) { return p !== main; });
      r.products.sort(function (a, b) { return b.u.size - a.u.size || a.u.p - b.u.p; });
      R.eq = atomsText(cnt, r.products.map(function (p) { return p.u.d; }).join('')) + ' \u2192 ' + r.products.map(function (p) { return (p.n > 1 ? p.n + ' ' : '') + p.u.d; }).join(' + ') + (R.leftText ? ' + ' + Object.keys(r.left).map(function (k) { return (r.left[k] > 1 ? r.left[k] + ' ' : '') + k; }).join(' + ') : '');
      return R;
    }
    if (uniq.length === 1) {
      var s = uniq[0], e = EL[s];
      if (e.cat === 'nob') { R.kind = 'none'; R.title = 'No reaction'; R.text = e.n + ' is a noble gas. Its outer shell is already full, so it is happy on its own and does not bond with itself or with almost anything else.'; return R; }
      R.kind = 'element'; R.key = 'el:' + s; R.formula = s; R.name = e.n + (isMetal(s) ? ' metal' : ''); R.state = e.st === 'liquid' ? 'liquid' : e.st === 'gas' ? 'gas' : 'solid';
      R.text = isMetal(s) ? 'Metal atoms do not pair up into small molecules. They pack together in a lattice and share a "sea" of electrons (metallic bonding), which is why metals conduct electricity.' :
        s === 'C' ? 'Carbon atoms link into giant networks. The same atoms can make soft graphite or super-hard diamond depending on how they connect.' :
          'These atoms link up into a solid made of many atoms bonded together, not a small separate molecule.';
      R.eq = eqLeft + ' \u2192 ' + s + ' (solid piece)'; if (R.state !== 'solid') R.eq = eqLeft + ' \u2192 ' + s + ' (' + R.state + ')';
      return R;
    }
    var hs = hintsFor(cnt); R.kind = 'none'; R.title = 'Nothing stable formed';
    R.text = 'These atoms do not form a stable compound together in this simple mix.';
    R.hints = hs.map(function (u) { return u.d + ' (' + u.n.toLowerCase() + ')'; });
    return R;
  }

  /* ================= state ================= */
  var S = { open: false, view: 'hub', slots: [null, null, null, null, null], ov: null, mixing: false, lastInfo: '' };
  var root = null, mainEl = null, btn = null, D = null;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var A = function () { return window.SpectraAcad || {}; };
  var toast = function (t) { if (A().toast) A().toast(t); };
  var paint = function (el) { if (A().paint) A().paint(el || root); };
  var calm = function () { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; };
  var ICO = {
    x: 'M6 6l12 12M18 6L6 18', back: 'M15 6l-6 6 6 6', book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19a2 2 0 012-2h13', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    flask: 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3', spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17v4M17 19h4', notes: 'M6 3h9l4 4v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1zM14.5 3v4.5H19M8.5 12h7M8.5 16h5',
    chat: 'M4 5h16v11H9l-5 4z', plus: 'M12 5v14M5 12h14', play: 'M8 5v14l11-7z', lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3'
  };
  var ic = function (n, s) { return '<svg viewBox="0 0 24 24" width="' + (s || 16) + '" height="' + (s || 16) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + ICO[n] + '"/></svg>'; };

  /* Lab Book: everything you have made, saved on this device */
  function loadBook() { try { var b = JSON.parse(localStorage.getItem(BOOK_KEY)); return Array.isArray(b) ? b : []; } catch (e) { return []; } }
  function saveBook(b) { try { localStorage.setItem(BOOK_KEY, JSON.stringify(b.slice(0, 400))); } catch (e) { } }
  function bookAdd(R, syms) {   // true when it is a new discovery
    var b = loadBook(); if (b.some(function (x) { return x.k === R.key; })) return false;
    b.unshift({ k: R.key, f: R.formula, n: R.name, st: R.state, r: syms.join(','), t: Date.now() }); saveBook(b); return true;
  }

  /* ================= hub ================= */
  function hubHtml() {
    var n = loadBook().length;
    return '<div class="lb-wrap"><header class="lb-hd"><div><h2>Lab</h2><p>Hands-on science you can play with.</p></div><button type="button" class="lb-bk" data-a="book">' + ic('book') + '<span>Lab Book</span><em>' + n + '</em></button></header>' +
      '<div class="lb-cards">' +
      '<button type="button" class="lb-card" data-a="mix"><span class="lb-ci" style="--c:#7c5cff">' + ic('flask', 26) + '</span><b>Periodic Table Mixer</b><span class="lb-cd">Grab elements, drop them in 5 slots, and see what you make. Start with two hydrogens.</span><span class="lb-go">' + ic('play', 14) + 'Play</span></button>' +
      '<div class="lb-card soon" aria-disabled="true"><span class="lb-ci" style="--c:#14b8a6">' + ic('spark', 26) + '</span><b>Potion Flasks</b><span class="lb-cd">Drag, pour and tilt flasks to mix colors and reactions.</span><span class="lb-go">' + ic('lock', 14) + 'Coming soon</span></div>' +
      '</div></div>';
  }

  /* ================= mixer ================= */
  var STARTERS = [['H', 'H'], ['H', 'H', 'O'], ['Na', 'Cl'], ['C', 'O', 'O'], ['N', 'H', 'H', 'H'], ['Fe', 'Fe', 'O', 'O', 'O']];
  function tileHtml(e) {
    return '<button type="button" class="lb-el" data-sym="' + e.s + '" style="--c:' + CATS[e.cat].c + ';grid-row:' + (e.row > 7 ? e.row + 1 : e.row) + ';grid-column:' + e.col + '" aria-label="' + esc(e.n) + ', atomic number ' + e.z + '"><i>' + e.z + '</i><b>' + e.s + '</b><small>' + esc(e.n) + '</small></button>';
  }
  function tableHtml() {
    var h = '<div class="lb-ptw"><div class="lb-pt">' + LAYOUT.map(tileHtml).join('');
    h += '<span class="lb-fm" style="grid-row:6;grid-column:3;--c:' + CATS.lan.c + '">57-71</span><span class="lb-fm" style="grid-row:7;grid-column:3;--c:' + CATS.act.c + '">89-103</span>';
    h += '</div></div>';
    return h;
  }
  function slotHtml(i) {
    var s = S.slots[i], e = s && EL[s];
    return '<button type="button" class="lb-slot' + (e ? ' full' : '') + '" data-slot="' + i + '" aria-label="' + (e ? 'Slot ' + (i + 1) + ': ' + e.n + '. Press to remove.' : 'Slot ' + (i + 1) + ', empty') + '"' + (e ? ' style="--c:' + CATS[e.cat].c + '"' : '') + '>' + (e ? '<i>' + e.z + '</i><b>' + e.s + '</b>' : '<span>' + (i + 1) + '</span>') + '</button>';
  }
  function trayHtml() {
    var n = S.slots.filter(Boolean).length;
    return '<div class="lb-slots' + (S.mixing ? ' mixing' : '') + '">' + [0, 1, 2, 3, 4].map(slotHtml).join('') + '</div>' +
      '<div class="lb-act"><button type="button" class="lb-clr" data-a="clear"' + (n ? '' : ' disabled') + '>' + ic('trash', 15) + '<span>Clear</span></button>' +
      '<button type="button" class="lb-mix" data-a="domix"' + (n < 2 || S.mixing ? ' disabled' : '') + '>' + ic('spark', 17) + '<span>' + (S.mixing ? 'Mixing...' : n < 2 ? 'Add ' + (n ? 'one more' : 'elements') : 'Mix') + '</span></button></div>';
  }
  function mixHtml() {
    var h = '<div class="lb-wrap lb-m"><header class="lb-hd"><button type="button" class="lb-bk2" data-a="hub" aria-label="Back to Lab">' + ic('back', 18) + '<span>Lab</span></button><div class="lb-tt"><h2>Periodic Table Mixer</h2></div><button type="button" class="lb-bk" data-a="book">' + ic('book') + '<span>Lab Book</span><em>' + loadBook().length + '</em></button></header>';
    h += '<div class="lb-info" id="lbinfo" aria-live="polite">' + (S.lastInfo || 'Tap an element, or drag it into a slot. Press a filled slot to take it out.<span class="lb-sw"> Swipe the table sideways to see more.</span>') + '</div>';
    h += tableHtml();
    h += '<div class="lb-leg">' + Object.keys(CATS).map(function (k) { return '<span><s style="--c:' + CATS[k].c + '"></s>' + CATS[k].n + '</span>'; }).join('') + '</div>';
    h += '<div class="lb-tray" id="lbtray">' + trayHtml() + '</div>';
    h += '<div class="lb-try"><b>Try:</b>' + STARTERS.map(function (s, i) { return '<button type="button" class="lb-st" data-st="' + i + '">' + esc(atomsText(countsOf(s), s.join(' '))) + '</button>'; }).join('') + '</div></div>';
    return h;
  }
  function drawTray() {
    var t = $('#lbtray'); if (!t) return; t.innerHTML = trayHtml(); paint(t);
  }
  function setInfo(e) {
    var el = $('#lbinfo'); if (!el || !e) return;
    S.lastInfo = '<b>' + esc(e.n) + '</b> <span>' + esc(e.s) + ' \u00B7 #' + e.z + ' \u00B7 ' + e.m + ' u \u00B7 ' + CATS[e.cat].n + (e.st ? ' \u00B7 ' + e.st + ' at room temperature' : '') + '</span>';
    el.innerHTML = S.lastInfo;
  }
  function addEl(sym, at) {
    var i = at != null ? at : S.slots.indexOf(null);
    if (i < 0) { toast('All 5 slots are full. Press a slot to take an element out.'); return false; }
    S.slots[i] = sym; setInfo(EL[sym]); drawTray();
    var sl = $('[data-slot="' + i + '"]'); if (sl && !calm()) { sl.classList.add('pop'); setTimeout(function () { sl.classList.remove('pop'); }, 260); }
    return true;
  }
  function removeSlot(i) { S.slots[i] = null; drawTray(); }

  /* drag and drop with the pointer (mouse, pen and touch). Touch needs a short press so scrolling the table still works. */
  function ghostFor(sym) {
    var e = EL[sym], g = document.createElement('div'); g.className = 'lb-ghost'; g.style.setProperty('--c', CATS[e.cat].c); g.innerHTML = '<i>' + e.z + '</i><b>' + e.s + '</b>'; document.body.appendChild(g); return g;
  }
  function slotAt(x, y) {
    var els = document.elementsFromPoint(x, y);
    for (var i = 0; i < els.length; i++) { var s = els[i].closest && els[i].closest('.lb-slot'); if (s) return +s.dataset.slot; }
    return -1;
  }
  function beginDrag() {
    if (!D || D.active) return; D.active = true; clearTimeout(D.t);
    var sym = D.src.sym; D.ghost = ghostFor(sym); document.body.classList.add('lb-dragging');
    if (D.src.slot != null) { var sl = $('[data-slot="' + D.src.slot + '"]'); if (sl) sl.classList.add('lifted'); }
    moveGhost(D.px, D.py);
  }
  function moveGhost(x, y) { if (D && D.ghost) D.ghost.style.transform = 'translate(' + (x - 28) + 'px,' + (y - 32) + 'px)'; }
  function markOver(x, y) {
    var o = slotAt(x, y); document.querySelectorAll('.lb-slot.over').forEach(function (s) { s.classList.remove('over'); });
    if (o >= 0) { var s = $('[data-slot="' + o + '"]'); if (s) s.classList.add('over'); }
  }
  function endPress() {
    if (!D) return; clearTimeout(D.t); if (D.ghost) D.ghost.remove();
    document.body.classList.remove('lb-dragging'); document.querySelectorAll('.lb-slot.over,.lb-slot.lifted').forEach(function (s) { s.classList.remove('over', 'lifted'); });
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); D = null;
  }
  function onMove(e) {
    if (!D || e.pointerId !== D.id) return; D.px = e.clientX; D.py = e.clientY;
    var d = Math.hypot(e.clientX - D.x0, e.clientY - D.y0);
    if (!D.active) { if (D.touch) { if (d > 9) endPress(); return; } if (d > 5) beginDrag(); else return; }
    moveGhost(e.clientX, e.clientY); markOver(e.clientX, e.clientY);
  }
  function onUp(e) {
    if (!D || e.pointerId !== D.id) return;
    var src = D.src, active = D.active, over = slotAt(e.clientX, e.clientY); endPress();
    if (!active) {   // a plain press: add the element, or take it out of its slot
      if (src.slot != null) removeSlot(src.slot); else addEl(src.sym);
      return;
    }
    if (src.slot != null) {
      if (over >= 0 && over !== src.slot) { var t = S.slots[over]; S.slots[over] = S.slots[src.slot]; S.slots[src.slot] = t; drawTray(); }
      else if (over < 0) removeSlot(src.slot); else drawTray();
    } else if (over >= 0) addEl(src.sym, over);
  }
  function onCancel(e) { if (D && e.pointerId === D.id) endPress(); }
  function press(e, src) {
    if (e.button > 0 || S.mixing || S.ov) return; if (D) endPress();
    D = { src: src, id: e.pointerId, x0: e.clientX, y0: e.clientY, px: e.clientX, py: e.clientY, active: false, touch: e.pointerType === 'touch', t: null, ghost: null };
    if (D.touch) D.t = setTimeout(function () { if (D && !D.active) beginDrag(); }, 260);
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onCancel);
  }
  document.addEventListener('touchmove', function (e) { if (D && D.active) e.preventDefault(); }, { passive: false });

  /* ================= mixing and the result card ================= */
  function doMix() {
    var syms = S.slots.filter(Boolean); if (syms.length < 2 || S.mixing) return;
    S.mixing = true; drawTray();
    setTimeout(function () {
      S.mixing = false; var R = evaluate(syms), isNew = false;
      if (R.kind !== 'none') isNew = bookAdd(R, syms);
      R.isNew = isNew; R.syms = syms; S.ov = { k: 'res', R: R }; drawTray(); renderOv();
      var bb = $('.lb-bk em'); if (bb) bb.textContent = loadBook().length;
    }, calm() ? 0 : 750);
  }
  function stateChip(st) { return st ? '<u class="lb-sc ' + st + '">' + st.charAt(0).toUpperCase() + st.slice(1) + ' at room temperature</u>' : ''; }
  function resHtml(R) {
    var h = '<div class="lb-res' + (R.kind === 'none' ? ' none' : '') + '">';
    if (R.kind === 'none') {
      h += '<div class="lb-big none">' + ic('x', 30) + '</div><h3>' + esc(R.title) + '</h3><p class="lb-eq">' + esc(R.eq) + '</p><p class="lb-tx">' + esc(R.text) + '</p>';
      if (R.hints && R.hints.length) h += '<p class="lb-hn"><b>Try adding more atoms:</b> ' + R.hints.map(esc).join(', ') + '</p>';
      h += '<div class="lb-rb"><button type="button" class="lb-b" data-a="rclose">Try again</button><button type="button" class="lb-b pr" data-a="rclear">Clear slots</button></div></div>';
      return h;
    }
    h += (R.isNew ? '<span class="lb-new">NEW DISCOVERY</span>' : '') + '<div class="lb-big">' + esc(R.formula) + '</div><h3>' + esc(R.name) + '</h3>' + stateChip(R.state) +
      '<p class="lb-eq">' + esc(R.eq) + '</p><p class="lb-tx">' + esc(R.text) + '</p>';
    if (R.warn) h += '<p class="lb-wn">' + esc(R.warn) + '</p>';
    if (R.others.length) h += '<p class="lb-ot"><b>Also made:</b> ' + R.others.map(function (p) { return (p.n > 1 ? p.n + ' ' : '') + esc(p.u.d) + ' (' + esc(p.u.n.toLowerCase()) + ')'; }).join(', ') + '</p>';
    if (R.leftText) h += '<p class="lb-ot"><b>Left over:</b> ' + esc(R.leftText) + ' (not enough to bond)</p>';
    h += '<div class="lb-rb"><button type="button" class="lb-b" data-a="rnote">' + ic('notes', 15) + '<span>Send to Notes</span></button><button type="button" class="lb-b" data-a="rask">' + ic('chat', 15) + '<span>Ask Spectra</span></button></div>' +
      '<div class="lb-rb"><button type="button" class="lb-b" data-a="rclose">Mix again</button><button type="button" class="lb-b pr" data-a="rclear">New mix</button></div></div>';
    return h;
  }
  function bookHtml() {
    var b = loadBook();
    var h = '<header><b>Lab Book</b><button type="button" class="lb-x" data-a="ovx" aria-label="Close">' + ic('x', 17) + '</button></header>';
    if (!b.length) return h + '<div class="lb-be">' + ic('book', 28) + '<b>Nothing yet</b><span>Everything you make in the Mixer is saved here. Try mixing two hydrogens!</span></div>';
    h += '<p class="lb-bc">' + b.length + (b.length === 1 ? ' discovery' : ' discoveries') + ' on this device</p><div class="lb-bg">' + b.map(function (x, i) {
      return '<button type="button" class="lb-be2" data-bk="' + i + '"><b>' + esc(x.f) + '</b><span>' + esc(x.n) + '</span><small class="' + esc(x.st) + '">' + esc(x.st || '') + '</small></button>';
    }).join('') + '</div>';
    return h;
  }
  function ovHtml() {
    var o = S.ov; if (!o) return '';
    var pts = '';
    if (o.k === 'res' && o.R.isNew && !calm()) for (var i = 0; i < 14; i++) pts += '<i class="lb-pp" style="--a:' + (i * 360 / 14) + 'deg;--d:' + (70 + (i % 3) * 26) + 'px;--c:' + ['#7c5cff', '#14b8a6', '#f59e0b', '#ec4899', '#3b82f6'][i % 5] + '"></i>';
    return '<div class="lb-ov" id="lbov"><div class="lb-sh" role="dialog" aria-modal="true">' + (o.k === 'res' ? '<button type="button" class="lb-x abs" data-a="rclose" aria-label="Close">' + ic('x', 17) + '</button>' + pts + resHtml(o.R) : bookHtml()) + '</div></div>';
  }
  function renderOv() { var old = $('#lbov'); if (old) old.remove(); if (!S.ov || !root) return; root.insertAdjacentHTML('beforeend', ovHtml()); paint($('#lbov')); var f = $('#lbov .lb-b.pr') || $('#lbov .lb-x'); if (f) f.focus({ preventScroll: true }); }
  function ovClose() { S.ov = null; var o = $('#lbov'); if (o) o.remove(); }
  async function sendNote() {
    var o = S.ov; if (!o || o.k !== 'res') return; var R = o.R;
    if (!window.SpectraNotes || !SpectraNotes.addFromAnswer) { toast('Notes are not loaded'); return; }
    var text = R.name + ' (' + R.formula + ')\n\nMade from: ' + R.eq + '\nState at room temperature: ' + R.state + '\n\n' + R.text;
    toast('Saving to Notes...');
    try { var r = await SpectraNotes.addFromAnswer({ text: text, question: 'What is ' + R.name + ' and how does it form?', subject: 'General Sciences', msg: ('lab:' + R.key).slice(0, 60) }); toast(r && r.dup ? 'Already in your Notes' : 'Saved to Notes'); }
    catch (e) { toast(e && e.message === 'LOGIN' ? 'Log in to save notes' : e && e.message === 'SETUP' ? 'Notes need their database setup first' : 'Could not save the note'); }
  }
  function askSpectra() {
    var o = S.ov; if (!o || o.k !== 'res') return; var R = o.R, q = 'Explain how ' + R.name + ' (' + R.formula + ') forms from ' + R.eq.split('\u2192')[0].trim() + ', step by step.';
    closeLab(); var nw = $('#nw'); if (nw) nw.click();
    setTimeout(function () { var inp = $('#in'); if (inp) { inp.value = q; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); } }, 60);
  }

  /* ================= show / hide / events ================= */
  function draw() {
    if (!root || !S.open) return;
    root.innerHTML = S.view === 'mix' ? mixHtml() : hubHtml(); paint(root); renderOv();
  }
  function openLab() {
    if (!root) return; S.open = true; S.view = 'hub'; S.ov = null;
    mainEl.classList.add('labbing'); btn.classList.add('on'); var sh = $('#app'); if (sh) sh.classList.remove('drawer');
    draw(); root.scrollTop = 0;
  }
  function closeLab() {
    if (!S.open) return; if (D) endPress(); S.open = false; S.ov = null; mainEl.classList.remove('labbing'); btn.classList.remove('on');
  }
  function onClick(e) {
    var t = e.target;
    if (t.id === 'lbov') { ovClose(); return; }
    var st = t.closest('[data-st]'); if (st) { S.slots = [null, null, null, null, null]; STARTERS[+st.dataset.st].forEach(function (s, i) { S.slots[i] = s; }); drawTray(); return; }
    var bk = t.closest('[data-bk]'); if (bk) { var x = loadBook()[+bk.dataset.bk]; if (x) { var R = evaluate(x.r.split(',')); R.isNew = false; R.syms = x.r.split(','); S.ov = { k: 'res', R: R }; renderOv(); } return; }
    var sl = t.closest('[data-slot]'); if (sl && e.detail === 0) { var i = +sl.dataset.slot; if (S.slots[i]) removeSlot(i); return; }
    var el = t.closest('.lb-el'); if (el && e.detail === 0) { addEl(el.dataset.sym); return; }
    var a = t.closest('[data-a]'); if (!a) return;
    var k = a.dataset.a;
    if (k === 'mix') { S.view = 'mix'; draw(); root.scrollTop = 0; }
    else if (k === 'hub') { S.view = 'hub'; ovClose(); draw(); }
    else if (k === 'book') { S.ov = { k: 'book' }; renderOv(); }
    else if (k === 'ovx' || k === 'rclose') ovClose();
    else if (k === 'rclear' || k === 'clear') { S.slots = [null, null, null, null, null]; ovClose(); drawTray(); }
    else if (k === 'domix') doMix();
    else if (k === 'rnote') sendNote();
    else if (k === 'rask') askSpectra();
  }
  function onDown(e) {
    var el = e.target.closest && e.target.closest('.lb-el'); if (el) { press(e, { sym: el.dataset.sym }); return; }
    var sl = e.target.closest && e.target.closest('.lb-slot.full'); if (sl) { var i = +sl.dataset.slot; if (S.slots[i]) press(e, { sym: S.slots[i], slot: i }); }
  }
  function onOver(e) { var el = e.target.closest && e.target.closest('.lb-el'); if (el && e.pointerType !== 'touch') setInfo(EL[el.dataset.sym]); }
  function init() {
    root = $('#labv'); btn = $('#lab'); mainEl = $('#main'); if (!root || !btn || !mainEl) return;
    btn.addEventListener('click', function () { if (S.open) { S.view = 'hub'; S.ov = null; draw(); } else openLab(); });
    root.addEventListener('click', onClick); root.addEventListener('pointerdown', onDown); root.addEventListener('pointerover', onOver);
    root.addEventListener('contextmenu', function (e) { if (e.target.closest('.lb-el, .lb-slot')) e.preventDefault(); });
    document.addEventListener('keydown', function (e) { if (S.open && e.key === 'Escape' && S.ov) { ovClose(); e.preventDefault(); } });
    var side = $('#side');   // opening Notes, a chat or a new chat leaves the Lab
    if (side) side.addEventListener('click', function (e) { if (S.open && e.target.closest('#nt, .ac-it, .ac-new, [data-pn]')) closeLab(); }, true);
  }

  window.SpectraLab = { open: openLab, close: closeLab, evaluate: function (syms) { return evaluate(syms); }, _t: { EL: EL, UNITS: UNITS, LAYOUT: LAYOUT } };
  init();
})();
