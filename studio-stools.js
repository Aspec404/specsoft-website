/* SPECSOFT® Studio, PHASE 7a: STools. The tool bar (4 sections), the keyboard shortcuts and the tool panels
   (Folder, Align, Find, Inspect, Monitor). The graph itself is edited by studio-graph.js (its STools API);
   running is done by studio-engine.js. This file only connects the two and adds the diagnostics.

   PHASE 7b (this version): resizable bottom panel and Properties panel, Console search / copy / export / error badge,
   View tools (fit, zoom), a UI-stall watchdog, and anti-freeze guards (Console row cap, debounced Explorer refresh).

   Needs, in studio.html: <script src="studio-stools.js"></script> AFTER studio-shell.js and BEFORE studio.js.
   Optional engine additions (E.spawn, E.setEnabled, E.start({graph})) unlock Spawn, live Toggle and
   "Start from selection". Without them those three degrade to a clear message in the Console. */
(function () {
    'use strict';
    if (window.__STUDIO_BLOCKED) return;                 // blocked device: do nothing (see studio-guard.js)
    var G = window.StudioGraph, E = window.StudioEngine, nav = document.getElementById('stTools'), canvas = document.getElementById('stCanvas');
    if (!G || !nav || !canvas) return;
    function $(id) { return document.getElementById(id); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
    function hasE(fn) { return !!E && typeof E[fn] === 'function'; }
    function say(sev, src, msg, id) { G.log(sev, src, msg, id); }

    /* ---- styles (graph pieces that studio.css does not have yet + the tool bar + the panels) ---- */
    var CSS = [
        '.st-under{position:absolute;left:0;top:0}',
        '.st-group{position:absolute;box-sizing:border-box;border:1px dashed var(--border-hover,#666);background:rgba(127,127,127,.05);pointer-events:none}',
        '.st-group span{position:absolute;left:8px;top:-18px;font:500 .65rem var(--font-mono,monospace);color:var(--text-secondary)}',
        '.st-frame{position:absolute;box-sizing:border-box;border:1px solid var(--border-hover,#666);background:rgba(127,127,127,.06);pointer-events:none}',
        '.st-frame.sel{border-color:var(--text-primary)}.st-frame.tmp{border-style:dashed}',
        '.st-frame-bar{pointer-events:auto;height:22px;padding:4px 8px;box-sizing:border-box;font:500 .68rem var(--font-mono,monospace);color:var(--text-primary);background:rgba(127,127,127,.18);cursor:move;white-space:nowrap;overflow:hidden}',
        '.st-frame-rs{pointer-events:auto;position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;border-right:3px solid var(--text-secondary);border-bottom:3px solid var(--text-secondary);box-sizing:border-box}',
        '.st-lasso{fill:rgba(127,127,127,.12);stroke:currentColor;stroke-width:1.5;stroke-dasharray:4 3;pointer-events:none}',
        '.st-node.t-reroute{width:18px;height:18px;padding:0;border-radius:50%}.st-node.t-reroute .st-port{display:none}',
        '.st-bp{position:absolute;left:-5px;top:-5px;width:10px;height:10px;border-radius:50%;background:#e5484d;text-decoration:none}',
        '.st-node.hit{outline:2px solid #e5484d;outline-offset:3px}',
        '.st-trace{position:absolute;left:0;top:-19px;padding:1px 5px;font:500 .62rem var(--font-mono,monospace);color:var(--text-primary);background:var(--bg-card,#101010);border:1px solid var(--border-subtle,#333);white-space:nowrap;pointer-events:none}',
        '.st-node.pulse{outline:2px solid var(--text-primary);outline-offset:3px;box-shadow:0 0 16px rgba(160,160,160,.45)}',
        'g.pulse .st-wire{stroke:var(--text-primary);stroke-width:4}',
        '.st-node.fc-0{border-left:4px solid #6aa9ff}.st-node.fc-1{border-left:4px solid #2fa66a}.st-node.fc-2{border-left:4px solid #e0a800}',
        '.st-node.fc-3{border-left:4px solid #c084fc}.st-node.fc-4{border-left:4px solid #e5484d}.st-node.fc-5{border-left:4px solid #38bdf8}',
        '.st-canvas[data-tool="lasso"],.st-canvas[data-tool="frame"],.st-canvas[data-tool="createbranch"],.st-canvas[data-tool="reroute"],.st-canvas[data-tool="wait"]{cursor:crosshair}',
        '.st-canvas[data-tool="inspect"]{cursor:help}.st-canvas[data-tool="debug"] .st-node:hover{border-color:#e5484d}',
        '.st-canvas[data-tool="cut"] .st-frame-bar:hover,.st-canvas[data-tool="delete"] .st-frame-bar:hover{background:#e5484d;color:#fff}',
        /* tool bar */
        '.st-tools{gap:2px;padding:8px 6px;overflow-x:hidden;overflow-y:auto;min-height:0;scrollbar-width:thin}',
        '.st-tools button.sx-h{display:flex;width:100%;height:auto;justify-content:space-between;align-items:center;background:none;border:0;border-bottom:1px solid var(--border-subtle,#2a2a2a);color:var(--text-secondary);font:500 .6rem var(--font-mono,monospace);letter-spacing:.08em;padding:8px 2px 4px;margin-top:4px;cursor:pointer;opacity:1}',
        '.sx-h::after{content:"-"}.sx-h[aria-expanded="false"]::after{content:"+"}.st-tools button.sx-h:hover{color:var(--text-primary)}',
        '.sx-grid{display:grid;grid-template-columns:repeat(2,38px);gap:4px;padding:6px 0;justify-content:center}.sx-grid[hidden]{display:none}',
        '.st-tools button.sx-b{position:relative;width:38px;height:38px;padding:0;display:grid;place-items:center;background:none;border:1px solid transparent;color:var(--text-secondary);cursor:pointer;opacity:1}',
        '.st-tools button.sx-b:hover:not(:disabled){border-color:var(--border-hover,#666);color:var(--text-primary)}',
        '.st-tools button.sx-b[aria-pressed="true"]{background:var(--text-primary);color:var(--bg-base,#000)}',
        '.st-tools button.sx-b:disabled{opacity:.3;cursor:not-allowed}',
        '.st-tools button.sx-b[data-key]::after{content:attr(data-key);position:absolute;right:2px;bottom:0;font:500 .5rem var(--font-mono,monospace);opacity:.6}',
        '@media (min-width:901px){.st-app{grid-template-columns:250px 100px 1fr var(--sx-props,260px)}.st-app.collapsed{grid-template-columns:0 100px 1fr var(--sx-props,260px)}',
        '.st-app:not([data-mode="graph"]){grid-template-columns:250px 1fr}.st-app.collapsed:not([data-mode="graph"]){grid-template-columns:0 1fr}}',
        '@media (max-width:900px){.st-tools{align-items:center}.sx-sec{display:flex;align-items:center}.st-tools button.sx-h{width:auto;border:0;margin:0}.sx-grid{display:flex;padding:0 4px}}',
        /* panels */
        '.st-pop,.st-find,.st-inspect{position:absolute;z-index:4;box-sizing:border-box;width:270px;max-height:calc(100% - 64px);overflow:auto;padding:10px;background:var(--bg-card,#101010);border:1px solid var(--border-hover,#666);color:var(--text-primary);font:400 .75rem var(--font-mono,monospace);cursor:default;user-select:text;-webkit-user-select:text;touch-action:auto}',
        '.st-pop,.st-find{left:10px;top:44px}.st-inspect{right:10px;top:10px}',
        '.sx-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.sx-x{background:none;border:0;color:var(--text-secondary);cursor:pointer;font-size:.85rem}',
        '.sx-note{margin:6px 0;color:var(--text-secondary);line-height:1.45}.sx-dim{color:var(--text-secondary)}',
        '.st-pop input,.st-find input{width:100%;box-sizing:border-box;margin:4px 0;background:var(--bg-base,#000);color:var(--text-primary);border:1px solid var(--border-subtle,#333);padding:6px 8px;font:inherit;user-select:text;-webkit-user-select:text}',
        '.st-pop .st-btn{padding:5px 8px;font-size:.72rem}.sx-row{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.sx-two{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
        '.sx-list{list-style:none;margin:6px 0 0;padding:0}.sx-list li{padding:2px 0}',
        '.sx-list button{display:block;width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--border-subtle,#2a2a2a);color:var(--text-primary);padding:6px 2px;font:inherit;cursor:pointer}',
        '.sx-list button:hover{background:rgba(127,127,127,.15)}.sx-list small{display:block;color:var(--text-secondary)}',
        '.st-inspect dl{margin:0}.st-inspect dt{color:var(--text-secondary);margin-top:6px}.st-inspect dd{margin:2px 0 0;word-break:break-all}',
        /* resizable panels */
        '.st-work{position:relative}',
        '.st-app:not([data-mode="dock"]):not([data-mode="page"]) .st-work{grid-template-rows:auto minmax(0,1fr) var(--sx-dock,260px)}',
        '.sx-grip{position:absolute;z-index:6;touch-action:none;background:transparent}',
        '.sx-grip-h{left:0;right:0;bottom:calc(var(--sx-dock,260px) - 4px);height:9px;cursor:ns-resize}',
        '.sx-grip-v{top:0;bottom:0;right:-4px;width:9px;cursor:ew-resize}',
        '.sx-grip::after{content:"";position:absolute;background:var(--text-secondary);opacity:0;border-radius:2px;transition:opacity .15s}',
        '.sx-grip-h::after{left:50%;top:3px;width:48px;height:3px;margin-left:-24px}.sx-grip-v::after{top:50%;left:3px;height:48px;width:3px;margin-top:-24px}',
        '.sx-grip:hover::after,.sx-grip:focus-visible::after,.sx-grip.on::after{opacity:.9}',
        '.st-app[data-mode="dock"] .sx-grip,.st-app[data-mode="page"] .sx-grip,.st-app:not([data-mode="graph"]) .sx-grip-v{display:none}',
        '.st-app.sx-resizing{user-select:none;-webkit-user-select:none}.st-app.sx-resizing iframe{pointer-events:none}',
        /* Console and Debugger fixes: the old "div" grid rule squeezed the Compare box, and 70px was too narrow for a time like 10:45:12 PM */
        '.st-log>div{grid-template-columns:92px 52px 84px minmax(0,1fr);overflow-wrap:anywhere}',
        '.st-hist details>div{grid-template-columns:60px 52px 84px minmax(0,1fr);overflow-wrap:anywhere}',
        '.st-hist .st-cmp{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.st-hist .st-cmp>div{display:block;flex-basis:100%;overflow:auto}',
        '.sx-ctl{display:inline-flex;align-items:center;gap:2px;margin-left:6px}.sx-ctl[hidden]{display:none}',
        '.st-tabs input.sx-search{width:120px;box-sizing:border-box;background:var(--bg-base,#000);color:var(--text-primary);border:1px solid var(--border-subtle,#333);font:400 .72rem var(--font-mono,monospace);padding:3px 6px}',
        '.sx-badge{margin-left:6px;background:#e5484d;color:#fff;border-radius:9px;padding:0 6px;font:600 .62rem var(--font-mono,monospace)}.sx-badge[hidden]{display:none}',
        '@media (prefers-reduced-motion:reduce){.st-node.pulse{box-shadow:none}.sx-grip::after{transition:none}}'
    ].join('\n');
    var styleEl = document.createElement('style'); styleEl.id = 'stStoolsCss'; styleEl.textContent = CSS; document.head.appendChild(styleEl);

    /* ---- icons (static, written here, never user data) ---- */
    var IC = {
        select: '<path d="M5 3l14 8-6 2-2 6z"/>',
        grab: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V10M14 10V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2.5-4.5a1.5 1.5 0 0 1 2.5-1.5L8 14"/>',
        cut: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>',
        delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
        lasso: '<path d="M12 4c5 0 9 2 9 5s-4 5-9 5-9-2-9-5 4-5 9-5z"/><path d="M8 13c-1 3 0 5 3 6"/><circle cx="11.5" cy="20" r="1.5"/>',
        duplicate: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/>',
        group: '<path stroke-dasharray="3 2" d="M3 3h18v18H3z"/><rect x="6" y="6" width="5" height="5"/><rect x="13" y="13" width="5" height="5"/>',
        frame: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>',
        undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
        connect: '<circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M7.5 12h9M14 9l3 3-3 3"/>',
        node: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M12 9.5v5M9.5 12h5"/>',
        folder: '<path d="M3 7h6l2 2h10v10H3z"/>',
        branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-12 1-12 6"/>',
        reroute: '<path d="M3 12h5M16 12h5"/><circle cx="12" cy="12" r="3"/>',
        align: '<path d="M4 3v18"/><rect x="7" y="5" width="12" height="4"/><rect x="7" y="14" width="7" height="4"/>',
        inspect: '<circle cx="10" cy="10" r="6"/><path d="M15 15l6 6M10 9v4M10 6.8v.2"/>',
        find: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
        start: '<path d="M7 4l13 8-13 8z"/>',
        pause: '<path d="M8 5v14M16 5v14"/>',
        step: '<path d="M5 4l9 8-9 8zM18 5v14"/>',
        pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
        wait: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
        toggle: '<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="16" cy="12" r="2.5"/>',
        spawn: '<circle cx="12" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M12 8.5v3M12 11.5l-5 4.5M12 11.5l5 4.5"/>',
        stop: '<rect x="6" y="6" width="12" height="12"/>',
        validate: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 5-5"/>',
        debug: '<path d="M8 8h8v8a4 4 0 0 1-8 0zM12 4v4M4 12h4M16 12h4M5 6l3 3M19 6l-3 3"/>',
        trace: '<path d="M4 18c4 0 4-12 8-12s4 12 8 12"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="18" r="1.5"/>',
        monitor: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4M6 12l3-3 3 3 4-4"/>',
        fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        zoomin: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
        zoomout: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
        resetview: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'
    };
    function svg(id) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[id] + '</svg>'; }

    /* ---- the tools. kind: tool = stays selected and changes what a click does | action = runs once | pop = opens a panel | toggle = on/off.
       To change a shortcut, change its "key" here (plain letters or Ctrl+Letter). ---- */
    var SECTIONS = [
        { name: 'Canvas', items: [
            { id: 'select', name: 'Select', key: 'S', kind: 'tool', tool: 'select', tip: 'Click a node to select it, Shift+click to add, drag to move. Double-click a branch to open it.' },
            { id: 'grab', name: 'Grab', key: 'G', kind: 'tool', tool: 'move', tip: 'Drag to pan the canvas. Holding Space does the same from any tool.' },
            { id: 'cut', name: 'Cut', key: 'C', kind: 'tool', tool: 'cut', tip: 'Click a connection to cut it.' },
            { id: 'delete', name: 'Delete', key: 'D', kind: 'tool', tool: 'delete', tip: 'Click a node, connection or frame to delete it.' },
            { id: 'lasso', name: 'Lasso', key: 'L', kind: 'tool', tool: 'lasso', tip: 'Draw a loop around nodes to select them. Shift adds to the selection.' },
            { id: 'duplicate', name: 'Duplicate', key: 'Ctrl+D', kind: 'action', run: function () { G.duplicate(); }, tip: 'Copy the selected nodes and the connections between them.' },
            { id: 'group', name: 'Group', key: 'Ctrl+G', kind: 'action', run: function () { G.group(); }, tip: 'Bind 2+ selected nodes so they move together. Ctrl+Shift+G ungroups.' },
            { id: 'frame', name: 'Frame', key: 'F', kind: 'tool', tool: 'frame', tip: 'Drag a rectangle to draw a labelled frame. Moving a frame moves the nodes inside it.' },
            { id: 'undo', name: 'Undo', key: 'Ctrl+Z', kind: 'action', run: function () { history(false); }, tip: 'Undo the last change to the graph (nodes, connections, code, frames, folders). Waits while a run is active.' },
            { id: 'redo', name: 'Redo', key: 'Ctrl+Y', kind: 'action', run: function () { history(true); }, tip: 'Redo what you just undid.' }
        ] },
        { name: 'Graphs', items: [
            { id: 'connect', name: 'Connect', key: 'Ctrl+C', kind: 'tool', tool: 'connect', tip: 'Click a node, then another, to connect them. Loops are blocked.' },
            { id: 'node', name: 'Node', key: 'N', kind: 'tool', tool: 'create', tip: 'Click the canvas to place a node.' },
            { id: 'folder', name: 'Folder', key: '', kind: 'pop', run: function () { folderPop(); }, tip: 'Put the selected nodes in a named folder (it also appears in Explorer).' },
            { id: 'branch', name: 'Branch', key: 'B', kind: 'tool', tool: 'createbranch', tip: 'Click the canvas to place a branch (a nested graph). Double-click it to open.' },
            { id: 'reroute', name: 'Reroute', key: 'R', kind: 'tool', tool: 'reroute', tip: 'Click the canvas for a reroute dot, or click a connection to insert one.' },
            { id: 'align', name: 'Align', key: 'A', kind: 'pop', run: function () { alignPop(); }, tip: 'Align or evenly spread the selected nodes.' },
            { id: 'inspect', name: 'Inspect', key: 'I', kind: 'tool', tool: 'inspect', tip: 'Click a node to see its details.' },
            { id: 'find', name: 'Find', key: '/', kind: 'pop', run: function () { findPop(); }, tip: 'Search labels, types, code, SQL and events in every branch.' }
        ] },
        { name: 'Runtime', items: [
            { id: 'start', name: 'Start', key: '', kind: 'action', run: function () { start(); }, tip: 'Run the graph. With nodes selected (and the updated engine) only those and everything after them run.' },
            { id: 'pause', name: 'Pause', key: '', kind: 'action', run: function () { pauseResume(); }, tip: 'Pause: steps already running finish, no new step starts. Press again to resume.' },
            { id: 'step', name: 'Step', key: '', kind: 'action', run: function () { step(); }, tip: 'Release the next node of a paused run, then pause again. From idle it starts a run and pauses after the first node.' },
            { id: 'pulse', name: 'Pulse', key: 'P', kind: 'action', run: function () { pulse(); }, tip: 'Dry run: a signal travels along the wires. Nothing is executed.' },
            { id: 'wait', name: 'Wait', key: 'W', kind: 'tool', tool: 'wait', tip: 'Click the canvas to place a 1 s Wait node, or click a connection to insert one.' },
            { id: 'toggle', name: 'Toggle', key: 'T', kind: 'action', run: function () { G.toggleSel(); }, tip: 'Enable or disable the selected nodes (also live during a run with the updated engine).' },
            { id: 'spawn', name: 'Spawn', key: '', kind: 'action', run: function () { spawn(); }, tip: 'During a run, start another copy of the selected branch (25 per run max).' },
            { id: 'stop', name: 'Stop', key: '', kind: 'action', run: function () { stop(); }, tip: 'Stop the run for good.' }
        ] },
        { name: 'Diagnostics', items: [
            { id: 'validate', name: 'Validate', key: '', kind: 'action', run: function () { validate(); }, tip: 'Check for loops, empty or broken scripts, wrong label references and limits.' },
            { id: 'debug', name: 'Debug', key: '', kind: 'tool', tool: 'debug', tip: 'Click a node to set or remove a breakpoint. The run pauses when that node starts.' },
            { id: 'trace', name: 'Trace', key: '', kind: 'toggle', run: function () { traceToggle(); }, tip: 'Show run order and time on every node.' },
            { id: 'monitor', name: 'Monitor', key: '', kind: 'pop', run: function () { monitorPop(); }, tip: 'Live panel: run state, node counts, running nodes, breakpoints and UI stalls.' }
        ] },
        { name: 'View', items: [
            { id: 'fit', name: 'Fit view', key: 'V', kind: 'action', run: function () { viewOp('fit'); }, tip: 'Zoom and pan so the whole graph is visible.' },
            { id: 'zoomin', name: 'Zoom in', key: '+', kind: 'action', run: function () { viewOp('in'); }, tip: 'Zoom in (the mouse wheel works too).' },
            { id: 'zoomout', name: 'Zoom out', key: '-', kind: 'action', run: function () { viewOp('out'); }, tip: 'Zoom out.' },
            { id: 'resetview', name: 'Reset view', key: '0', kind: 'action', run: function () { viewOp('reset'); }, tip: 'Back to 100% at the top-left.' }
        ] }
    ];
    var ITEM = {}, KEYS = { 'ctrl+shift+g': { run: function () { G.ungroup(); } }, 'ctrl+a': { run: function () { G.selectAll(); } }, 'ctrl+shift+z': { run: function () { history(true); } } };
    SECTIONS.forEach(function (s) { s.items.forEach(function (it) { ITEM[it.id] = it; if (it.key) KEYS[it.key.toLowerCase()] = it; }); });

    /* ---- state ---- */
    var pop = { name: null, el: null, paint: null }, card = null, lastRun = 0, order = 0, started = {}, hitIds = {}, stepPending = false;

    /* ---- tool bar ---- */
    function build() {
        nav.textContent = ''; nav.setAttribute('aria-label', 'STools');
        SECTIONS.forEach(function (sec) {
            var box = el('section', 'sx-sec'), h = el('button', 'sx-h', sec.name.toUpperCase()), grid = el('div', 'sx-grid');
            h.type = 'button'; h.setAttribute('aria-expanded', 'true'); h.title = 'Show or hide ' + sec.name + ' tools';
            h.addEventListener('click', function () { grid.hidden = !grid.hidden; h.setAttribute('aria-expanded', String(!grid.hidden)); });
            sec.items.forEach(function (it) {
                var b = el('button', 'sx-b'); b.type = 'button'; b.dataset.id = it.id; b.innerHTML = svg(it.id);
                b.title = it.name + (it.key ? ' (' + it.key + ')' : '') + ': ' + it.tip; b.setAttribute('aria-label', it.name + (it.key ? ', shortcut ' + it.key : ''));
                if (it.key.length === 1 && it.key !== '/') b.dataset.key = it.key;
                b.addEventListener('click', function () { trigger(it); });
                grid.appendChild(b);
            });
            box.appendChild(h); box.appendChild(grid); nav.appendChild(box);
        });
    }
    function trigger(it) {
        if (!G.isOpen()) return;
        if (it.kind === 'tool') { closePop(); G.setTool(it.tool); } else it.run();
        syncAll();
    }

    /* ---- run state helpers (the engine shows its state in #stRunState: "Idle", "Run 3 running", "Run 3 paused") ---- */
    function runState() { var t = ($('stRunState') || {}).textContent || ''; return /paused/.test(t) ? 'paused' : /running/.test(t) ? 'running' : 'idle'; }
    function runNo() { var m = /Run (\d+)/.exec(($('stRunState') || {}).textContent || ''); return m ? +m[1] : 0; }
    function setLook(b, id, resume) {                     // the Pause button turns into Resume while the run is paused
        var it = ITEM[id], mode = resume ? 'r' : 'p'; if (b.dataset.mode === mode) return; b.dataset.mode = mode;
        b.innerHTML = svg(resume ? 'start' : 'pause');
        b.title = resume ? 'Resume: continue the paused run' : it.name + ': ' + it.tip; b.setAttribute('aria-label', resume ? 'Resume' : it.name);
    }
    function syncAll() {
        var open = G.isOpen(), rs = runState(), t = G.getTool(), tr = G.getTraceOn();
        Array.prototype.forEach.call(nav.querySelectorAll('.sx-b'), function (b) {
            var it = ITEM[b.dataset.id], dis = !open, on = null;
            if (open) {
                if (it.id === 'start') dis = rs !== 'idle'; else if (it.id === 'pause') dis = rs === 'idle'; else if (it.id === 'step') dis = rs === 'running';
                else if (it.id === 'stop' || it.id === 'spawn') dis = rs === 'idle';
                else if (it.id === 'undo') dis = typeof G.canUndo !== 'function' || !G.canUndo(); else if (it.id === 'redo') dis = typeof G.canRedo !== 'function' || !G.canRedo();
            }
            if (it.kind === 'tool') on = t === it.tool; else if (it.kind === 'pop') on = pop.name === it.id; else if (it.id === 'trace') on = tr;
            if (b.disabled !== dis) b.disabled = dis;
            if (on === null) b.removeAttribute('aria-pressed'); else if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on));
            if (it.id === 'pause') setLook(b, 'pause', rs === 'paused');
        });
    }

    /* ---- shortcuts: only on the graph view, with a project open, and never while typing ---- */
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && pop.el) closePop();
        if (!G.isOpen() || e.altKey || !e.key || $('stApp').dataset.mode !== 'graph') return;
        var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
        var ky = e.key, ctl = e.ctrlKey || e.metaKey;
        if (!ctl) { if (ky === '=' || ky === '+') ky = '+'; else if (ky === '_' || ky === '-') ky = '-'; }          // + and - work with or without Shift
        var sh = e.shiftKey && (ky.length > 1 || /^[a-z]$/i.test(ky)), k = (ctl ? 'ctrl+' : '') + (sh ? 'shift+' : '') + ky.toLowerCase(), it = KEYS[k];
        if (!it) return;
        if ((k === 'ctrl+c' || k === 'ctrl+a') && String(window.getSelection ? window.getSelection() : '').length) return;      // text is selected: let the normal copy happen
        e.preventDefault(); if (it.kind) trigger(it); else it.run();
    });

    /* ---- panels (one at a time on the left; the Inspect card on the right) ---- */
    function closePop() {
        if (pop.el) pop.el.remove();
        pop.el = null; pop.name = null; pop.paint = null; syncAll();
    }
    function closeCard() { if (card) card.remove(); card = null; }
    function head(p, title, onClose) {
        var h = el('div', 'sx-head'), x = el('button', 'sx-x', '\u2715'); x.type = 'button'; x.setAttribute('aria-label', 'Close ' + title);
        x.addEventListener('click', onClose || closePop); h.appendChild(el('strong', '', title)); h.appendChild(x); p.appendChild(h);
    }
    function openPop(name, cls, fill) {
        if (pop.name === name) { closePop(); return null; }
        closePop();
        var p = el('div', cls); p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', name);
        p.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: true });          // scrolling a panel must not zoom the canvas
        pop.el = p; pop.name = name; fill(p); canvas.appendChild(p); syncAll(); return p;
    }
    function btn(text, fn, title) { var b = el('button', 'st-btn', text); b.type = 'button'; if (title) b.title = title; b.addEventListener('click', fn); return b; }

    function folderPop() {
        openPop('folder', 'st-pop', function (p) {
            head(p, 'Folder'); var n = G.selection().length;
            p.appendChild(el('p', 'sx-note', n ? n + ' node(s) selected.' : 'Select one or more nodes first (Select or Lasso tool).'));
            var i = el('input'); i.type = 'text'; i.maxLength = 24; i.placeholder = 'Folder name'; i.setAttribute('aria-label', 'Folder name'); i.setAttribute('list', 'sxFolders');
            var dl = el('datalist'); dl.id = 'sxFolders'; G.folders().forEach(function (f) { var o = el('option'); o.value = f; dl.appendChild(o); });
            var row = el('div', 'sx-row');
            function put() { if (!i.value.trim()) { say('warn', 'folder', 'Type a folder name first'); return; } G.setFolder(i.value); closePop(); }
            i.addEventListener('keydown', function (e) { if (e.key === 'Enter') put(); });
            row.appendChild(btn('Move selection here', put)); row.appendChild(btn('Remove from folder', function () { G.setFolder(''); closePop(); }));
            p.appendChild(i); p.appendChild(dl); p.appendChild(row); setTimeout(function () { i.focus(); }, 0);
        });
    }
    function alignPop() {
        openPop('align', 'st-pop', function (p) {
            head(p, 'Align'); p.appendChild(el('p', 'sx-note', G.selection().length < 2 ? 'Select two or more nodes first.' : G.selection().length + ' nodes selected.'));
            var g = el('div', 'sx-two');
            [['left', 'Left'], ['hcenter', 'Center H'], ['right', 'Right'], ['top', 'Top'], ['vcenter', 'Center V'], ['bottom', 'Bottom'], ['distH', 'Spread H'], ['distV', 'Spread V']].forEach(function (a) {
                g.appendChild(btn(a[1], function () { G.align(a[0]); }));
            });
            p.appendChild(g);
        });
    }
    function findPop() {
        openPop('find', 'st-find', function (p) {
            head(p, 'Find'); var i = el('input'), info = el('p', 'sx-note', 'Search labels, types, code, SQL and event names.'), list = el('ul', 'sx-list'), t = 0;
            i.type = 'text'; i.maxLength = 60; i.placeholder = 'Search...'; i.setAttribute('aria-label', 'Search the graph');
            function go() {
                var r = G.search(i.value); list.textContent = '';
                info.textContent = !i.value.trim() ? 'Search labels, types, code, SQL and event names.' : r.length ? r.length + ' result(s)' + (r.length >= 50 ? ' (first 50)' : '') : 'Nothing found.';
                r.forEach(function (x) {
                    var li = el('li'), b = el('button'); b.type = 'button'; b.appendChild(el('span', '', x.label + '  (' + x.type + ')'));
                    b.appendChild(el('small', '', 'in ' + x.field + (x.snippet ? ': ' + x.snippet : '')));
                    b.addEventListener('click', function () { if (window.StudioShell) StudioShell.setView('graph'); G.reveal(x.id); });
                    li.appendChild(b); list.appendChild(li);
                });
            }
            i.addEventListener('input', function () { clearTimeout(t); t = setTimeout(go, 120); });
            i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var f = list.querySelector('button'); if (f) f.click(); } });
            p.appendChild(i); p.appendChild(info); p.appendChild(list); setTimeout(function () { i.focus(); }, 0);
        });
    }
    function fmtDelay(n, k) { var v = n.config[k] || 0; return n.config.unit === 's' ? v / 1000 + ' s' : v + ' ms'; }
    function showInspect(id) {
        var d = G.nodeInfo(id); if (!d) return; closeCard();
        var n = d.node, c = el('div', 'st-inspect'), dl = el('dl'); c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Inspect ' + n.label);
        c.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: true });
        head(c, 'Inspect ' + n.label, closeCard);
        var code = n.type === 'database' ? n.config.sql : n.type === 'script' ? n.config.code : '';
        var rows = [['Type', n.type + (n.type === 'script' ? ' (' + n.config.lang + ')' : '')], ['Enabled', n.enabled ? 'yes' : 'no'], ['Status', n.status], ['Breakpoint', n.bp ? 'set' : 'none'],
            ['Folder', d.folder || 'none'], ['Group', d.group || 'none'], ['Inputs', d.ins.join(', ') || 'none'], ['Outputs', d.outs.join(', ') || 'none'],
            ['Delays', 'activation ' + fmtDelay(n, 'aDelay') + ', execution ' + fmtDelay(n, 'eDelay') + ', output ' + fmtDelay(n, 'oDelay')], ['Waits for event', n.config.waitEvent || 'none']];
        if (n.type === 'script' && n.config.lang === 'javascript') rows.push(['Time limit', n.config.timeout + ' ms']);
        if (code) rows.push(['Code', code.length + ' characters, ' + code.split('\n').length + ' lines']);
        if (n.type === 'branch') rows.push(['Contents', n.config.sub.nodes.length + ' node(s), runs ' + (n.config.mode === 'independent' ? 'independently' : 'as part of the parent')]);
        rows.push(['Position', n.x + ', ' + n.y], ['Internal id', n.id]);
        rows.forEach(function (r) { dl.appendChild(el('dt', '', r[0])); dl.appendChild(el('dd', '', r[1])); });
        c.appendChild(dl); canvas.appendChild(c); card = c;
    }
    function monitorPop() {
        openPop('monitor', 'st-pop', function (p) {
            head(p, 'Monitor'); var st = el('p', 'sx-note'), cnt = el('p', 'sx-note'), run = el('ul', 'sx-list'), bp = el('p', 'sx-note'), clr = btn('Clear all breakpoints', clearBps), perf = el('p', 'sx-note');
            p.appendChild(st); p.appendChild(cnt); p.appendChild(el('strong', '', 'Running now')); p.appendChild(run); p.appendChild(bp); p.appendChild(clr); p.appendChild(perf);
            pop.paint = function () {
                var list = G.listNodes(), c = {}, running = [], bps = 0;
                list.forEach(function (x) {
                    var n = G.node(x.id); if (!n) return; c[n.status] = (c[n.status] || 0) + 1; if (n.bp) bps++;
                    if (n.status === 'running') running.push(x.label + '  ' + ((Date.now() - (started[x.id] || Date.now())) / 1000).toFixed(1) + 's');
                });
                st.textContent = 'Run: ' + (($('stRunState') || {}).textContent || 'Idle') + '  |  nodes (all branches): ' + list.length;
                cnt.textContent = ['running', 'waiting', 'done', 'error', 'stopped', 'skipped', 'idle'].filter(function (k) { return c[k]; }).map(function (k) { return k + ' ' + c[k]; }).join('  |  ') || 'No nodes yet.';
                run.textContent = ''; running.forEach(function (t) { run.appendChild(el('li', '', t)); }); if (!running.length) run.appendChild(el('li', 'sx-dim', 'Nothing running'));
                bp.textContent = 'Breakpoints: ' + bps; clr.disabled = !bps;
                perf.textContent = (stalls.ok ? 'UI stalls over 400 ms: ' + stalls.n + (stalls.n ? ' (worst ' + stalls.worst + ' ms)' : '') : 'UI stall detection is not supported by this browser') + '  |  Console rows: ' + (logEl ? logEl.children.length : 0) + ' of ' + MAXROWS;
            };
            pop.paint();
        });
    }
    function clearBps() {
        var k = 0; G.listNodes().forEach(function (x) { var n = G.node(x.id); if (n && n.bp) { n.bp = false; k++; } });
        clearHits(); G.setSelection(G.selection()); if (k) { G.onChange(); say('info', 'debug', 'Removed ' + k + ' breakpoint(s)'); }
    }
    G.onInspect = showInspect;

    /* ---- runtime ---- */
    function needEngine() { if (E) return true; say('error', 'run', 'The engine is not loaded (studio-engine.js)'); return false; }
    function start() {
        if (!needEngine()) return;
        if (E.isActive()) return say('warn', 'run', 'A run is already active. Stop it first, or use Restart in the top bar.');
        var sel = G.selection();
        if (sel.length && hasE('spawn')) {
            var sub = G.runGraph(sel); say('info', 'run', 'Starting from the selection: ' + sub.nodes.length + ' node(s) (the selected ones and everything after them)'); E.start({ graph: sub });
        } else E.start();
    }
    function pauseResume() {
        if (!needEngine()) return; var rs = runState();
        if (rs === 'paused') { clearHits(); E.resume(); } else if (rs === 'running') E.pause(); else say('info', 'run', 'Nothing is running.');
    }
    function step() {
        if (!needEngine()) return; var rs = runState();
        if (rs === 'running') return say('info', 'step', 'Step works on a paused run. Press Pause first (or Step from idle).');
        clearHits(); stepPending = true;
        if (rs === 'paused') { say('info', 'step', 'Stepping: releasing the next node...'); E.resume(); } else E.start();
    }
    function stop() { if (!needEngine()) return; clearHits(); stepPending = false; E.stop(); }
    function spawn() {
        if (!needEngine()) return;
        if (!hasE('spawn')) return say('warn', 'spawn', 'Spawn needs the updated studio-engine.js (it adds E.spawn).');
        if (!E.isActive()) return say('warn', 'spawn', 'Spawn works during a run. Press Start first.');
        var ids = G.selection().filter(function (id) { var n = G.node(id); return n && n.type === 'branch'; });
        if (!ids.length) return say('warn', 'spawn', 'Select a branch node first (the Branch tool creates one).');
        ids.forEach(function (id) { E.spawn(id); });
    }
    function pulse() {
        var o = G.pulse(G.selection());
        say('info', 'pulse', o.length ? 'Pulse (dry run, nothing executed): ' + o.join(' > ') : 'Pulse: no nodes to send a signal through');
    }
    G.onToggleNodes = function (ids) {                   // keep a running run in step with the Toggle tool
        if (!hasE('setEnabled')) return;
        ids.forEach(function (id) { var n = G.node(id); if (n) E.setEnabled(id, n.enabled); });
    };

    function history(redo) {
        if (typeof G.undo !== 'function') return say('warn', 'undo', 'Undo needs the updated studio-graph.js');
        if (runState() !== 'idle') return say('warn', 'undo', 'Stop the run before ' + (redo ? 'redoing' : 'undoing') + '.');
        if (redo) G.redo(); else G.undo(); syncAll();
    }
    function viewOp(op) {
        if (typeof G.fit !== 'function') return say('warn', 'view', 'View tools need the updated studio-graph.js (it adds fit and zoom).');
        if (op === 'fit') { if (!G.fit()) say('info', 'view', 'Nothing to fit yet: the graph is empty.'); }
        else if (op === 'in') G.zoomBy(1.25); else if (op === 'out') G.zoomBy(0.8); else G.resetView();
    }

    /* ---- diagnostics ---- */
    function showConsole() { var b = document.querySelector('[data-tab="log"]'); if (b && b.getAttribute('aria-selected') !== 'true') b.click(); }
    function traceToggle() { var on = !G.getTraceOn(); G.setTraceOn(on); say('info', 'trace', on ? 'Trace on: nodes show run order and time during the next run' : 'Trace off'); }
    function clearHits() { Object.keys(hitIds).forEach(function (id) { G.setBreakHit(id, false); }); hitIds = {}; }
    function topoOk(c) {
        var deg = {}, adj = {}, q = [], seen = 0; c.nodes.forEach(function (n) { deg[n.id] = 0; adj[n.id] = []; });
        c.connections.forEach(function (x) { if (adj[x.from] && x.to in deg) { adj[x.from].push(x.to); deg[x.to]++; } });
        Object.keys(deg).forEach(function (k) { if (!deg[k]) q.push(k); });
        while (q.length) { var k = q.shift(); seen++; adj[k].forEach(function (t) { if (--deg[t] === 0) q.push(t); }); }
        return seen === c.nodes.length;
    }
    function validate() {
        if (!G.isOpen()) return; showConsole();
        var g = G.get(), errs = 0, warns = 0, count = 0, emitted = {}, evalOff = false, AF = null;
        try { AF = Object.getPrototypeOf(async function () {}).constructor; } catch (e) {}
        function report(sev, text, id) { if (sev === 'error') errs++; else if (sev === 'warn') warns++; say(sev, 'validate', text, id); }
        (function scan(c) {
            c.nodes.forEach(function (n) {
                count++; var cf = n.config || {};
                if (n.type === 'script' && cf.lang === 'javascript') { var re = /studio\.emit\(\s*["'`]([A-Za-z0-9_-]{1,20})["'`]/g, m; while ((m = re.exec(cf.code || ''))) emitted[m[1]] = 1; }
                if (cf.sub) scan(cf.sub);
            });
        })(g);
        ((g.timeline && g.timeline.tracks) || []).forEach(function (tr) { (tr.markers || []).forEach(function (m) { if (m.a === 'custom' && m.name) emitted[m.name] = 1; }); });
        function check(c, trail) {
            var where = trail.length ? trail.join(' / ') + ' / ' : '', byLabel = {}, dup = {};
            c.nodes.forEach(function (n) { if (byLabel[n.label]) dup[n.label] = 1; else byLabel[n.label] = n; });
            Object.keys(dup).forEach(function (l) { report('warn', where + l + ': more than one node has this label. Scripts find nodes by label, so only the first can be reached.', byLabel[l].id); });
            if (!topoOk(c)) report('error', (where || 'Root graph: ') + 'contains a loop, so it cannot run.', null);
            c.nodes.forEach(function (n) {
                var cf = n.config || {}, name = where + n.label;
                var ins = c.connections.filter(function (x) { return x.to === n.id; }).length, outs = c.connections.filter(function (x) { return x.from === n.id; }).length;
                if (n.type === 'reroute') { if (!ins || !outs) report('warn', name + ': reroute is not connected on both sides.', n.id); return; }
                if (c.nodes.length > 1 && !ins && !outs) report('info', name + ': not connected to anything (it still runs, on its own).', n.id);
                if (cf.waitEvent && !emitted[cf.waitEvent]) report('warn', name + ': waits for event "' + cf.waitEvent + '" but no script or timeline marker fires it.', n.id);
                if (n.type === 'script') {
                    var code = String(cf.code || '');
                    if (!code.trim()) { report('warn', name + ': script has no code.', n.id); return; }
                    if (cf.lang !== 'javascript') return;
                    if (AF && !evalOff) { try { new AF('studio', 'input', code); } catch (e) { if (e && e.name === 'EvalError') evalOff = true; else report('error', name + ': ' + (e.name || 'Error') + ': ' + String(e.message).slice(0, 160), n.id); } }
                    var re = /studio\.(runNode|result|enableNode|disableNode|spawnBranch|stopGroup)\(\s*["'`]([^"'`]{1,40})["'`]/g, m;
                    while ((m = re.exec(code))) {
                        var t = byLabel[m[2]];
                        if (!t) report('error', name + ': studio.' + m[1] + '("' + m[2] + '") points to a node that does not exist in this graph.', n.id);
                        else if ((m[1] === 'spawnBranch' || m[1] === 'stopGroup') && t.type !== 'branch') report('error', name + ': studio.' + m[1] + '("' + m[2] + '") needs a branch, but ' + t.label + ' is a ' + t.type + ' node.', n.id);
                        else if (m[1] === 'runNode' && t === n) report('error', name + ' runs itself with studio.runNode (blocked at run time: no recursion).', n.id);
                    }
                } else if (n.type === 'database') { if (!String(cf.sql || '').trim()) report('warn', name + ': database node has no SQL.', n.id); }
                else if (n.type === 'branch') { if (!cf.sub || !cf.sub.nodes.length) report('warn', name + ': branch is empty.', n.id); else check(cf.sub, trail.concat(n.label)); }
            });
        }
        check(g, []);
        var size = JSON.stringify(g).length;
        if (size > 450000) report('error', 'Project is ' + (size / 1000).toFixed(0) + ' KB. Saving stops at 450 KB.', null);
        else if (size > 360000) report('warn', 'Project is ' + (size / 1000).toFixed(0) + ' KB of the 450 KB save limit.', null);
        if (g.nodes.length >= 180) report('warn', 'The root graph has ' + g.nodes.length + ' of 200 nodes.', null);
        if (evalOff) say('info', 'validate', 'JavaScript syntax check skipped: this page does not allow it.');
        if (!errs && !warns) say('ok', 'validate', 'Checked ' + count + ' node(s): no problems found.');
        else say(errs ? 'error' : 'warn', 'validate', 'Checked ' + count + ' node(s): ' + errs + ' error(s), ' + warns + ' warning(s). Click a line to jump to its node.');
    }

    /* ---- watch the engine: trace badges, breakpoints and Step all hang off node status changes ---- */
    var origSet = G.setStatus;
    G.setStatus = function (id, s) { origSet.apply(G, arguments); try { onStatus(id, s); } catch (e) {} };
    function onStatus(id, s) {
        if (s === 'running') {
            var r = runNo(); if (r !== lastRun) { lastRun = r; order = 0; started = {}; clearHits(); G.traceReset(); }
            order++; started[id] = Date.now(); G.traceUpdate(id, { n: order, ms: null });
            var n = G.node(id);
            if (n && n.bp && hasE('isActive') && E.isActive()) { hitIds[id] = 1; G.setBreakHit(id, true); say('warn', 'debug', n.label + ': breakpoint hit. The run is paused (this node finishes). Press Resume or Step.', id); E.pause(); }
            if (stepPending) { stepPending = false; E.pause(); say('info', 'step', 'Paused after ' + (n ? n.label : 'a node') + '. Step again, or Resume.', id); }
        } else if (/^(done|error|stopped|skipped)$/.test(s)) {
            var t = G.getTrace(id);
            if (t && t.ms == null && started[id]) { t.ms = Date.now() - started[id]; G.traceUpdate(id, t); }
        }
    }
    var tickN = 0, lastWH = 0;
    setInterval(function () {                             // cheap watcher: keeps button states right even when the top bar buttons are used
        if (document.hidden) return;                      // a background tab does no work at all
        syncAll();
        if (runState() === 'idle') { stepPending = false; if (Object.keys(hitIds).length) clearHits(); }
        if (pop.paint && ++tickN % 2 === 0) pop.paint();  // the Monitor repaints twice a second, not four times
        if (work && work.clientHeight !== lastWH) { lastWH = work.clientHeight; applyUI(); }
    }, 250);

    /* clicking a line in the Console (or a Validate result) jumps to its node, even inside a nested branch or from another view */
    var origSelect = G.select;
    G.select = function (id) {
        if (!G.hasNode(id)) return;
        if ($('stApp').dataset.mode !== 'graph' && window.StudioShell) StudioShell.setView('graph');
        origSelect.call(G, id); if (G.selection().indexOf(id) < 0) G.reveal(id);
    };

    /* the graph tells every extension when a project opens or closes; nothing here is saved in the project */
    G.ext.stools = { load: function () {
        closePop(); closeCard(); stepPending = false; started = {}; order = 0; hitIds = {}; lastRun = runNo();
        G.traceReset(); setTimeout(syncAll, 0);
    } };
    G.onTool = function () { syncAll(); };

    /* ---- anti-freeze 1: the Explorer tree and code list used to rebuild on EVERY keystroke in the editor; now they wait for a pause in typing ---- */
    var SH = window.StudioShell;
    if (SH && typeof SH.refresh === 'function') {
        var rawRefresh = SH.refresh, rt = 0;
        SH.refresh = function () { clearTimeout(rt); rt = setTimeout(function () { rt = 0; rawRefresh(); }, 150); };
    }

    /* ---- anti-freeze 2: a watchdog that reports when the page was blocked (Chromium browsers; others just skip it) ---- */
    var stalls = { ok: false, n: 0, worst: 0, last: 0 };
    try {
        new PerformanceObserver(function (list) {
            list.getEntries().forEach(function (en) {
                if (en.duration < 400) return; stalls.n++; stalls.worst = Math.max(stalls.worst, Math.round(en.duration));
                if (Date.now() - stalls.last > 5000) { stalls.last = Date.now(); say('warn', 'perf', 'The page was busy for ' + Math.round(en.duration) + ' ms (it may have felt frozen). If this repeats, look for a very large graph or a heavy script.'); }
            });
        }).observe({ entryTypes: ['longtask'] }); stalls.ok = true;
    } catch (e) {}

    /* ---- resizable panels: drag the top edge of the bottom panel, or the right edge of the workspace (Properties). Saved on this device only ---- */
    var app = $('stApp'), work = $('stWork'), dock = $('stDock'), propsEl = document.querySelector('.st-props'), UI = { dock: 260, props: 260, folded: false }, raf = 0, rafFn = null, rz = 0;
    function cl(v, lo, hi, d) { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; }
    try { var o = JSON.parse(localStorage.getItem('studio-ui') || '{}'); UI.dock = cl(o.dock, 90, 1200, 260); UI.props = cl(o.props, 200, 520, 260); UI.folded = o.folded === true; } catch (e) {}
    function saveUI() { try { localStorage.setItem('studio-ui', JSON.stringify(UI)); } catch (e) {} }
    function later(fn) { rafFn = fn; if (!raf) raf = requestAnimationFrame(function () { raf = 0; var f = rafFn; rafFn = null; if (f) f(); }); }   // at most one layout change per frame
    var gh = el('div', 'sx-grip sx-grip-h'), gv = el('div', 'sx-grip sx-grip-v');
    function tabsH() { var t = dock && dock.querySelector('.st-tabs'); return (t && t.offsetHeight) || 38; }
    function applyUI() {
        if (!app || !work) return;
        var maxD = work.clientHeight ? Math.max(120, work.clientHeight - 150) : 1200, d = UI.folded ? tabsH() + 1 : Math.min(UI.dock, maxD);
        app.style.setProperty('--sx-dock', d + 'px'); app.style.setProperty('--sx-props', UI.props + 'px');
        gh.setAttribute('aria-valuenow', String(d)); gv.setAttribute('aria-valuenow', String(UI.props));
    }
    function grip(g, onStart, onMove) {
        g.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) return; e.preventDefault();
            var st = onStart(e); g.setPointerCapture(e.pointerId); app.classList.add('sx-resizing'); g.classList.add('on');
            function mv(ev) { later(function () { onMove(st, ev); applyUI(); }); }
            function up() { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); app.classList.remove('sx-resizing'); g.classList.remove('on'); setTimeout(saveUI, 60); }
            g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
        });
    }
    function fold() { UI.folded = !UI.folded; applyUI(); saveUI(); }
    if (app && work && dock) {
        gh.setAttribute('role', 'separator'); gh.setAttribute('aria-orientation', 'horizontal'); gh.tabIndex = 0;
        gh.setAttribute('aria-label', 'Resize the bottom panel: drag, or use Up and Down. Enter folds it.'); gh.title = 'Drag to resize. Double-click to fold or unfold.';
        gv.setAttribute('role', 'separator'); gv.setAttribute('aria-orientation', 'vertical'); gv.tabIndex = 0;
        gv.setAttribute('aria-label', 'Resize the Properties panel: drag, or use Left and Right.'); gv.title = 'Drag to resize the Properties panel.';
        grip(gh, function (e) { return { y: e.clientY, h: dock.offsetHeight }; }, function (st, ev) { UI.folded = false; UI.dock = cl(st.h + (st.y - ev.clientY), 90, 1200, 260); });
        grip(gv, function (e) { return { x: e.clientX, w: propsEl ? propsEl.offsetWidth : UI.props }; }, function (st, ev) { UI.props = cl(st.w + (st.x - ev.clientX), 200, 520, 260); });
        gh.addEventListener('dblclick', fold);
        gh.addEventListener('keydown', function (e) {
            var d = e.shiftKey ? 96 : 24;
            if (e.key === 'ArrowUp') { UI.folded = false; UI.dock = cl(dock.offsetHeight + d, 90, 1200, 260); }
            else if (e.key === 'ArrowDown') { UI.folded = false; UI.dock = cl(dock.offsetHeight - d, 90, 1200, 260); }
            else if (e.key === 'Enter') { e.preventDefault(); return fold(); } else return;
            e.preventDefault(); applyUI(); saveUI();
        });
        gv.addEventListener('keydown', function (e) {
            var d = e.shiftKey ? 96 : 24;
            if (e.key === 'ArrowLeft') UI.props = cl(UI.props + d, 200, 520, 260); else if (e.key === 'ArrowRight') UI.props = cl(UI.props - d, 200, 520, 260); else return;
            e.preventDefault(); applyUI(); saveUI();
        });
        work.appendChild(gh); work.appendChild(gv); applyUI();
        window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(applyUI, 100); });
    }

    /* ---- Console: search, copy, export, error badge, and a hard cap on rows (an endless studio.log loop can no longer grow the page until it freezes) ---- */
    var logEl = $('stLog'), tabsEl = dock && dock.querySelector('.st-tabs'), clearBtn = $('stClear'), MAXROWS = 500;
    var query = '', errN = 0, logTab = tabsEl && tabsEl.querySelector('[data-tab="log"]'), badge = el('span', 'sx-badge'), ctl = el('span', 'sx-ctl'), qt = 0;
    function paintBadge() { badge.hidden = !errN; badge.textContent = errN > 99 ? '99+' : String(errN); badge.setAttribute('aria-label', errN + ' new error(s)'); }
    function consoleText() {
        return Array.prototype.filter.call(logEl.children, function (r) { return !r.hidden; }).map(function (r) {
            return Array.prototype.map.call(r.children, function (c) { return c.textContent; }).join('\t');
        }).join('\n');
    }
    function copyLog() {
        var t = consoleText(), n = t ? t.split('\n').length : 0; if (!n) return say('info', 'console', 'Nothing to copy');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { say('ok', 'console', 'Copied ' + n + ' line(s)'); }, function () { say('warn', 'console', 'The browser blocked copying. Use Export instead.'); });
        else say('warn', 'console', 'This browser cannot copy from here. Use Export instead.');
    }
    function exportLog() {
        var t = consoleText(); if (!t) return say('info', 'console', 'Nothing to export');
        try {
            var u = URL.createObjectURL(new Blob([t + '\n'], { type: 'text/plain' })), a = document.createElement('a');
            a.href = u; a.download = 'studio-console-' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.txt'; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(u); }, 2000); say('ok', 'console', 'Exported ' + t.split('\n').length + ' line(s)');
        } catch (e) { say('warn', 'console', 'Export failed: ' + String((e && e.message) || e).slice(0, 120)); }
    }
    if (logEl && tabsEl && clearBtn) {
        var q = el('input', 'sx-search'); q.type = 'search'; q.maxLength = 40; q.placeholder = 'Search'; q.setAttribute('aria-label', 'Search the console');
        q.addEventListener('input', function () {
            clearTimeout(qt); qt = setTimeout(function () {
                query = q.value.trim().toLowerCase();
                Array.prototype.forEach.call(logEl.children, function (r) { r.hidden = query ? r.textContent.toLowerCase().indexOf(query) < 0 : false; });
            }, 150);
        });
        var cb = el('button', 'st-link', 'Copy'), eb = el('button', 'st-link', 'Export'); cb.type = eb.type = 'button';
        cb.title = 'Copy the visible console lines'; eb.title = 'Download the visible console lines as a .txt file'; cb.addEventListener('click', copyLog); eb.addEventListener('click', exportLog);
        ctl.appendChild(q); ctl.appendChild(cb); ctl.appendChild(eb); tabsEl.insertBefore(ctl, clearBtn);
        Array.prototype.forEach.call(tabsEl.querySelectorAll('[data-tab]'), function (b) { b.addEventListener('click', function () { ctl.hidden = b.dataset.tab !== 'log'; }); });
        if (logTab) { logTab.appendChild(badge); logTab.addEventListener('click', function () { errN = 0; paintBadge(); }); paintBadge(); }
        new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                Array.prototype.forEach.call(m.addedNodes, function (r) {
                    if (r.nodeType !== 1) return; if (query) r.hidden = r.textContent.toLowerCase().indexOf(query) < 0;
                    if (r.classList.contains('error') && !(logTab && logTab.getAttribute('aria-selected') === 'true' && !dock.hidden)) { errN++; paintBadge(); }
                });
            });
            while (logEl.children.length > MAXROWS) logEl.removeChild(logEl.firstChild);
            if (!logEl.children.length && errN) { errN = 0; paintBadge(); }
        }).observe(logEl, { childList: true });
    }
    build(); syncAll();
})();
