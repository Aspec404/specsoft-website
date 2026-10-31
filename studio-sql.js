/* SPECSOFT® Studio: tiny SQL engine for Database nodes (PHASE 5).
   NOT full SQLite/Postgres. Supported:
     CREATE TABLE [IF NOT EXISTS] t (col type ..., ...)   DROP TABLE [IF EXISTS] t
     INSERT INTO t [(cols)] VALUES (...), (...)           UPDATE t SET c = expr [WHERE ...]    DELETE FROM t [WHERE ...]
     SELECT * | cols | COUNT/SUM/AVG/MIN/MAX(...) [AS x] FROM t [WHERE ...] [ORDER BY c [ASC|DESC]] [LIMIT n [OFFSET m]]
     WHERE: = != <> < <= > >= LIKE IN (...) IS [NOT] NULL AND OR NOT ( ) + - * /   ?-placeholders for parameters.
   Not supported: JOIN, GROUP BY, subqueries. It parses text itself (no eval), works on a copy and only
   keeps the changes when every statement succeeds. Limits: 10 tables, 20 columns, 2000 rows/table, 200 KB total. */
(function (root) {
    'use strict';
    var LIM = { tables: 10, cols: 20, rows: 2000, cell: 2000, bytes: 200000, sql: 20000, params: 20 };
    var BAD = { '__proto__': 1, 'constructor': 1, 'prototype': 1 }, AGG = { count: 1, sum: 1, avg: 1, min: 1, max: 1 };
    function Err(m) { return new Error(m); }
    function name(n) { if (BAD[n]) throw Err('Name not allowed: ' + n); return n; }

    function tokenize(sql) {
        var re = /\s+|--[^\n]*|('(?:[^']|'')*')|("(?:[^"]|"")*")|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|<>|!=|[=<>(),*?;+\-\/])/y, out = [], m, p = 0;
        while (re.lastIndex < sql.length) {
            var at = re.lastIndex; m = re.exec(sql);
            if (!m) throw Err('Unexpected character "' + sql[at] + '" at position ' + at);
            if (m[1] !== undefined) out.push({ t: 'str', v: m[1].slice(1, -1).replace(/''/g, "'") });
            else if (m[2] !== undefined) out.push({ t: 'id', v: name(m[2].slice(1, -1).replace(/""/g, '"').toLowerCase()), q: 1 });
            else if (m[3] !== undefined) out.push({ t: 'num', v: parseFloat(m[3]) });
            else if (m[4] !== undefined) out.push({ t: 'id', v: m[4].toLowerCase() });
            else if (m[5] !== undefined) out.push(m[5] === '?' ? { t: 'op', v: '?', p: p++ } : { t: 'op', v: m[5] });
        }
        return out;
    }

    function Parser(toks, params, cols) { this.k = toks; this.i = 0; this.params = params; this.cols = cols || null; }
    var P = Parser.prototype;
    P.peek = function (o) { return this.k[this.i + (o || 0)]; };
    P.next = function () { if (this.i >= this.k.length) throw Err('Unexpected end of statement'); return this.k[this.i++]; };
    P.kw = function (w) { var t = this.peek(); if (t && t.t === 'id' && !t.q && t.v === w) { this.i++; return true; } return false; };
    P.need = function (w) { if (!this.kw(w)) throw Err('Expected ' + w.toUpperCase() + near(this)); };
    P.op = function (o) { var t = this.peek(); if (t && t.t === 'op' && t.v === o) { this.i++; return true; } return false; };
    P.needOp = function (o) { if (!this.op(o)) throw Err('Expected "' + o + '"' + near(this)); };
    P.ident = function () { var t = this.next(); if (t.t !== 'id') throw Err('Expected a name' + near(this)); return t.v; };
    P.done = function () { if (this.i < this.k.length) throw Err('Unexpected "' + String(this.k[this.i].v) + '"'); };
    function near(p) { var t = p.k[p.i]; return t ? ' near "' + String(t.v) + '"' : ' at the end'; }
    function truthy(v) { return v !== null && v !== undefined && v !== false && v !== 0 && v !== ''; }

    P.param = function (t) {
        if (!(t.p in this.params)) throw Err('Missing value for placeholder #' + (t.p + 1));
        var v = this.params[t.p]; if (v === undefined) v = null;
        if (v !== null && ['string', 'number', 'boolean'].indexOf(typeof v) < 0) throw Err('Parameters must be text, numbers, booleans or null');
        return v;
    };
    P.primary = function () {
        var t = this.next(), self = this;
        if (t.t === 'num' || t.t === 'str') return function () { return t.v; };
        if (t.t === 'op' && t.v === '?') { var pv = this.param(t); return function () { return pv; }; }
        if (t.t === 'op' && t.v === '-') { var e = this.primary(); return function (r) { var x = e(r); return x === null ? null : -x; }; }
        if (t.t === 'op' && t.v === '(') { var inner = this.or(); this.needOp(')'); return inner; }
        if (t.t === 'id' && !t.q && t.v === 'null') return function () { return null; };
        if (t.t === 'id' && !t.q && t.v === 'true') return function () { return true; };
        if (t.t === 'id' && !t.q && t.v === 'false') return function () { return false; };
        if (t.t === 'id') {
            if (!this.cols) throw Err('Column names are not allowed here: ' + t.v);
            if (this.cols.indexOf(t.v) < 0) throw Err('No such column: ' + t.v);
            return function (r) { var x = r[t.v]; return x === undefined ? null : x; };
        }
        throw Err('Unexpected "' + String(t.v) + '"');
    };
    P.mul = function () {
        var l = this.primary();
        for (;;) {
            var o = this.peek(); if (!(o && o.t === 'op' && (o.v === '*' || o.v === '/'))) return l; this.i++;
            l = (function (a, b, op) { return function (r) { var x = a(r), y = b(r); if (x === null || y === null) return null; return op === '*' ? x * y : (y === 0 ? null : x / y); }; })(l, this.primary(), o.v);
        }
    };
    P.add = function () {
        var l = this.mul();
        for (;;) {
            var o = this.peek(); if (!(o && o.t === 'op' && (o.v === '+' || o.v === '-'))) return l; this.i++;
            l = (function (a, b, op) { return function (r) { var x = a(r), y = b(r); if (x === null || y === null) return null; return op === '+' ? x + y : x - y; }; })(l, this.mul(), o.v);
        }
    };
    P.cmp = function () {
        var l = this.add(), t = this.peek(), self = this;
        if (!t) return l;
        if (t.t === 'op' && ['=', '!=', '<>', '<', '<=', '>', '>='].indexOf(t.v) > -1) {
            this.i++; var r = this.add(), op = t.v;
            return function (row) {
                var a = l(row), b = r(row); if (a === null || b === null) return false;
                switch (op) { case '=': return a == b; case '!=': case '<>': return a != b; case '<': return a < b; case '<=': return a <= b; case '>': return a > b; default: return a >= b; }
            };
        }
        if (this.kw('is')) { var neg = this.kw('not'); this.need('null'); return function (row) { return (l(row) === null) !== neg; }; }
        var not = false; if (t.t === 'id' && t.v === 'not' && this.peek(1) && ['like', 'in'].indexOf(this.peek(1).v) > -1) { this.i++; not = true; }
        if (this.kw('like')) {
            var pat = this.add();
            return function (row) {
                var a = l(row), p = pat(row); if (a === null || p === null) return false;
                var rx = new RegExp('^' + String(p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i');
                return rx.test(String(a)) !== not;
            };
        }
        if (this.kw('in')) {
            this.needOp('('); var list = [];
            do { list.push(this.add()); } while (this.op(','));
            this.needOp(')');
            return function (row) { var a = l(row); if (a === null) return false; return list.some(function (f) { return f(row) == a; }) !== not; };
        }
        return l;
    };
    P.not = function () { if (this.kw('not')) { var e = this.not(); return function (r) { return !truthy(e(r)); }; } return this.cmp(); };
    P.and = function () { var l = this.not(); while (this.kw('and')) l = (function (a, b) { return function (r) { return truthy(a(r)) && truthy(b(r)); }; })(l, this.not()); return l; };
    P.or = function () { var l = this.and(); while (this.kw('or')) l = (function (a, b) { return function (r) { return truthy(a(r)) || truthy(b(r)); }; })(l, this.and()); return l; };

    function getTable(db, n, need) {
        var t = db.tables[n]; if (!t && need !== false) throw Err('No such table: ' + n); return t;
    }
    function checkCell(v) { if (typeof v === 'string' && v.length > LIM.cell) throw Err('Text is too long (max ' + LIM.cell + ' characters per value)'); return v; }
    function litList(p) { var out = []; p.needOp('('); do { out.push(checkCell(p.add()({}))); } while (p.op(',')); p.needOp(')'); return out; }

    var RUN = {
        create: function (db, p, res) {
            p.need('table'); var ine = false; if (p.kw('if')) { p.need('not'); p.need('exists'); ine = true; }
            var n = name(p.ident()); p.needOp('(');
            if (db.tables[n]) { if (ine) { p.i = p.k.length; return; } throw Err('Table already exists: ' + n); }
            if (Object.keys(db.tables).length >= LIM.tables) throw Err('Table limit reached (' + LIM.tables + ')');
            var t = { cols: [], pk: null, auto: 0, autopk: false, defaults: {}, rows: [] };
            do {
                var c = name(p.ident()), depth = 0, isInt = false, key = false;
                if (t.cols.indexOf(c) > -1) throw Err('Duplicate column: ' + c);
                while (p.peek() && !(depth === 0 && p.peek().t === 'op' && (p.peek().v === ',' || p.peek().v === ')'))) {
                    var x = p.next();
                    if (x.t === 'op' && x.v === '(') depth++; else if (x.t === 'op' && x.v === ')') depth--;
                    else if (x.t === 'id' && (x.v === 'integer' || x.v === 'int')) isInt = true;
                    else if (x.t === 'id' && x.v === 'primary') { p.need('key'); key = true; }
                    else if (x.t === 'id' && x.v === 'default') { var d = p.next(); t.defaults[c] = d.t === 'id' ? null : d.v; }
                }
                t.cols.push(c); if (key) { t.pk = c; t.autopk = isInt; }
            } while (p.op(','));
            p.needOp(')'); if (!t.cols.length || t.cols.length > LIM.cols) throw Err('A table needs 1 to ' + LIM.cols + ' columns');
            db.tables[n] = t; res.changed = true;
        },
        drop: function (db, p, res) {
            p.need('table'); var ie = false; if (p.kw('if')) { p.need('exists'); ie = true; }
            var n = p.ident(); if (!db.tables[n]) { if (ie) return; throw Err('No such table: ' + n); }
            delete db.tables[n]; res.changed = true;
        },
        insert: function (db, p, res) {
            p.need('into'); var t = getTable(db, p.ident()), cols = t.cols;
            if (p.op('(')) { cols = []; do { var c = p.ident(); if (t.cols.indexOf(c) < 0) throw Err('No such column: ' + c); cols.push(c); } while (p.op(',')); p.needOp(')'); }
            p.need('values'); var n = 0;
            do {
                var vals = litList(p); if (vals.length !== cols.length) throw Err('Expected ' + cols.length + ' values but got ' + vals.length);
                if (t.rows.length >= LIM.rows) throw Err('Row limit reached (' + LIM.rows + ' per table)');
                var row = {}; t.cols.forEach(function (c) { row[c] = t.defaults[c] !== undefined ? t.defaults[c] : null; });
                cols.forEach(function (c, i) { row[c] = vals[i]; });
                if (t.pk) {
                    if (row[t.pk] === null && t.autopk) row[t.pk] = ++t.auto;
                    else if (row[t.pk] === null) throw Err('Primary key ' + t.pk + ' cannot be empty');
                    else if (t.rows.some(function (r) { return r[t.pk] == row[t.pk]; })) throw Err('Duplicate primary key: ' + row[t.pk]);
                    else if (typeof row[t.pk] === 'number' && row[t.pk] > t.auto) t.auto = Math.floor(row[t.pk]);
                }
                t.rows.push(row); n++;
            } while (p.op(','));
            res.changes += n; res.changed = true; res.lastId = t.pk ? t.rows[t.rows.length - 1][t.pk] : null;
        },
        update: function (db, p, res) {
            var t = getTable(db, p.ident()); p.cols = t.cols; p.need('set'); var sets = [];
            do { var c = p.ident(); if (t.cols.indexOf(c) < 0) throw Err('No such column: ' + c); p.needOp('='); sets.push([c, p.add()]); } while (p.op(','));
            var w = p.kw('where') ? p.or() : null; p.done();
            t.rows.forEach(function (r) {
                if (w && !truthy(w(r))) return;
                var nv = sets.map(function (s) { return checkCell(s[1](r)); }); sets.forEach(function (s, i) { r[s[0]] = nv[i]; }); res.changes++;
            });
            if (res.changes) res.changed = true;
        },
        delete: function (db, p, res) {
            p.need('from'); var t = getTable(db, p.ident()); p.cols = t.cols; var w = p.kw('where') ? p.or() : null; p.done();
            var keep = t.rows.filter(function (r) { return w && !truthy(w(r)); }); res.changes += t.rows.length - keep.length; t.rows = keep; if (res.changes) res.changed = true;
        },
        select: function (db, p, res) {
            var from = -1, depth = 0, k = p.k;
            for (var j = p.i; j < k.length; j++) { var x = k[j]; if (x.t === 'op' && x.v === '(') depth++; else if (x.t === 'op' && x.v === ')') depth--; else if (depth === 0 && x.t === 'id' && !x.q && x.v === 'from') { from = j; break; } }
            if (from < 0) throw Err('SELECT needs a FROM table');
            var listToks = k.slice(p.i, from); p.i = from + 1;
            var t = getTable(db, p.ident()); p.cols = t.cols;
            var w = p.kw('where') ? p.or() : null, order = [], limit = Infinity, offset = 0;
            if (p.kw('order')) { p.need('by'); do { var oc = p.ident(); if (t.cols.indexOf(oc) < 0) throw Err('No such column: ' + oc); order.push([oc, p.kw('desc') ? -1 : (p.kw('asc'), 1)]); } while (p.op(',')); }
            if (p.kw('limit')) { var lv = p.add()({}); if (typeof lv !== 'number' || lv < 0) throw Err('LIMIT needs a number'); limit = lv; if (p.kw('offset')) offset = p.add()({}); }
            p.done();
            var rows = t.rows.filter(function (r) { return !w || truthy(w(r)); });
            var lp = new Parser(listToks, p.params, t.cols), items = [], star = false;
            if (lp.op('*')) { lp.done(); star = true; }
            else do {
                var s = lp.i, a = lp.peek(), item;
                if (a && a.t === 'id' && AGG[a.v] && lp.peek(1) && lp.peek(1).v === '(') {
                    lp.i += 2; var col = null; if (!lp.op('*')) { col = lp.ident(); if (t.cols.indexOf(col) < 0) throw Err('No such column: ' + col); } lp.needOp(')');
                    item = { agg: a.v, col: col, name: a.v + '(' + (col || '*') + ')' };
                } else { var f = lp.add(); item = { f: f, name: lp.i - s === 1 && a.t === 'id' ? a.v : 'expr' + (items.length + 1) }; }
                if (lp.kw('as')) item.name = lp.ident();
                items.push(item);
            } while (lp.op(','));
            lp.done();
            var out, names;
            if (star) { names = t.cols.slice(); }
            else names = items.map(function (i) { return i.name; });
            if (!star && items.some(function (i) { return i.agg; })) {
                if (items.some(function (i) { return !i.agg; })) throw Err('Mixing columns and aggregates needs GROUP BY, which is not supported');
                var o = {}; items.forEach(function (i) {
                    var vals = rows.map(function (r) { return i.col ? r[i.col] : 1; }).filter(function (v) { return v !== null && v !== undefined; });
                    var nums = vals.map(Number).filter(function (n) { return !isNaN(n); });
                    o[i.name] = i.agg === 'count' ? vals.length : !vals.length ? null : i.agg === 'sum' ? nums.reduce(function (a, b) { return a + b; }, 0)
                        : i.agg === 'avg' ? nums.reduce(function (a, b) { return a + b; }, 0) / nums.length : i.agg === 'min' ? vals.reduce(function (a, b) { return b < a ? b : a; }) : vals.reduce(function (a, b) { return b > a ? b : a; });
                }); out = [o];
            } else {
                if (order.length) rows = rows.slice().sort(function (a, b) {
                    for (var q = 0; q < order.length; q++) { var c = order[q][0], d = order[q][1], x = a[c], y = b[c]; if (x === y) continue; if (x === null) return -d; if (y === null) return d; return (x < y ? -1 : 1) * d; }
                    return 0;
                });
                rows = rows.slice(offset, offset + limit);
                out = rows.map(function (r) { if (star) return JSON.parse(JSON.stringify(r)); var o = {}; items.forEach(function (i) { var v = i.f(r); o[i.name] = v === undefined ? null : v; }); return o; });
            }
            res.rows = out; res.columns = names; res.isSelect = true;
        }
    };

    function clone(db) { return JSON.parse(JSON.stringify(db)); }
    function exec(db, sql, params) {
        sql = String(sql || ''); params = Array.isArray(params) ? params.slice(0, LIM.params) : [];
        if (sql.length > LIM.sql) throw Err('SQL is too long (max ' + LIM.sql + ' characters)');
        if (!db.tables) db.tables = {};
        var work = clone(db), toks = tokenize(sql), stmts = [[]];
        toks.forEach(function (t) { if (t.t === 'op' && t.v === ';') stmts.push([]); else stmts[stmts.length - 1].push(t); });
        var res = { rows: [], columns: [], changes: 0, changed: false, isSelect: false, lastId: null };
        stmts.filter(function (s) { return s.length; }).forEach(function (s) {
            var first = s[0]; res.rows = []; res.columns = []; res.isSelect = false;
            var verb = first.t === 'id' && !first.q ? first.v : '';
            if (!RUN[verb]) throw Err('Unsupported statement' + (first ? ': ' + String(first.v) : ''));
            var p = new Parser(s, params); p.i = 1; RUN[verb](work, p, res);
            if (verb === 'create' || verb === 'drop' || verb === 'insert') p.done();
        });
        if (JSON.stringify(work).length > LIM.bytes) throw Err('The database would be too large (max ' + Math.round(LIM.bytes / 1000) + ' KB)');
        db.tables = work.tables;                            // all statements worked: keep the changes
        return res;
    }
    function clean(d) {                                      // rebuilds saved/untrusted data into a safe shape
        var out = { tables: {} }, ts = (d && typeof d.tables === 'object' && d.tables) || {};
        Object.keys(ts).slice(0, LIM.tables).forEach(function (n) {
            var t = ts[n]; if (BAD[n] || !t || !Array.isArray(t.cols)) return;
            var cols = t.cols.filter(function (c) { return typeof c === 'string' && !BAD[c]; }).slice(0, LIM.cols);
            var rows = (Array.isArray(t.rows) ? t.rows : []).slice(0, LIM.rows).map(function (r) {
                var o = {}; cols.forEach(function (c) { var v = r && r[c]; o[c] = (typeof v === 'string' ? v.slice(0, LIM.cell) : (typeof v === 'number' || typeof v === 'boolean') ? v : null); }); return o;
            });
            out.tables[String(n).slice(0, 40)] = { cols: cols, pk: cols.indexOf(t.pk) > -1 ? t.pk : null, auto: isFinite(t.auto) ? Math.max(0, Math.floor(t.auto)) : 0, autopk: !!t.autopk, defaults: {}, rows: rows };
        });
        return out;
    }
    root.StudioSQL = { exec: exec, clean: clean, LIMITS: LIM };
})(typeof window !== 'undefined' ? window : globalThis);
