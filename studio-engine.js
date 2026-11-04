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
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var STEP = 300, MAX_RUNS = 20, MAX_DEPTH = 5, MAX_EXEC = 500, MAX_SPAWN = 25, MAX_OUT = 100000, MAX_ROWS = 1000, MAX_LOGS = 1000, CANCEL = { cancelled: true };
    var G = window.StudioGraph, runs = [], cur = null, seq = 0;
    function $(id) { return document.getElementById(id); }
    function noop() {}
    function active() { return !!cur && !cur.ended; }
    function msg(e) { return String((e && e.message) || e).slice(0, 300); }
    var HANDLED = { handled: true };                     // thrown by a node whose failure was passed to an On Error trigger: downstream nodes skip quietly

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
    function emit(run, name) { run.fired[name] = true; ev(run, 'info', 'event "' + name + '" fired'); (run.evWait[name] || []).splice(0).forEach(function (w) { w(); }); (run.evOn[name] || []).slice().forEach(function (f) { f(); }); }
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
        stepWorld(run);
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
    function cancelRun(run) { run.cancelled = true; killGroup(run.root); run.waiters.splice(0).forEach(function (w) { w(); }); run.idleW.splice(0).forEach(function (w) { w(); }); }

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
        function send(m) { m.k = K; parent.postMessage(m, '*'); }
        var w = null, why = '';
        try { w = new Worker(URL.createObjectURL(new Blob([wsrc], { type: 'text/javascript' }))); }                       // some browsers refuse a blob: worker inside a sandboxed frame...
        catch (e1) {
            why = String((e1 && e1.message) || e1);
            try { w = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(wsrc)); }                       // ...so try a data: worker
            catch (e2) { send({ t: 'err', name: 'Error', message: 'This browser would not start the script worker (' + why.slice(0, 100) + ')', line: 0 }); return; }
        }
        w.onmessage = function (e) { if (e.data && typeof e.data === 'object') send(e.data); };
        w.onerror = function (e) { send({ t: 'err', name: 'Error', message: String(e.message || 'Worker error'), line: 0 }); };
        addEventListener('message', function (e) { if (e.source === parent && e.data && e.data.k === K) w.postMessage(e.data); });
        send({ t: 'ready' });
    }
    function srcdoc(token) {
        var w = '(' + workerMain.toString() + ')()';
        return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob: data:"><script>(' +
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
        if (fn === 'log') {                              // console.log / warn / error from a script = program output (source "output"), capped so a loop cannot flood the page
            if (++run.logN > MAX_LOGS) { if (run.logN === MAX_LOGS + 1) G.log('warn', 'output', 'Output limit reached (' + MAX_LOGS + ' lines per run). Further lines are dropped.', n.id); return null; }
            var lv = 'info', parts = args.slice(0, 10).map(function (a) { return String(a).slice(0, 300); });
            if (parts[0] === '[warn]') { lv = 'warn'; parts.shift(); } else if (parts[0] === '[error]') { lv = 'error'; parts.shift(); }
            G.log(lv, 'output', parts.join(' '), n.id); return null;
        }
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
            var token = newToken(), ms = c.timeout || 5000, finished = false, timer, readyT;
            var frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('aria-hidden', 'true'); frame.style.display = 'none';
            function finish(fn, v) { if (finished) return; finished = true; clearTimeout(timer); clearTimeout(readyT); window.removeEventListener('message', onMsg); grp.killers.delete(kill); if (ctx.ctl) ctx.ctl.killers.delete(kill); frame.remove(); fn(v); }
            function kill() { finish(reject, CANCEL); }
            function reply(r) { if (finished) return; r.k = token; try { frame.contentWindow.postMessage(r, '*'); } catch (e) {} }
            function onMsg(e) {
                if (e.source !== frame.contentWindow) return;
                var m = e.data; if (!m || typeof m !== 'object' || m.k !== token) return;
                if (m.t === 'ready') { clearTimeout(readyT); reply({ t: 'run', code: code, input: input }); }
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
            readyT = setTimeout(function () { finish(reject, new Error('The script sandbox did not start. A browser extension, or your site\'s security headers (Content-Security-Policy), may be blocking it.')); }, Math.min(ms, 4000));
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
        var run = ctx.run, grp = ctx.grp, c = n.config || {}, out, stopped = false, t0 = Date.now();
        if (++run.execs > MAX_EXEC) throw new Error('Run limit reached (' + MAX_EXEC + ' node executions)');
        var ctl = { dead: false, paused: false, sleepers: new Set(), killers: new Set(), waiters: [] }, cx = Object.create(ctx);
        cx.ctl = ctl; run.active[n.id] = ctl; run.stack.push(n.id);
        try {
            if (c.aDelay) { ev(run, 'info', 'activation delay ' + c.aDelay + ' ms', n); await sleep(grp, c.aDelay, ctl); await gate(run, grp, ctl); }
            setS(run, n, 'running'); ev(run, 'info', 'started', n);
            if (c.eDelay) { ev(run, 'info', 'execution delay ' + c.eDelay + ' ms', n); await sleep(grp, c.eDelay, ctl); await gate(run, grp, ctl); }
            if (n.type === 'script') out = (c.lang === 'html' || c.lang === 'css' || c.lang === 'pagejs') ? cleanOut({ lang: c.lang, content: String(c.code || '') }) : await runScript(cx, n);
            else if (n.type === 'database') out = runSql(run, n);
            else if (n.type === 'flow') out = await runFlow(cx, n);
            else if (n.type === 'branch') {
                if (c.mode === 'independent') { branchBg(ctx, n); ev(run, 'info', 'branch runs independently', n); }
                else { var bg = await branchRun(cx, n); out = bg.results; stopped = !!bg.stopped; }
            }
            else await sleep(grp, STEP, ctl);
            await gate(run, grp, ctl);
            if (c.oDelay) { ev(run, 'info', 'holding output ' + c.oDelay + ' ms', n); await sleep(grp, c.oDelay, ctl); await gate(run, grp, ctl); }
            if (out !== undefined) grp.results[n.label] = out;
            if (out !== undefined && (n.type === 'database' || (n.type === 'script' && c.lang === 'javascript'))) {      // the value a script returns (or the rows a SQL node selects) is part of its output
                var shown = JSON.stringify(out); G.log('info', 'output', 'returned ' + (Array.isArray(out) ? out.length + ' item(s): ' : '') + (shown.length > 2000 ? shown.slice(0, 2000) + ' ...' : shown), n.id);
            }
            setS(run, n, stopped ? 'stopped' : 'done');
            ev(run, 'ok', 'finished in ' + (Date.now() - t0) + ' ms' + (out !== undefined ? ' with output ' + JSON.stringify(out).slice(0, 80) : ''), n);
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
            if (e === HANDLED) { if (run.st[n.id] === 'waiting') { setS(run, n, 'skipped'); ev(run, 'warn', 'skipped (an earlier node failed and an On Error trigger took over)', n); } throw e; }
            var handlers = (ctx.onError || []).slice(), info;
            if (!(e && e.wrapped)) { info = msg(e); if (!handlers.length) run.hadError = true; setS(run, n, 'error'); ev(run, 'error', 'failed: ' + info, n); e = { wrapped: true, error: e }; }
            else { info = msg(e.error); if (run.st[n.id] === 'running') setS(run, n, 'error'); }
            if (handlers.length) { handlers.forEach(function (h) { h({ message: info, node: n.label, id: n.id }); }); throw HANDLED; }
            throw e;
        }
    }
    /* ---- the world: bodies (any node can have one), tweens (Move / Fade on the run clock), swept collision, and what feeds the Collision and Pickup triggers ---- */
    var MAX_BODIES = 100, MAX_TWEENS = 100, CHECKS = 20000;
    function ease(k, p) { return k === 'in' ? p * p : k === 'out' ? 1 - (1 - p) * (1 - p) : k === 'inout' ? (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p)) : p; }
    function bodyOf(n) { var b = (n.config || {}).body; return b && b.on ? { id: n.id, label: n.label, x: +b.x || 0, y: +b.y || 0, w: Math.max(1, +b.w || 40), h: Math.max(1, +b.h || 40), role: b.role || 'block', tag: b.tag || '', a: b.a === undefined ? 1 : +b.a, alive: true } : null; }
    function overlap(p, q) { return Math.abs(p.x - q.x) * 2 < p.w + q.w && Math.abs(p.y - q.y) * 2 < p.h + q.h; }      // centre based; touching edges do not count
    function pairKey(p, q) { return p.id < q.id ? p.id + '|' + q.id : q.id + '|' + p.id; }
    function scanAll(run) {                              // bodies that overlap right now are "already touching": they fire nothing until they separate and meet again
        var w = run.world; w.pairs = {};
        w.order.forEach(function (i, ix) { var p = w.bodies[i]; if (!p.alive) return; for (var j = ix + 1; j < w.order.length; j++) { var q = w.bodies[w.order[j]]; if (q.alive && overlap(p, q)) w.pairs[pairKey(p, q)] = true; } });
    }
    function initWorld(run) {
        var w = run.world = { bodies: {}, order: [], tweens: [], pairs: {}, flash: [], hits: 0, checks: 0 }, n = 0;
        Object.keys(run.nodes).forEach(function (id) {
            var nd = run.nodes[id]; if (!nd.enabled) return; var b = bodyOf(nd); if (!b) return;
            if (++n > MAX_BODIES) { if (n === MAX_BODIES + 1) ev(run, 'warn', 'only the first ' + MAX_BODIES + ' bodies are used'); return; }
            w.bodies[id] = b; w.order.push(id);
        });
        scanAll(run);
    }
    function resetWorld(run) {
        var w = run.world; w.tweens.slice().forEach(function (t) { finishTween(run, t, 'reset'); });
        w.order.forEach(function (id) { var nb = bodyOf(run.nodes[id]); if (nb) w.bodies[id] = nb; });
        scanAll(run); run.col.forEach(function (L) { L.touched = {}; });
    }
    function dispatch(run, type, p, q) {
        var w = run.world; w.hits++; w.flash.push({ a: p.id, b: q.id, t: Date.now(), type: type }); if (w.flash.length > 30) w.flash.shift();
        ev(run, 'info', 'touch ' + type + ': ' + p.label + ' and ' + q.label);
        run.col.slice().forEach(function (L) { var o = L.body === p.id ? q : L.body === q.id ? p : null; if (o) L.fn(o, type); });
    }
    function placeCheck(run, b, x, y, tw) {              // put a body at x,y and update who it touches; true when it should stop here
        var w = run.world, stop = false; b.x = x; b.y = y;
        w.order.forEach(function (id) {
            if (id === b.id || !b.alive) return; var o = w.bodies[id]; if (!o.alive) return;
            if (++w.checks > CHECKS) return;
            var key = pairKey(b, o), was = !!w.pairs[key], now = overlap(b, o);
            if (now && !was) { w.pairs[key] = true; dispatch(run, 'enter', b, o); if (tw && tw.stop && o.role !== 'item' && b.role !== 'item' && o.alive) { stop = true; tw.hitWith = o.label; } }
            else if (!now && was) { delete w.pairs[key]; dispatch(run, 'exit', b, o); }
        });
        return stop;
    }
    function moveBody(run, tw, b, nx, ny) {              // the whole path is checked in steps of half the body size, so a fast move cannot skip through a body
        var sx = b.x, sy = b.y, dx = nx - sx, dy = ny - sy, dist = Math.sqrt(dx * dx + dy * dy), step = Math.max(1, Math.min(b.w, b.h) / 2), n = Math.min(200, Math.max(1, Math.ceil(dist / step)));
        for (var i = 1; i <= n; i++) { if (placeCheck(run, b, sx + dx * i / n, sy + dy * i / n, tw)) { tw.stopped = true; return; } if (!b.alive) return; }
    }
    function finishTween(run, tw, why) { var w = run.world, i = w.tweens.indexOf(tw); if (i > -1) w.tweens.splice(i, 1); tw.why = why; if (tw.done) tw.done(); }
    function stepWorld(run) {
        var w = run.world; if (!w || !w.tweens.length) return; var now = clockNow(run); w.checks = 0;
        w.tweens.slice().forEach(function (tw) {
            var b = w.bodies[tw.id]; if (!b || !b.alive) return finishTween(run, tw, 'gone');
            var p = tw.ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - tw.t0) / tw.ms)), k = ease(tw.ease, p);
            if (tw.prop === 'a') b.a = tw.from + (tw.to - tw.from) * k; else moveBody(run, tw, b, tw.fx + (tw.tx - tw.fx) * k, tw.fy + (tw.ty - tw.fy) * k);
            if (tw.stopped) finishTween(run, tw, 'hit'); else if (p >= 1) finishTween(run, tw, 'done');
        });
        if (w.checks > CHECKS) { run.hadError = true; ev(run, 'error', 'too many collision checks in one step: movement was stopped'); w.tweens.slice().forEach(function (t) { finishTween(run, t, 'budget'); }); }
    }
    function tweenAwait(cx, tws) {                       // resolves when every tween is finished; Stop removes them
        var run = cx.run, grp = cx.grp, w = run.world;
        return Promise.all(tws.map(function (tw) {
            w.tweens.slice().forEach(function (old) { if (old.id === tw.id && old.prop === tw.prop) finishTween(run, old, 'replaced'); });
            return new Promise(function (res, rej) {
                var k = function () { var i = w.tweens.indexOf(tw); if (i > -1) w.tweens.splice(i, 1); grp.killers.delete(k); rej(CANCEL); };
                grp.killers.add(k); tw.done = function () { grp.killers.delete(k); res(tw); }; w.tweens.push(tw);
            });
        }));
    }

    /* ---- triggers: a Trigger node listens (Timer, Event or Error). Each time it fires, the nodes wired after it run as a fresh "wave" ---- */
    function isTrig(n) { return n.type === 'trigger'; }
    function isGate(n) { return n.type === 'flow' && ['counter', 'loop', 'sequence', 'random'].indexOf((n.config || {}).fKind) > -1; }      // flow nodes that own the nodes wired after them
    function wake(run) { run.idleW.splice(0).forEach(function (w) { w(); }); }
    function reactionOf(graph, t) {                      // everything downstream of a trigger, and the connections among those nodes
        var seen = {}, ids = {}, st = [t.id];
        while (st.length) {
            var f = st.pop();
            graph.connections.forEach(function (c) {
                if (c.from !== f || seen[c.to]) return; seen[c.to] = 1;
                var m = graph.nodes.filter(function (x) { return x.id === c.to; })[0];
                if (m && !isTrig(m)) { ids[m.id] = 1; st.push(m.id); }
            });
        }
        return { ids: ids, nodes: graph.nodes.filter(function (x) { return ids[x.id]; }), conns: graph.connections.filter(function (c) { return ids[c.to] && (ids[c.from] || c.from === t.id); }) };
    }
    function runWave(ctx, tn, react, payload, no) {
        var run = ctx.run; if (dead(run, ctx.grp)) return;
        var wg = mkGroup(run, tn.label + ' #' + no, ctx.grp); wg.results[tn.label] = payload; run.waves++;
        execGraph(run, wg, { nodes: react.nodes, connections: react.conns }, ctx.depth, { wave: true, src: [tn], full: ctx.graph }).then(noop, function (err) {
            if (err === CANCEL || run.cancelled) return;
            run.hadError = true; if (!(err && err.wrapped)) ev(run, 'error', 'reaction failed: ' + msg(err), tn);     // a failing reaction never stops the other triggers
        }).then(function () { wg.done = true; run.waves--; wake(run); });
    }
    function armTrigger(ctx, tn, react) {
        var run = ctx.run, grp = ctx.grp, c = tn.config || {}, kind = ['timer', 'event', 'error', 'collision', 'pickup'].indexOf(c.tKind) > -1 ? c.tKind : 'timer', max = Math.max(1, Math.min(200, c.tMax || 20)), fires = 0, off = false, it = null, hand = null;
        function disarm(final) {
            if (off) return; off = true; run.armed--; run.armK[kind]--; grp.killers.delete(k);
            if (it) { var i = run.sched.indexOf(it); if (i > -1) run.sched.splice(i, 1); it = null; }
            if (kind === 'event') { var l = run.evOn[c.tEvent] || [], j = l.indexOf(hand); if (j > -1) l.splice(j, 1); }
            if (kind === 'error') { var m = ctx.onError.indexOf(hand); if (m > -1) ctx.onError.splice(m, 1); }
            if (kind === 'collision' || kind === 'pickup') { var q = run.col.indexOf(hand); if (q > -1) run.col.splice(q, 1); }
            if (final) setS(run, tn, 'done');
            wake(run);
        }
        function k() { disarm(false); }
        function next() { it = { t: clockNow(run) + Math.max(50, c.tMs || 1000), fn: function () { it = null; fire({}); } }; schedAdd(run, it); }
        function fire(payload) {
            if (off || dead(run, grp)) return;
            fires++; ev(run, 'info', 'fired (' + fires + ' of at most ' + max + ')', tn);
            runWave(ctx, tn, react, Object.assign({ trigger: tn.label, count: fires }, payload), fires);
            if (fires >= max) { ev(run, 'warn', 'reached its limit of ' + max + ' fires, so it stops listening', tn); disarm(true); }
            else if (kind === 'timer') { if (c.tRepeat === false) disarm(true); else next(); }
        }
        run.armed++; run.armK[kind]++; run.disarms.push(function () { disarm(true); }); grp.killers.add(k); setS(run, tn, 'running');
        if (kind === 'event') {
            if (!/^[A-Za-z0-9_-]{1,20}$/.test(c.tEvent || '')) { ev(run, 'warn', 'has no valid event name, so it never fires', tn); disarm(true); return; }
            hand = function () { fire({ event: c.tEvent }); }; (run.evOn[c.tEvent] = run.evOn[c.tEvent] || []).push(hand); ev(run, 'info', 'listening for event "' + c.tEvent + '"', tn);
        } else if (kind === 'collision' || kind === 'pickup') {
            var wd = run.world, ab = wd && wd.bodies[c.tBody], L = { body: c.tBody || '', tag: c.tTag || '', pick: kind === 'pickup', on: kind === 'pickup' ? 'enter' : (c.tOn === 'exit' ? 'exit' : 'enter'), all: c.tAll === true, touched: {} };
            if (!ab) { ev(run, 'warn', 'needs a body to watch: turn on "Has a body" on a node and choose it here, so it never fires', tn); disarm(true); return; }
            L.fn = function (o, type) {
                if (type !== L.on || !o.alive || (L.tag && o.tag !== L.tag) || (L.pick ? o.role !== 'item' : o.role === 'item')) return;
                var me = wd.bodies[L.body];
                if (L.pick) { o.alive = false; Object.keys(wd.pairs).forEach(function (key) { if (key.split('|').indexOf(o.id) > -1) delete wd.pairs[key]; }); ev(run, 'info', 'picked up ' + o.label, tn); }
                if (L.all) {
                    L.touched[o.id] = true;
                    var need = wd.order.filter(function (id) { var b = wd.bodies[id]; return id !== L.body && (L.pick ? b.role === 'item' : b.role !== 'item') && (!L.tag || b.tag === L.tag); });
                    if (!need.every(function (id) { return L.touched[id]; })) return; L.touched = {};
                }
                fire({ body: me.label, other: o.label, tag: o.tag, event: type });
            };
            hand = L; run.col.push(L); ev(run, 'info', 'watching ' + ab.label + ' for ' + (kind === 'pickup' ? 'pickups' : 'collisions') + (L.tag ? ' (tag "' + L.tag + '")' : ''), tn);
        } else if (kind === 'error') {
            hand = function (info) { fire(info); }; ctx.onError.push(hand); ev(run, 'info', 'listening for errors in this graph', tn);
        } else { next(); ev(run, 'info', 'timer armed: ' + (c.tRepeat === false ? 'once after ' : 'every ') + Math.max(50, c.tMs || 1000) + ' ms', tn); }
    }
    function alive(run) { return run.waves > 0 || run.armK.timer > 0 || (run.world && run.world.tweens.length > 0) || (run.armK.event > 0 && run.sched.length > 0); }      // On Error triggers never keep a run alive; On Event ones only while something could still fire the event
    async function settle(run) {                         // the run ends when the main flow, every wave and every background branch are done and nothing could still fire a trigger
        var told = false;
        for (;;) {
            await drain(run);
            if (run.cancelled) return;
            if (!alive(run)) break;
            if (!told && (run.armK.timer || run.armK.event)) { told = true; ev(run, 'info', 'Listening: ' + run.armed + ' trigger(s) armed. Press Stop to end the run.'); }
            await new Promise(function (res) { run.idleW.push(res); setTimeout(res, 100); });
        }
        if (run.armed) { ev(run, 'info', 'Run finished with ' + run.armed + ' trigger(s) still waiting: nothing left could set them off'); run.disarms.slice().forEach(function (d) { d(); }); }
    }
    /* ---- flow nodes: Counter, Loop, Sequence and Randomizer own the nodes wired after them and run them as awaited waves; Reset and Spawn act and pass on ---- */
    function succOf(react, gate) {                       // the nodes wired directly after a flow node, top to bottom on the canvas
        var seen = {}, out = [];
        react.conns.forEach(function (c) { if (c.from !== gate.id || seen[c.to]) return; seen[c.to] = 1; var m = react.nodes.filter(function (x) { return x.id === c.to; })[0]; if (m) out.push(m); });
        out.sort(function (p, q) { return ((p.y || 0) - (q.y || 0)) || ((p.x || 0) - (q.x || 0)) || (p.label < q.label ? -1 : 1); });
        return out;
    }
    function partOf(react, gate, startId) {              // one successor and everything after it
        var ids = {}, st = [startId]; ids[startId] = 1;
        while (st.length) { var f = st.pop(); react.conns.forEach(function (c) { if (c.from === f && !ids[c.to] && react.ids[c.to]) { ids[c.to] = 1; st.push(c.to); } }); }
        return { nodes: react.nodes.filter(function (x) { return ids[x.id]; }), conns: react.conns.filter(function (c) { return ids[c.to] && (ids[c.from] || c.from === gate.id); }) };
    }
    async function waveAwait(cx, n, nodes, conns, payload, i) {
        var run = cx.run; if (dead(run, cx.grp)) throw CANCEL;
        var wg = mkGroup(run, n.label + ' #' + i, cx.grp); wg.results[n.label] = payload;
        try { await execGraph(run, wg, { nodes: nodes, connections: conns }, cx.depth, { wave: true, src: [n], full: cx.graph, onError: cx.onError }); }
        finally { wg.done = true; }
    }
    async function runFlow(cx, n) {
        var run = cx.run, grp = cx.grp, c = n.config || {}, k = c.fKind, react = cx.flows && cx.flows[n.id], st = run.flow[n.id] = run.flow[n.id] || { count: c.cStart || 0 };
        if (k === 'reset') {
            var tg = c.rTarget || '*', hit = 0;
            Object.keys(run.flow).forEach(function (id) { var t = run.nodes[id]; if ((tg === '*' || id === tg) && t && t.type === 'flow' && (t.config || {}).fKind === 'counter') { run.flow[id].count = (t.config || {}).cStart || 0; hit++; } });
            if (c.rBodies) resetWorld(run);
            ev(run, 'info', 'reset ' + hit + ' counter(s)' + (c.rBodies ? ' and all bodies' : ''), n); return { reset: hit };
        }
        if (k === 'move' || k === 'fade') {
            var wd = run.world, ids = c.mGroup ? wd.order.filter(function (id) { return wd.bodies[id].alive && wd.bodies[id].tag === c.mGroup; }) : (c.mTarget && wd.bodies[c.mTarget] && wd.bodies[c.mTarget].alive ? [c.mTarget] : []);
            if (!ids.length) { ev(run, 'warn', k + ': nothing to ' + k + ' (choose a body that has "Has a body" turned on, or a group tag that exists)', n); return { moved: 0 }; }
            if (wd.tweens.length + ids.length > MAX_TWEENS) throw new Error('Too many movements at once (max ' + MAX_TWEENS + ')');
            var t0 = clockNow(run), ms = Math.max(0, c.mMs || 0);
            var tws = ids.map(function (id) {
                var b = wd.bodies[id];
                if (k === 'fade') return { id: id, prop: 'a', from: b.a, to: Math.max(0, Math.min(1, +c.fTo || 0)), ms: ms, ease: c.mEase || 'inout', t0: t0 };
                return { id: id, prop: 'xy', fx: b.x, fy: b.y, tx: c.mRel === false ? (+c.mX || 0) : b.x + (+c.mX || 0), ty: c.mRel === false ? (+c.mY || 0) : b.y + (+c.mY || 0), ms: ms, ease: c.mEase || 'inout', t0: t0, stop: c.mStop === 'stop' };
            });
            ev(run, 'info', k + ' ' + ids.length + ' bod' + (ids.length === 1 ? 'y' : 'ies') + (ms ? ' over ' + ms + ' ms' : ''), n);
            var fin = await tweenAwait(cx, tws), f0 = wd.bodies[ids[0]], hitT = fin.filter(function (t) { return t.why === 'hit'; })[0];
            return { moved: ids.length, x: f0.x, y: f0.y, alpha: f0.a, hit: hitT ? hitT.hitWith : null };
        }
        if (k === 'spawn') {
            var t2 = run.nodes[c.sTarget], cnt = Math.max(1, Math.min(10, c.sN || 1)), made = 0;
            if (!t2 || t2.type !== 'branch' || !run.ctxs[t2.id]) { ev(run, 'warn', 'spawn needs a branch node of the running graph', n); return { spawned: 0 }; }
            for (var s = 0; s < cnt; s++) { if (++run.spawns > MAX_SPAWN) throw new Error('Spawn limit reached (' + MAX_SPAWN + ' per run)'); branchBg(run.ctxs[t2.id], t2); made++; }
            ev(run, 'info', 'spawned ' + made + ' cop' + (made === 1 ? 'y' : 'ies') + ' of ' + t2.label, n); return { spawned: made };
        }
        if (!react) { ev(run, 'warn', 'has no nodes after it at this level, so it controls nothing', n); return { note: 'nothing after it' }; }
        if (k === 'counter') {
            st.count++; var N = Math.max(1, c.cN || 3), m = c.cMode || 'reach';
            var pass = m === 'count' || (m === 'reach' ? st.count === N : m === 'every' ? st.count % N === 0 : st.count <= N), res = { count: st.count, passed: pass };
            ev(run, 'info', 'count ' + st.count + (m === 'count' ? '' : ' of ' + N) + (pass ? ': passing on' : ': not yet'), n);
            if (pass && m === 'reach' && c.cReset) st.count = c.cStart || 0;
            if (pass) await waveAwait(cx, n, react.nodes, react.conns, res, st.count);
            return res;
        }
        var ctl = cx.ctl;
        if (k === 'loop') {
            var L = Math.max(1, Math.min(100, c.lN || 3)), gap = Math.max(0, c.lGap || 0);
            for (var i = 1; i <= L; i++) {
                ev(run, 'info', 'loop ' + i + ' of ' + L, n);
                await waveAwait(cx, n, react.nodes, react.conns, { index: i, count: L }, i);
                if (i < L && gap) { await sleep(grp, gap, ctl); await gate(run, grp, ctl); }
            }
            return { count: L };
        }
        var sc = succOf(react, n);
        if (k === 'sequence') {
            var q = Math.max(0, c.qGap || 0);
            for (var j = 0; j < sc.length; j++) {
                var part = partOf(react, n, sc[j].id); ev(run, 'info', 'step ' + (j + 1) + ' of ' + sc.length + ': ' + sc[j].label, n);
                await waveAwait(cx, n, part.nodes, part.conns, { index: j + 1, count: sc.length, node: sc[j].label }, j + 1);
                if (j < sc.length - 1 && q) { await sleep(grp, q, ctl); await gate(run, grp, ctl); }
            }
            return { count: sc.length };
        }
        if (k === 'random') {
            var wts = c.weights || {}, ws = sc.map(function (x) { var w = Object.prototype.hasOwnProperty.call(wts, x.id) ? +wts[x.id] : 1; return isFinite(w) && w > 0 ? Math.min(w, 100) : 0; }), tot = ws.reduce(function (p, v) { return p + v; }, 0);
            if (!sc.length || tot <= 0) { ev(run, 'warn', 'nothing to pick from (no nodes after it, or every weight is 0)', n); return { chosen: null }; }
            var r = Math.random() * tot, pi = 0; while (pi < ws.length - 1 && r >= ws[pi]) { r -= ws[pi]; pi++; }
            var pick = sc[pi], pp = partOf(react, n, pick.id); ev(run, 'info', 'picked ' + pick.label + ' (' + (pi + 1) + ' of ' + sc.length + ')', n);
            await waveAwait(cx, n, pp.nodes, pp.conns, { chosen: pick.label, index: pi + 1, count: sc.length }, 1);
            return { chosen: pick.label };
        }
        return undefined;
    }
    function execGraph(run, grp, graph, depth, opts) {
        opts = opts || {};
        var full = opts.full || graph, trigs = [], flows = {}, skip = {}, cut = false;
        graph.nodes.forEach(function (n) {               // triggers and flow nodes own the nodes wired after them: those run as waves, not as part of the main flow
            var r;
            if (isTrig(n) && !opts.wave) { r = reactionOf(graph, n); trigs.push({ n: n, r: r }); skip[n.id] = 1; }
            else if (isGate(n)) { r = reactionOf(graph, n); flows[n.id] = r; }
            else return;
            cut = true; Object.keys(r.ids).forEach(function (id) { skip[id] = 1; });
        });
        if (cut) graph = { nodes: graph.nodes.filter(function (n) { return !skip[n.id]; }), connections: graph.connections.filter(function (c) { return !skip[c.from] && !skip[c.to]; }) };
        var order = topo(graph);
        if (!order) return Promise.reject(new Error('A branch contains a loop'));
        var ctx = { run: run, grp: grp, depth: depth, byId: {}, byLabel: {}, ups: {}, onError: opts.onError || [], flows: flows, graph: full }, P = {};
        (opts.src || []).forEach(function (s) { ctx.byId[s.id] = s; });             // the trigger that started a wave, so its payload reaches the first nodes as input
        graph.nodes.forEach(function (n) { ctx.byId[n.id] = n; run.ctxs[n.id] = ctx; if (!(n.label in ctx.byLabel)) ctx.byLabel[n.label] = n; if (n.enabled) setS(run, n, 'waiting'); });
        full.nodes.forEach(function (n) { if (!(n.label in ctx.byLabel)) ctx.byLabel[n.label] = n; });        // scripts can still find every node of the graph by label
        graph.connections.forEach(function (c) { (ctx.ups[c.to] = ctx.ups[c.to] || []).push(c.from); });
        trigs.forEach(function (t) { if (t.n.enabled) armTrigger(ctx, t.n, t.r); });
        order.forEach(function (id) { P[id] = runNode(ctx, ctx.byId[id], (ctx.ups[id] || []).map(function (f) { return P[f]; })); P[id].catch(noop); });
        return Promise.all(order.map(function (id) { return P[id].catch(function (err) { if (err === HANDLED) return; throw err; }); }));
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
    E.start = function (opts) {                          // opts.graph (STools): run this stand-alone graph instead of the whole project
        if (!G.isOpen()) return;
        if (active()) return G.log('warn', 'run', 'A run is already active. Stop it or use Restart.');
        var g = (opts && opts.graph && Array.isArray(opts.graph.nodes)) ? opts.graph : G.get();
        if (!g.nodes.length) return G.log('warn', 'run', 'Nothing to run. Add some nodes first.');
        if (!topo(g)) return G.log('error', 'run', 'This graph contains a loop, so it cannot run.');
        G.resetStatus();
        var run = cur = { id: ++seq, status: 'running', startedAt: Date.now(), endedAt: 0, events: [], logN: 0, paused: false, cancelled: false, ended: false, hadError: false,
            st: {}, waiters: [], gseq: 0, execs: 0, spawns: 0, bg: [], stack: [], root: null,
            startAt: {}, blocked: {}, fired: {}, evWait: {}, evOn: {}, flow: {}, world: null, col: [], mainDone: false, armed: 0, armK: { timer: 0, event: 0, error: 0, collision: 0, pickup: 0 }, disarms: [], waves: 0, idleW: [], sched: [], active: {}, nodes: {}, ctxs: {}, db: null, dbChanged: false, clockAcc: 0, clockStart: Date.now(), tickId: 0, tl: null };
        run.root = mkGroup(run, 'root', null); setupTimeline(run, g); initWorld(run);
        ev(run, 'info', 'Run ' + run.id + ' started (' + g.nodes.length + ' nodes)');
        execGraph(run, run.root, g, 0).then(function () { run.mainDone = true; return settle(run); }).then(
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
    E.world = function () {                              // read-only snapshot for the Stage tab (the last run's world stays readable after it ends)
        var r = cur; if (!r || !r.world) return null; var w = r.world;
        return { run: r.id, ended: !!r.ended, t: clockNow(r), hits: w.hits, touching: Object.keys(w.pairs), flash: w.flash.slice(),
            bodies: w.order.map(function (id) { var b = w.bodies[id]; return { id: b.id, label: b.label, x: b.x, y: b.y, w: b.w, h: b.h, role: b.role, tag: b.tag, a: b.a, alive: b.alive }; }) };
    };
    E.stop = function () {
        if (!active()) return; var r = cur;
        var quiet = r.mainDone && !r.waves && !r.hadError && !Object.keys(r.active).length;      // only waiting for triggers: nothing is interrupted, so the run counts as finished
        if (quiet) ev(r, 'info', 'Stopped while only listening for triggers: the run counts as finished');
        cancelRun(r); finalize(r, quiet ? 'done' : 'stopped');
    };
    E.restart = function () { if (active()) E.stop(); E.start(); };
    E.isActive = active;
    /* PHASE 7a (STools): the two live operations behind the Spawn and Toggle tools */
    E.spawn = function (id) {                            // start another copy of a branch node of the running graph
        if (!active()) return false;
        var n = cur.nodes[id];
        if (!n || n.type !== 'branch' || !cur.ctxs[id]) { ev(cur, 'warn', 'spawn needs a branch node of the running graph', n); return false; }
        if (++cur.spawns > MAX_SPAWN) { ev(cur, 'error', 'spawn limit reached (' + MAX_SPAWN + ' per run)', n); return false; }
        ev(cur, 'info', 'spawned (STools)', n); branchBg(cur.ctxs[id], n); return true;
    };
    E.setEnabled = function (id, on) {                   // live enable/disable: nodes that have not started yet are skipped
        if (!active() || !cur.nodes[id]) return false;
        cur.nodes[id].enabled = !!on; ev(cur, 'info', (on ? 'enabled' : 'disabled') + ' during the run (STools)', cur.nodes[id]); return true;
    };

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
