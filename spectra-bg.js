/* SPECSOFT® Spectra AI: Three.js background, monochrome hairline grid.
   Matches the homepage fx look (white on black, very low opacity). ONE full-screen shader quad:
   a 1px hairline grid that fades toward the edges + a soft cursor spotlight that brightens nearby lines.
   Optimized: 1 draw call, nothing runs while idle (it only renders on resize / cursor movement, and stops once the glow settles),
   no antialias/depth buffer, DPR cap, CSS-grid fallback if WebGL or Three.js is unavailable. */
(function () {
'use strict';
const cv = document.getElementById('saBg'), app = document.getElementById('saApp');
if (!cv || !app) return;
const fallback = () => { cv.remove(); app.classList.add('sa-cssgrid'); };
if (!window.THREE) return fallback();
const T = window.THREE;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('ss-reduce-motion') || document.body.classList.contains('ss-reduce-motion');
const touch = matchMedia('(hover: none)').matches;

let renderer;
try { renderer = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' }); }
catch (e) { return fallback(); }
renderer.setClearColor(0x000000, 0);

const VERT = `varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FRAG = `uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uSpot;
uniform float uCell;
uniform float uPx;
uniform vec3 uColor;
varying vec2 vUv;
void main(){
  vec2 p = vUv * uRes;
  vec2 f = abs(fract(p / uCell - 0.5) - 0.5) * uCell;
  float line = 1.0 - smoothstep(0.0, uPx * 0.9, min(f.x, f.y));
  vec2 c = (vUv - vec2(0.6, 0.48)) * vec2(uRes.x / uRes.y, 1.0);
  float vig = smoothstep(1.0, 0.1, length(c));
  float md = length(p - uMouse) / (uCell * 5.0);
  float spot = exp(-md * md) * uSpot;
  gl_FragColor = vec4(uColor, line * (0.085 * vig + 0.24 * spot));
}`;

const col = new T.Color((getComputedStyle(document.body).getPropertyValue('--sa-acc').trim()) || '#ececec');
const U = { uRes: { value: new T.Vector2(1, 1) }, uMouse: { value: new T.Vector2(-9999, -9999) }, uSpot: { value: 0 }, uCell: { value: 44 }, uPx: { value: 1 }, uColor: { value: col } };
const scene = new T.Scene(), cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new T.Mesh(new T.PlaneGeometry(2, 2), new T.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: U, transparent: true, depthTest: false, depthWrite: false }));
quad.frustumCulled = false; scene.add(quad);
const draw = () => renderer.render(scene, cam);

function size() {
  const w = app.clientWidth || innerWidth, h = app.clientHeight || innerHeight, dpr = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr); renderer.setSize(w, h, false);
  U.uRes.value.set(w, h); U.uPx.value = 1 / dpr; U.uCell.value = w < 850 ? 32 : 44; draw();
}

/* cursor spotlight (desktop). Renders only while the glow is moving / fading. */
let tx = -9999, ty = -9999, want = 0, raf = 0, last = 0;
function tick(ts) {
  const dt = Math.min((ts - last) / 1000, .05); last = ts;
  const m = U.uMouse.value, k = Math.min(dt * 9, 1);
  m.x += (tx - m.x) * k; m.y += (ty - m.y) * k; U.uSpot.value += (want - U.uSpot.value) * Math.min(dt * 6, 1);
  draw();
  const moving = Math.abs(tx - m.x) + Math.abs(ty - m.y) > .5 || Math.abs(want - U.uSpot.value) > .01;
  raf = moving ? requestAnimationFrame(tick) : 0;
}
function kick() {
  if (reduce) { U.uMouse.value.set(tx, ty); U.uSpot.value = want; if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); return; }
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
}
if (!touch) {
  addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(); tx = e.clientX - r.left; ty = r.height - (e.clientY - r.top); want = 1;
    if (U.uMouse.value.x < -999) U.uMouse.value.set(tx, ty); kick();
  }, { passive: true });
  document.addEventListener('mouseleave', () => { want = 0; kick(); });
}
new ResizeObserver(size).observe(app);
addEventListener('pagehide', () => { cancelAnimationFrame(raf); renderer.dispose(); });
size();
})();
