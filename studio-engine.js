/* SPECSOFT® Studio, PHASE 3 + 4: execution engine.
   PHASE 3: snapshot runs, parallel branches of flow, join on several inputs, Start/Pause/Resume/Stop/Restart.
   PHASE 4: three delays per node, JavaScript nodes, nested branches (execution groups).

   SECURITY (script nodes): user code is untrusted. Each script runs in a Web Worker that lives inside a
   sandboxed iframe (sandbox="allow-scripts" only, so an opaque origin: no cookies, no storage, no access to
   the page or the Supabase session) with a CSP that blocks all network access. The worker is a separate
   thread, so an endless loop cannot freeze the page: the time limit removes the iframe, which kills it.
   Scripts only get the explicit studio.* functions below. Messages are validated (source window + secret token).
   Pause = no new step starts (steps already running finish). Stop = cancels everything for good. */
(function () {
    'use strict';
    var STEP = 300, MAX_RUNS = 20, MAX_DEPTH = 5, MAX_EXEC = 500, MAX_SPAWN = 25, MAX_OUT = 100000, CANCEL = { cancelled: true };
    var G = window.StudioGraph, runs = [], cur = null, seq = 0;
    function $(id) { return document.getElementById(id); }
    function noop() {}
    function active() { return !!cur && !cur.ended; }
    function msg(e) { return String((e && e.message) || e).slice(0, 300); }

    function topo(g) {                                   // Kahn: node ids in run order, or null when there is a loop
        var indeg = {}, adj = {}, out = [];
        g.nodes.forEach(function (n) { indeg[n.id] = 0; adj[n.id] = []; });
        g.connections.forEach(function (c) { if (adj[c.from] && c.to in indeg) { adj[c.from].push(c.to); indeg[c.to]++; } });
        var q = Object.keys(indeg).filter(function (k) { return !indeg[k]; });
        while (q.length) { var k = q.shift(); out.push(k); adj[k].forEach(function (t) { if (--indeg[t] === 0) q.push(t); }); }
        return out.length === g.nodes.length ? out : null;
    }

    /* ---- execution groups: the root graph and every running branch is one group ---- */
    function mkGroup(run, name, parent) {
        var g = { id: ++run.gseq, name: name, dead: false, done: false, sleepers: new Set(), killers: new Set(), kids: [], results: {} };
        if (parent) parent.kids.push(g); return g;
    }
    function killGroup(g) {
        g.dead = true;
        g.sleepers.forEach(function (s) { clearTimeout(s.t); s.rej(CANCEL); }); g.sleepers.clear();
        g.killers.forEach(function (k) { k(); }); g.killers.clear();
        g.kids.forEach(killGroup);
    }
    function dead(run, g) { return run.cancelled || g.dead; }
    function gate(run, g) {
        if (dead(run, g)) return Promise.reject(CANCEL);
        if (!run.paused) return Promise.resolve();
        return new Promise(function (res) { run.waiters.push(res); }).then(function () { if (dead(run, g)) throw CANCEL; });
    }
    function sleep(g, ms) {
        return new Promise(function (res, rej) {
            if (g.dead) return rej(CANCEL);
            var s = { rej: rej }; s.t = setTimeout(function () { g.sleepers.delete(s); res(); }, ms); g.sleepers.add(s);
        });
    }
    function cancelRun(run) { run.cancelled = true; killGroup(run.root); run.waiters.splice(0).forEach(function (w) { w(); }); }

    function ev(run, sev, text, n) {
        run.events.push({ t: Date.now() - run.startedAt, sev: sev, node: n ? n.label : '', msg: text });
        G.log(sev, n && n.type === 'script' ? 'script' : 'run', (n ? n.label + ' ' : '') + text, n && n.id);
    }
    function setS(run, n, s) { run.st[n.id] = s; G.setStatus(n.id, s); }

    /* ---- sandbox: both functions are stringified into the iframe, so they must stay self-contained ---- */
    function workerMain() {                              // runs inside the Worker
        var pend = {}, seq = 0;
        function call(fn, args) { return new Promise(function (res, rej) { var id = ++seq; pend[id] = { res: res, rej: rej }; postMessage({ t: 'call', id: id, fn: fn, args: args }); }); }
        function fmt(a) { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch (e) { return String(a); } }
        function lineOf(err) { var m = /<anonymous>:(\d+):\d+/.exec((err && err.stack) || ''); return m ? Math.max(1, +m[1] - 2) : 0; }
        var studio = {
            delay: function (ms) { return new Promise(function (r) { setTimeout(r, Math.min(Math.max(+ms || 0, 0), 30000)); }); },
            log: function () { call('log', [].slice.call(arguments).map(fmt)).catch(function () {}); },
            runNode: function (l) { return call('runNode', [String(l)]); },
            enableNode: function (l) { return call('enableNode', [String(l)]); },
            disableNode: function (l) { return call('disableNode', [String(l)]); },
            spawnBranch: function (l) { return call('spawnBranch', [String(l)]); },
            stopGroup: function (l) { return call('stopGroup', [String(l)]); },
            result: function (l) { return call('result', [String(l)]); }
        };
        console.log = console.info = studio.log;
        console.warn = function () { studio.log.apply(null, ['[warn]'].concat([].slice.call(arguments))); };
        console.error = function () { studio.log.apply(null, ['[error]'].concat([].slice.call(arguments))); };
        var AF = Object.getPrototypeOf(async function () {}).constructor;
        onmessage = function (e) {
            var m = e.data || {};
            if (m.t === 'ret') { var p = pend[m.id]; if (p) { delete pend[m.id]; if (m.err) p.rej(new Error(m.err)); else p.res(m.value); } }
            else if (m.t === 'run') {
                (async function () {
                    try { var v = await new AF('studio', 'input', String(m.code))(studio, m.input); postMessage({ t: 'done', value: v }); }
                    catch (err) { postMessage({ t: 'err', name: String((err && err.name) || 'Error'), message: String((err && err.message) || err), line: lineOf(err) }); }
                })();
            }
        };
    }
    function sandboxMain(K, wsrc) {                      // runs inside the sandboxed iframe: relays between page and worker
        var w = new Worker(URL.createObjectURL(new Blob([wsrc], { type: 'text/javascript' })));
        function send(m) { m.k = K; parent.postMessage(m, '*'); }
        w.onmessage = function (e) { if (e.data && typeof e.data === 'object') send(e.data); };
        w.onerror = function (e) { send({ t: 'err', name: 'Error', message: String(e.message || 'Worker error'), line: 0 }); };
        addEventListener('message', function (e) { if (e.source === parent && e.data && e.data.k === K) w.postMessage(e.data); });
        send({ t: 'ready' });
    }
    function srcdoc(token) {
        var w = '(' + workerMain.toString() + ')()';
        return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob:"><script>(' +
            sandboxMain.toString() + ')(' + JSON.stringify(token) + ',' + JSON.stringify(w).replace(/</g, '\\u003c') + ')<\/script>';
    }
    function newToken() {
        var a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
        return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    function cleanOut(v) {
        var s = JSON.stringify(v); if (s === undefined) return undefined;
        if (s.length > MAX_OUT) throw new Error('Output is too large (100 KB max)');
        return JSON.parse(s);
    }

    /* The ONLY functions a script can reach. Every argument is validated here, in the page. */
    async function callApi(ctx, n, fn, args) {
        var run = ctx.run, grp = ctx.grp;
        function target(l) {
            if (typeof l !== 'string' || !/^[A-Za-z0-9_ -]{1,20}$/.test(l)) throw new Error('Invalid node label');
            var t = ctx.byLabel[l]; if (!t) throw new Error('No node named ' + l + ' in this graph'); return t;
        }
        var t;
        if (fn === 'log') { G.log('info', 'script', args.slice(0, 10).map(function (a) { return String(a).slice(0, 300); }).join(' '), n.id); return null; }
        if (fn === 'result') { t = target(args[0]); var r0 = grp.results[t.label]; return r0 === undefined ? null : r0; }
        if (fn === 'enableNode' || fn === 'disableNode') { t = target(args[0]); t.enabled = fn === 'enableNode'; ev(run, 'info', (t.enabled ? 'enabled ' : 'disabled ') + t.label + ' (this run only)', n); return null; }
        if (fn === 'runNode') {
            t = target(args[0]);
            if (t === n || run.stack.indexOf(t.id) > -1) throw new Error('Blocked: ' + t.label + ' is already running (no recursion)');
            if (!t.enabled) throw new Error(t.label + ' is disabled');
            await perform(ctx, t); var r1 = grp.results[t.label]; return r1 === undefined ? null : r1;
        }
        if (fn === 'spawnBranch') {
            t = target(args[0]); if (t.type !== 'branch') throw new Error(t.label + ' is not a branch');
            if (++run.spawns > MAX_SPAWN) throw new Error('Spawn limit reached (' + MAX_SPAWN + ' per run)');
            branchBg(ctx, t); return null;
        }
        if (fn === 'stopGroup') {
            var name = String(args[0]), hit = 0;
            grp.kids.forEach(function (k) { if (k.name === name && !k.dead && !k.done) { killGroup(k); hit++; } });
            if (!hit) throw new Error('No running group named ' + name);
            ev(run, 'warn', 'stopped group ' + name, n); return null;
        }
        throw new Error('Unknown studio function');
    }

    function runScript(ctx, n) {
        var run = ctx.run, grp = ctx.grp, c = n.config, code = String(c.code || '');
        if (!code.trim()) { ev(run, 'warn', 'has no code, nothing to run', n); return Promise.resolve(undefined); }
        var input = {};
        (ctx.ups[n.id] || []).forEach(function (f) { var u = ctx.byId[f]; if (u && u.label in grp.results) input[u.label] = grp.results[u.label]; });
        return new Promise(function (resolve, reject) {
            var token = newToken(), ms = c.timeout || 5000, finished = false, timer;
            var frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('aria-hidden', 'true'); frame.style.display = 'none';
            function finish(fn, v) { if (finished) return; finished = true; clearTimeout(timer); window.removeEventListener('message', onMsg); grp.killers.delete(kill); frame.remove(); fn(v); }
            function kill() { finish(reject, CANCEL); }
            function reply(r) { if (finished) return; r.k = token; try { frame.contentWindow.postMessage(r, '*'); } catch (e) {} }
            function onMsg(e) {
                if (e.source !== frame.contentWindow) return;
                var m = e.data; if (!m || typeof m !== 'object' || m.k !== token) return;
                if (m.t === 'ready') reply({ t: 'run', code: code, input: input });
                else if (m.t === 'call') {
                    if (typeof m.id !== 'number' || typeof m.fn !== 'string') return;
                    var id = m.id, args = Array.isArray(m.args) ? m.args.slice(0, 10) : [];
                    callApi(ctx, n, m.fn, args).then(function (v) { reply({ t: 'ret', id: id, value: v }); }, function (err) { reply({ t: 'ret', id: id, err: msg(err) }); });
                }
                else if (m.t === 'done') { try { finish(resolve, cleanOut(m.value)); } catch (err) { finish(reject, err); } }
                else if (m.t === 'err') finish(reject, new Error(String(m.name || 'Error').slice(0, 40) + ': ' + String(m.message || '').slice(0, 300) + (m.line ? ' (line ' + (m.line | 0) + ', approximate)' : '')));
            }
            grp.killers.add(kill);
            timer = setTimeout(function () { finish(reject, new Error('Script timed out after ' + ms + ' ms and was stopped')); }, ms);
            window.addEventListener('message', onMsg);
            frame.srcdoc = srcdoc(token); document.body.appendChild(frame);
        });
    }

    /* ---- branches ---- */
    function branchRun(ctx, n) {
        var run = ctx.run, sub = (n.config && n.config.sub) || { nodes: [], connections: [] };
        if (ctx.depth >= MAX_DEPTH) return Promise.reject(new Error('Branch nesting limit reached (' + MAX_DEPTH + ')'));
        var grp = mkGroup(run, n.label, ctx.grp);
        if (!sub.nodes.length) { ev(run, 'warn', 'branch is empty', n); grp.done = true; return Promise.resolve(grp); }
        ev(run, 'info', 'branch started (' + sub.nodes.length + ' nodes)', n);
        return execGraph(run, grp, sub, ctx.depth + 1).then(function () { grp.done = true; ev(run, 'ok', 'branch completed', n); return grp; }, function (e) {
            if (e === CANCEL && grp.dead && !run.cancelled) { grp.done = true; grp.stopped = true; ev(run, 'warn', 'branch stopped early', n); return grp; }
            throw e;
        });
    }
    function branchBg(ctx, n) {                          // independent: parent does not wait
        var run = ctx.run;
        run.bg.push(branchRun(ctx, n).then(noop, function (e) {
            if (e !== CANCEL) { run.hadError = true; ev(run, 'error', 'branch failed' + (e && e.wrapped ? '' : ': ' + msg(e)), n); }
        }));
    }

    /* ---- one node: activation delay, execution delay, operation, output delay ---- */
    async function perform(ctx, n) {
        var run = ctx.run, grp = ctx.grp, c = n.config || {}, out, stopped = false;
        if (++run.execs > MAX_EXEC) throw new Error('Run limit reached (' + MAX_EXEC + ' node executions)');
        run.stack.push(n.id);
        try {
            if (c.aDelay) { ev(run, 'info', 'activation delay ' + c.aDelay + ' ms', n); await sleep(grp, c.aDelay); await gate(run, grp); }
            setS(run, n, 'running'); ev(run, 'info', 'started', n);
            if (c.eDelay) { ev(run, 'info', 'execution delay ' + c.eDelay + ' ms', n); await sleep(grp, c.eDelay); await gate(run, grp); }
            if (n.type === 'script') out = await runScript(ctx, n);
            else if (n.type === 'branch') { if (c.mode === 'independent') { branchBg(ctx, n); ev(run, 'info', 'branch runs independently', n); } else { var bg = await branchRun(ctx, n); out = bg.results; stopped = !!bg.stopped; } }
            else await sleep(grp, STEP);
            await gate(run, grp);
            if (c.oDelay) { ev(run, 'info', 'holding output ' + c.oDelay + ' ms', n); await sleep(grp, c.oDelay); await gate(run, grp); }
            if (out !== undefined) grp.results[n.label] = out;
            setS(run, n, stopped ? 'stopped' : 'done');
            ev(run, 'ok', 'finished' + (out !== undefined ? ' with output ' + JSON.stringify(out).slice(0, 80) : ''), n);
        } finally { run.stack.splice(run.stack.lastIndexOf(n.id), 1); }
    }
    async function runNode(ctx, n, ups) {
        var run = ctx.run;
        try {
            await Promise.all(ups); await gate(run, ctx.grp);
            if (!n.enabled) { setS(run, n, 'skipped'); ev(run, 'warn', 'skipped (disabled)', n); return; }
            await perform(ctx, n);
        } catch (e) {
            if (e === CANCEL) throw e;
            if (!(e && e.wrapped)) { run.hadError = true; setS(run, n, 'error'); ev(run, 'error', 'failed: ' + msg(e), n); e = { wrapped: true, error: e }; }
            else if (run.st[n.id] === 'running') setS(run, n, 'error');
            throw e;
        }
    }
    function execGraph(run, grp, graph, depth) {
        var order = topo(graph);
        if (!order) return Promise.reject(new Error('A branch contains a loop'));
        var ctx = { run: run, grp: grp, depth: depth, byId: {}, byLabel: {}, ups: {} }, P = {};
        graph.nodes.forEach(function (n) { ctx.byId[n.id] = n; if (!(n.label in ctx.byLabel)) ctx.byLabel[n.label] = n; if (n.enabled) setS(run, n, 'waiting'); });
        graph.connections.forEach(function (c) { (ctx.ups[c.to] = ctx.ups[c.to] || []).push(c.from); });
        order.forEach(function (id) { P[id] = runNode(ctx, ctx.byId[id], (ctx.ups[id] || []).map(function (f) { return P[f]; })); P[id].catch(noop); });
        return Promise.all(order.map(function (id) { return P[id]; }));
    }
    async function drain(run) { while (run.bg.length) { var b = run.bg.splice(0); await Promise.all(b); } }

    function finalize(run, status) {
        if (run.ended) return;
        if (status === 'done' && run.hadError) status = 'error';
        run.ended = true; run.status = status; run.endedAt = Date.now();
        Object.keys(run.st).forEach(function (id) {
            if (run.st[id] === 'running') G.setStatus(id, 'stopped'); else if (run.st[id] === 'waiting') G.setStatus(id, 'idle');
        });
        ev(run, status === 'done' ? 'ok' : status === 'error' ? 'error' : 'warn', 'Run ' + run.id + ' ' + status + ' in ' + ((run.endedAt - run.startedAt) / 1000).toFixed(1) + 's');
        runs.unshift(run); if (runs.length > MAX_RUNS) runs.pop();
        refresh(); renderHist();
    }

    /* ---- public controls ---- */
    var E = window.StudioEngine = {};
    E.start = function () {
        if (!G.isOpen()) return;
        if (active()) return G.log('warn', 'run', 'A run is already active. Stop it or use Restart.');
        var g = G.get();
        if (!g.nodes.length) return G.log('warn', 'run', 'Nothing to run. Add some nodes first.');
        if (!topo(g)) return G.log('error', 'run', 'This graph contains a loop, so it cannot run.');
        G.resetStatus();
        var run = cur = { id: ++seq, status: 'running', startedAt: Date.now(), endedAt: 0, events: [], paused: false, cancelled: false, ended: false, hadError: false,
            st: {}, waiters: [], gseq: 0, execs: 0, spawns: 0, bg: [], stack: [], root: null };
        run.root = mkGroup(run, 'root', null);
        ev(run, 'info', 'Run ' + run.id + ' started (' + g.nodes.length + ' nodes)');
        execGraph(run, run.root, g, 0).then(function () { return drain(run); }).then(
            function () { finalize(run, 'done'); },
            function (err) { if (run.ended || (err === CANCEL && run.cancelled)) return; if (err === CANCEL) err = new Error('A group was stopped unexpectedly'); if (!(err && err.wrapped)) { run.hadError = true; ev(run, 'error', 'Run failed: ' + msg(err)); } cancelRun(run); finalize(run, 'error'); });
        refresh();
    };
    E.pause = function () {
        if (!active() || cur.status !== 'running') return;
        cur.paused = true; cur.status = 'paused'; ev(cur, 'warn', 'Run ' + cur.id + ' paused (running steps finish, no new steps start)'); refresh();
    };
    E.resume = function () {
        if (!active() || cur.status !== 'paused') return;
        cur.paused = false; cur.status = 'running'; cur.waiters.splice(0).forEach(function (w) { w(); }); ev(cur, 'ok', 'Run ' + cur.id + ' resumed'); refresh();
    };
    E.stop = function () { if (!active()) return; var r = cur; cancelRun(r); finalize(r, 'stopped'); };
    E.restart = function () { if (active()) E.stop(); E.start(); };

    /* ---- UI ---- */
    function refresh() {
        var open = G.isOpen(), a = active(), st = a ? cur.status : 'idle';
        $('stRunStart').disabled = !open || a; $('stRunPause').disabled = st !== 'running'; $('stRunResume').disabled = st !== 'paused';
        $('stRunStop').disabled = !a; $('stRunRestart').disabled = !open;
        $('stRunState').textContent = a ? 'Run ' + cur.id + ' ' + st : 'Idle';
    }
    function renderHist() {
        var box = $('stHist'); box.textContent = '';
        if (!runs.length) { var p = document.createElement('p'); p.className = 'st-hint'; p.textContent = 'No runs yet. Press Start to run the graph.'; box.appendChild(p); return; }
        runs.forEach(function (r) {
            var d = document.createElement('details'), s = document.createElement('summary');
            s.textContent = 'Run ' + r.id + ', ' + r.status + ', ' + ((r.endedAt - r.startedAt) / 1000).toFixed(1) + 's, ' + r.events.length + ' events';
            d.appendChild(s);
            r.events.forEach(function (e) {
                var row = document.createElement('div'); row.className = e.sev;
                [(e.t / 1000).toFixed(2) + 's', e.sev, e.node || 'run', e.msg].forEach(function (t) { var c = document.createElement('span'); c.textContent = t; row.appendChild(c); });
                d.appendChild(row);
            });
            box.appendChild(d);
        });
    }
    G.onReset = function () { if (active()) E.stop(); refresh(); };
    $('stRunStart').addEventListener('click', E.start); $('stRunPause').addEventListener('click', E.pause);
    $('stRunResume').addEventListener('click', E.resume); $('stRunStop').addEventListener('click', E.stop); $('stRunRestart').addEventListener('click', E.restart);
    refresh(); renderHist();
})();
