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
    var STEP = 300, MAX_RUNS = 20, MAX_DEPTH = 5, MAX_EXEC = 500, MAX_SPAWN = 25, MAX_OUT = 100000, MAX_ROWS = 1000, CANCEL = { cancelled: true };
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
    function gate(run, g, ctl) {
        if (dead(run, g) || (ctl && ctl.dead)) return Promise.reject(CANCEL);
        if (!run.paused && !(ctl && ctl.paused)) return Promise.resolve();
        return new Promise(function (res) { (run.paused ? run.waiters : ctl.waiters).push(res); }).then(function () { return gate(run, g, ctl); });
    }
    function sleep(g, ms, ctl) {
        return new Promise(function (res, rej) {
            if (g.dead || (ctl && ctl.dead)) return rej(CANCEL);
            var s = { rej: rej };
            s.t = setTimeout(function () { g.sleepers.delete(s); if (ctl) ctl.sleepers.delete(s); res(); }, ms);
            g.sleepers.add(s); if (ctl) ctl.sleepers.add(s);
        });
    }
    function killCtl(c) {                                // stops ONE node's execution (used by timeline stop markers)
        c.dead = true;
        c.sleepers.forEach(function (s) { clearTimeout(s.t); s.rej(CANCEL); }); c.sleepers.clear();
        c.killers.forEach(function (k) { k(); }); c.killers.clear();
        c.waiters.splice(0).forEach(function (w) { w(); });
    }

    /* ---- Phase 5: timeline clock, scheduled markers, events ---- */
    function clockNow(run) { return run.clockAcc + (run.paused ? 0 : Date.now() - run.clockStart); }
    function schedAdd(run, it) { run.sched.push(it); run.sched.sort(function (a, b) { return a.t - b.t; }); }
    function waitClock(run, grp, t) {
        return new Promise(function (res, rej) {
            var it = { t: t, fn: function () { grp.killers.delete(k); res(); } };
            function k() { var i = run.sched.indexOf(it); if (i > -1) run.sched.splice(i, 1); rej(CANCEL); }
            grp.killers.add(k); schedAdd(run, it);
        });
    }
    function waitEvent(run, grp, name) {
        return new Promise(function (res, rej) {
            if (run.fired[name]) return res();
            var w = function () { grp.killers.delete(k); res(); };
            function k() { var l = run.evWait[name] || [], i = l.indexOf(w); if (i > -1) l.splice(i, 1); rej(CANCEL); }
            (run.evWait[name] = run.evWait[name] || []).push(w); grp.killers.add(k);
        });
    }
    function emit(run, name) { run.fired[name] = true; ev(run, 'info', 'event "' + name + '" fired'); (run.evWait[name] || []).splice(0).forEach(function (w) { w(); }); }
    function fire(run, id, m) {
        var n = run.nodes[id], ctl = run.active[id]; if (!n) return;
        if (m.a === 'stop') { run.blocked[id] = true; ev(run, 'warn', 'timeline: stop', n); if (ctl) killCtl(ctl); }
        else if (m.a === 'pause') { if (ctl) { ctl.paused = true; ev(run, 'warn', 'timeline: paused', n); } else ev(run, 'warn', 'timeline: pause ignored (not running)', n); }
        else if (m.a === 'resume') { if (ctl && ctl.paused) { ctl.paused = false; ctl.waiters.splice(0).forEach(function (w) { w(); }); ev(run, 'ok', 'timeline: resumed', n); } }
        else if (m.a === 'wait') {
            if (!ctl) return ev(run, 'warn', 'timeline: wait ignored (not running)', n);
            ctl.paused = true; ev(run, 'warn', 'timeline: holding for ' + m.d + ' ms', n);
            schedAdd(run, { t: clockNow(run) + m.d, fn: function () { if (ctl.paused) { ctl.paused = false; ctl.waiters.splice(0).forEach(function (w) { w(); }); } } });
        }
        else if (m.a === 'toggle') { n.enabled = !n.enabled; ev(run, 'info', 'timeline: ' + (n.enabled ? 'enabled' : 'disabled'), n); }
        else if (m.a === 'spawn') {
            if (n.type !== 'branch' || !run.ctxs[id]) return ev(run, 'warn', 'timeline: spawn needs a branch node', n);
            if (++run.spawns > MAX_SPAWN) return ev(run, 'error', 'timeline: spawn limit reached', n);
            ev(run, 'info', 'timeline: spawn', n); branchBg(run.ctxs[id], n);
        }
        else if (m.a === 'custom') emit(run, m.name || 'event');
    }
    function setupTimeline(run, g) {
        run.db = JSON.parse(JSON.stringify(g.db || { tables: {} })); run.tl = g.timeline || { tracks: [] };
        (function walk(list) { list.forEach(function (n) { run.nodes[n.id] = n; if (n.config && n.config.sub) walk(n.config.sub.nodes); }); })(g.nodes);
        (run.tl.tracks || []).forEach(function (tr) {
            if (tr.type !== 'node' || !run.nodes[tr.nodeId]) return;
            tr.markers.forEach(function (m) {
                if (m.a === 'start') run.startAt[tr.nodeId] = Math.min(m.t, run.startAt[tr.nodeId] === undefined ? Infinity : run.startAt[tr.nodeId]);
                else schedAdd(run, { t: m.t, fn: function () { fire(run, tr.nodeId, m); } });
            });
        });
        run.tickId = setInterval(function () { tick(run); }, 25);
    }
    function tick(run) {
        if (run.ended || run.paused) return;
        var now = clockNow(run);
        while (run.sched.length && run.sched[0].t <= now) { var it = run.sched.shift(); try { it.fn(); } catch (e) { run.hadError = true; ev(run, 'error', 'timeline failed: ' + msg(e)); } }
        if (window.StudioTimeline) StudioTimeline.setPlayhead(now);
    }
    function finishExtras(run, status) {
        clearInterval(run.tickId); run.sched.length = 0;
        if (run.dbChanged) {
            if (status === 'done' && window.StudioData) StudioData.commit(run.db, run.id);
            else ev(run, 'warn', 'Database changes were discarded because the run ended as ' + status);
        }
        if (window.StudioTimeline) StudioTimeline.setPlayhead(clockNow(run));
    }
    function runSql(run, n) {
        var r = StudioSQL.exec(run.db, n.config.sql || '', []); if (r.changed) run.dbChanged = true;
        return r.isSelect ? r.rows.slice(0, MAX_ROWS) : { changes: r.changes };
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
            result: function (l) { return call('result', [String(l)]); },
            emit: function (n) { return call('emit', [String(n)]); },
            value: function (n) { return call('value', [String(n)]); },
            time: function () { return call('time', []); },
            sql: function (q, p) { return call('sql', [String(q), Array.isArray(p) ? p : []]); }
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
            var c2 = Object.create(ctx); c2.ctl = null; branchBg(c2, t); return null;
        }
        if (fn === 'stopGroup') {
            var name = String(args[0]), hit = 0;
            grp.kids.forEach(function (k) { if (k.name === name && !k.dead && !k.done) { killGroup(k); hit++; } });
            if (!hit) throw new Error('No running group named ' + name);
            ev(run, 'warn', 'stopped group ' + name, n); return null;
        }
        if (fn === 'emit') { var en = String(args[0]); if (!/^[A-Za-z0-9_-]{1,20}$/.test(en)) throw new Error('Invalid event name'); emit(run, en); return null; }
        if (fn === 'time') return clockNow(run);
        if (fn === 'value') {
            var vn = String(args[0]); if (!/^[A-Za-z0-9_ -]{1,20}$/.test(vn)) throw new Error('Invalid value name');
            return window.StudioTimeline ? StudioTimeline.valueAt(run.tl, vn, clockNow(run)) : null;
        }
        if (fn === 'sql') {
            var q = args[0], ps = args[1] === undefined ? [] : args[1];
            if (typeof q !== 'string') throw new Error('studio.sql needs a SQL string');
            if (!Array.isArray(ps) || ps.length > 20 || ps.some(function (x) { return x !== null && ['string', 'number', 'boolean'].indexOf(typeof x) < 0; })) throw new Error('Parameters must be up to 20 text, number, boolean or null values');
            var r = StudioSQL.exec(run.db, q, ps); if (r.changed) run.dbChanged = true;
            return { rows: r.rows.slice(0, MAX_ROWS), changes: r.changes, lastId: r.lastId };
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
            function finish(fn, v) { if (finished) return; finished = true; clearTimeout(timer); window.removeEventListener('message', onMsg); grp.killers.delete(kill); if (ctx.ctl) ctx.ctl.killers.delete(kill); frame.remove(); fn(v); }
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
            grp.killers.add(kill); if (ctx.ctl) ctx.ctl.killers.add(kill);
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
        if (ctx.ctl) ctx.ctl.killers.add(function () { killGroup(grp); });
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
        var ctl = { dead: false, paused: false, sleepers: new Set(), killers: new Set(), waiters: [] }, cx = Object.create(ctx);
        cx.ctl = ctl; run.active[n.id] = ctl; run.stack.push(n.id);
        try {
            if (c.aDelay) { ev(run, 'info', 'activation delay ' + c.aDelay + ' ms', n); await sleep(grp, c.aDelay, ctl); await gate(run, grp, ctl); }
            setS(run, n, 'running'); ev(run, 'info', 'started', n);
            if (c.eDelay) { ev(run, 'info', 'execution delay ' + c.eDelay + ' ms', n); await sleep(grp, c.eDelay, ctl); await gate(run, grp, ctl); }
            if (n.type === 'script') out = (c.lang === 'html' || c.lang === 'css') ? cleanOut({ lang: c.lang, content: String(c.code || '') }) : await runScript(cx, n);
            else if (n.type === 'database') out = runSql(run, n);
            else if (n.type === 'branch') {
                if (c.mode === 'independent') { branchBg(ctx, n); ev(run, 'info', 'branch runs independently', n); }
                else { var bg = await branchRun(cx, n); out = bg.results; stopped = !!bg.stopped; }
            }
            else await sleep(grp, STEP, ctl);
            await gate(run, grp, ctl);
            if (c.oDelay) { ev(run, 'info', 'holding output ' + c.oDelay + ' ms', n); await sleep(grp, c.oDelay, ctl); await gate(run, grp, ctl); }
            if (out !== undefined) grp.results[n.label] = out;
            setS(run, n, stopped ? 'stopped' : 'done');
            ev(run, 'ok', 'finished' + (out !== undefined ? ' with output ' + JSON.stringify(out).slice(0, 80) : ''), n);
        } catch (e) {
            if (e === CANCEL && ctl.dead && !grp.dead && !run.cancelled) { setS(run, n, 'stopped'); ev(run, 'warn', 'stopped by the timeline', n); return; }
            throw e;
        } finally { delete run.active[n.id]; var si = run.stack.lastIndexOf(n.id); if (si > -1) run.stack.splice(si, 1); }
    }
    async function runNode(ctx, n, ups) {
        var run = ctx.run, grp = ctx.grp;
        try {
            await Promise.all(ups); await gate(run, grp);
            var t0 = run.startAt[n.id];
            if (t0 > 0 && clockNow(run) < t0) { ev(run, 'info', 'waiting for its timeline start (' + t0 + ' ms)', n); await waitClock(run, grp, t0); await gate(run, grp); }
            var wev = n.config && n.config.waitEvent;
            if (wev && !run.fired[wev]) { ev(run, 'info', 'waiting for event "' + wev + '"', n); await waitEvent(run, grp, wev); await gate(run, grp); }
            if (run.blocked[n.id]) { setS(run, n, 'stopped'); ev(run, 'warn', 'stopped by the timeline before it started', n); return; }
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
        graph.nodes.forEach(function (n) { ctx.byId[n.id] = n; run.ctxs[n.id] = ctx; if (!(n.label in ctx.byLabel)) ctx.byLabel[n.label] = n; if (n.enabled) setS(run, n, 'waiting'); });
        graph.connections.forEach(function (c) { (ctx.ups[c.to] = ctx.ups[c.to] || []).push(c.from); });
        order.forEach(function (id) { P[id] = runNode(ctx, ctx.byId[id], (ctx.ups[id] || []).map(function (f) { return P[f]; })); P[id].catch(noop); });
        return Promise.all(order.map(function (id) { return P[id]; }));
    }
    async function drain(run) { while (run.bg.length) { var b = run.bg.splice(0); await Promise.all(b); } }

    function finalize(run, status) {
        if (run.ended) return;
        if (status === 'done' && run.hadError) status = 'error';
        run.ended = true; run.status = status; run.endedAt = Date.now(); finishExtras(run, status);
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
            st: {}, waiters: [], gseq: 0, execs: 0, spawns: 0, bg: [], stack: [], root: null,
            startAt: {}, blocked: {}, fired: {}, evWait: {}, sched: [], active: {}, nodes: {}, ctxs: {}, db: null, dbChanged: false, clockAcc: 0, clockStart: Date.now(), tickId: 0, tl: null };
        run.root = mkGroup(run, 'root', null); setupTimeline(run, g);
        ev(run, 'info', 'Run ' + run.id + ' started (' + g.nodes.length + ' nodes)');
        execGraph(run, run.root, g, 0).then(function () { return drain(run); }).then(
            function () { finalize(run, 'done'); },
            function (err) { if (run.ended || (err === CANCEL && run.cancelled)) return; if (err === CANCEL) err = new Error('A group was stopped unexpectedly'); if (!(err && err.wrapped)) { run.hadError = true; ev(run, 'error', 'Run failed: ' + msg(err)); } cancelRun(run); finalize(run, 'error'); });
        refresh();
    };
    E.pause = function () {
        if (!active() || cur.status !== 'running') return;
        cur.clockAcc = clockNow(cur); cur.paused = true; cur.status = 'paused'; ev(cur, 'warn', 'Run ' + cur.id + ' paused (running steps finish, no new steps start)'); refresh();
    };
    E.resume = function () {
        if (!active() || cur.status !== 'paused') return;
        cur.clockStart = Date.now(); cur.paused = false; cur.status = 'running'; cur.waiters.splice(0).forEach(function (w) { w(); }); ev(cur, 'ok', 'Run ' + cur.id + ' resumed'); refresh();
    };
    E.stop = function () { if (!active()) return; var r = cur; cancelRun(r); finalize(r, 'stopped'); };
    E.restart = function () { if (active()) E.stop(); E.start(); };
    E.isActive = active;

    /* ---- UI ---- */
    function refresh() {
        var open = G.isOpen(), a = active(), st = a ? cur.status : 'idle';
        $('stRunStart').disabled = !open || a; $('stRunPause').disabled = st !== 'running'; $('stRunResume').disabled = st !== 'paused';
        $('stRunStop').disabled = !a; $('stRunRestart').disabled = !open;
        $('stRunState').textContent = a ? 'Run ' + cur.id + ' ' + st : 'Idle';
    }
    function nodeTimes(r) {
        var m = {}; r.events.forEach(function (x) { if (!x.node) return; var o = m[x.node] = m[x.node] || {}; if (/^finished/.test(x.msg)) o.f = x.t; else if (/^(skipped|stopped)/.test(x.msg)) o.f = o.f === undefined ? x.msg.split(' ')[0] : o.f; });
        return m;
    }
    function cmpBox() {                                  // execution history comparison: finish time of every node in two runs
        var wrap = document.createElement('div'); wrap.className = 'st-cmp';
        var a = document.createElement('select'), b = document.createElement('select'), out = document.createElement('div');
        a.setAttribute('aria-label', 'First run'); b.setAttribute('aria-label', 'Second run');
        runs.forEach(function (r, i) { [a, b].forEach(function (s) { var o = document.createElement('option'); o.value = i; o.textContent = 'Run ' + r.id + ' (' + r.status + ')'; s.appendChild(o); }); });
        a.value = 1; b.value = 0;
        function fmt(v) { return v === undefined ? '-' : typeof v === 'number' ? (v / 1000).toFixed(2) + 's' : v; }
        function draw() {
            out.textContent = ''; var A = nodeTimes(runs[a.value]), B = nodeTimes(runs[b.value]), t = document.createElement('table'); t.className = 'dt';
            var h = document.createElement('tr'); ['Node', 'Run ' + runs[a.value].id, 'Run ' + runs[b.value].id, 'Difference'].forEach(function (x) { var th = document.createElement('th'); th.textContent = x; h.appendChild(th); }); t.appendChild(h);
            Object.keys(Object.assign({}, A, B)).sort().forEach(function (k) {
                var x = A[k] && A[k].f, y = B[k] && B[k].f, d = (typeof x === 'number' && typeof y === 'number') ? ((y - x) / 1000).toFixed(2) + 's' : '-';
                var tr = document.createElement('tr'); [k, fmt(x), fmt(y), d].forEach(function (v) { var td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }); t.appendChild(tr);
            });
            out.appendChild(t);
        }
        a.addEventListener('change', draw); b.addEventListener('change', draw);
        var l = document.createElement('span'); l.textContent = 'Compare '; wrap.appendChild(l); wrap.appendChild(a); var w = document.createElement('span'); w.textContent = ' with '; wrap.appendChild(w); wrap.appendChild(b); wrap.appendChild(out); draw();
        return wrap;
    }
    function renderHist() {
        var box = $('stHist'); box.textContent = '';
        if (!runs.length) { var p = document.createElement('p'); p.className = 'st-hint'; p.textContent = 'No runs yet. Press Start to run the graph.'; box.appendChild(p); return; }
        if (runs.length >= 2) box.appendChild(cmpBox());
        runs.forEach(function (r) {
            var d = document.createElement('details'), s = document.createElement('summary');
            s.textContent = 'Run ' + r.id + ', ' + r.status + ', ' + ((r.endedAt - r.startedAt) / 1000).toFixed(1) + 's, ' + r.events.length + ' events';
            d.appendChild(s);
            r.events.forEach(function (x) {
                var row = document.createElement('div'); row.className = x.sev;
                [(x.t / 1000).toFixed(2) + 's', x.sev, x.node || 'run', x.msg].forEach(function (t) { var c = document.createElement('span'); c.textContent = t; row.appendChild(c); });
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
