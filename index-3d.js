/* ==========================================================================
   SPECSOFT® index-3d.js  -  real WebGL background (Three.js)

   A sparse constellation of points + connecting lines spans the whole page
   behind everything (same stacking spot as .grid-bg, see #bg3d in
   index-fx.css), plus one wireframe icosahedron drifting near the hero.
   The whole scene rotates slowly on its own and responds a little to the
   mouse and to scroll position — it never grabs input (pointer-events: none)
   and it never sits in front of content (z-index: 0).

   This degrades to literally nothing if: the Three.js script tag above it
   failed to load, the browser has no WebGL, or the person has reduced
   motion on — the page already has its flat 2D grid-bg as the real
   background, so this canvas is a pure bonus layer, never load-bearing.
   ========================================================================== */
(function () {
    'use strict';

    function reduceMotion() {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function supportsWebGL() {
        try {
            var c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
        } catch (e) { return false; }
    }

    function start() {
        if (reduceMotion() || !supportsWebGL() || typeof THREE === 'undefined') return;

        try {
            run();
        } catch (e) {
            // a WebGL/driver hiccup here should never take the rest of the page down
            var stray = document.getElementById('bg3d');
            if (stray) stray.remove();
        }
    }

    function run() {
        if (document.getElementById('bg3d')) return; // already running (e.g. loaded twice)

        var canvas = document.createElement('canvas');
        canvas.id = 'bg3d';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.insertBefore(canvas, document.body.firstChild);

        var isNarrow = window.innerWidth < 760;
        var PARTICLES = isNarrow ? 55 : 140;
        var LINK_DIST = isNarrow ? 85 : 115;

        var scene = new THREE.Scene();
        var camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 2000);
        camera.position.z = 420;

        var renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
        renderer.setSize(window.innerWidth, window.innerHeight);

        /* ---- the constellation: points + lines between nearby points ---- */
        var spread = { x: 720, y: 460, z: 480 };
        var positions = new Float32Array(PARTICLES * 3);
        for (var i = 0; i < PARTICLES; i++) {
            positions[i * 3]     = (Math.random() - 0.5) * spread.x;
            positions[i * 3 + 1] = (Math.random() - 0.5) * spread.y;
            positions[i * 3 + 2] = (Math.random() - 0.5) * spread.z;
        }

        var pointsGeo = new THREE.BufferGeometry();
        pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        var pointsMat = new THREE.PointsMaterial({
            color: 0xffffff, size: 2.3, transparent: true, opacity: 0.55, sizeAttenuation: true
        });
        var points = new THREE.Points(pointsGeo, pointsMat);

        var linePositions = [];
        for (var a = 0; a < PARTICLES; a++) {
            for (var b = a + 1; b < PARTICLES; b++) {
                var dx = positions[a * 3] - positions[b * 3];
                var dy = positions[a * 3 + 1] - positions[b * 3 + 1];
                var dz = positions[a * 3 + 2] - positions[b * 3 + 2];
                if (Math.sqrt(dx * dx + dy * dy + dz * dz) < LINK_DIST) {
                    linePositions.push(positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]);
                    linePositions.push(positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]);
                }
            }
        }
        var lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePositions), 3));
        var lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 });
        var lines = new THREE.LineSegments(lineGeo, lineMat);

        var field = new THREE.Group();
        field.add(points);
        field.add(lines);
        scene.add(field);

        /* ---- the core: one wireframe icosahedron drifting near the hero ---- */
        var core = null;
        if (window.innerWidth > 980) {
            var coreGeo = new THREE.IcosahedronGeometry(85, 1);
            var coreMat = new THREE.MeshBasicMaterial({
                color: 0xffffff, wireframe: true, transparent: true, opacity: 0.14
            });
            core = new THREE.Mesh(coreGeo, coreMat);
            core.position.set(240, 30, -130);
            scene.add(core);
        }

        /* ---- pointer + scroll drive a gentle parallax, nothing jarring ---- */
        var mouseX = 0, mouseY = 0;
        function onMouseMove(e) {
            mouseX = (e.clientX / window.innerWidth) - 0.5;
            mouseY = (e.clientY / window.innerHeight) - 0.5;
        }
        window.addEventListener('mousemove', onMouseMove, { passive: true });

        var scrollFrac = 0;
        function onScroll() {
            var max = document.documentElement.scrollHeight - window.innerHeight;
            scrollFrac = max > 0 ? Math.min(1, window.scrollY / max) : 0;
        }
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        function onResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
        window.addEventListener('resize', onResize);

        /* ---- render loop, paused while the tab is hidden ---- */
        var running = true;
        document.addEventListener('visibilitychange', function () {
            var wasRunning = running;
            running = !document.hidden;
            if (running && !wasRunning) requestAnimationFrame(tick);
        });

        var clock = new THREE.Clock();
        function tick() {
            if (!running) return;
            var t = clock.getElapsedTime();

            field.rotation.y = t * 0.025 + mouseX * 0.3;
            field.rotation.x = t * 0.01 + mouseY * 0.15;
            field.position.y = -scrollFrac * 130;

            if (core) {
                core.rotation.y = t * 0.12;
                core.rotation.x = t * 0.08;
            }

            renderer.render(scene, camera);
            requestAnimationFrame(tick);
        }
        tick();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();