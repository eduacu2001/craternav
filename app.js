/* CraterNav results page: flight replay, globe, and the four live method demos. */
"use strict";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const tok = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
function getImage(url) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error(url));
    i.src = url;
  });
}
function fmtM(m) {
  if (m >= 10000) return `${(m / 1000).toFixed(0)} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}
function clock(t) {
  return `${Math.floor(t / 3600)} h ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")} min`;
}
function latText(lat) {
  return `${Math.abs(lat).toFixed(0)}° ${lat >= 0 ? "N" : "S"}`;
}
/* size a canvas to its CSS box (height given in CSS px, or square) and return a 2-D context */
function fit(canvas, cssHeight) {
  const w = canvas.clientWidth;
  const h = cssHeight ?? w;
  if (cssHeight) canvas.style.height = `${h}px`;
  const d = DPR();
  canvas.width = Math.round(w * d);
  canvas.height = Math.round(h * d);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, w, h };
}
function circle(ctx, x, y, r, color, width, dash) {
  ctx.beginPath();
  ctx.setLineDash(dash || []);
  ctx.arc(x, y, Math.max(r, 1.5), 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
}
function onThemeChange(fn) {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fn);
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}
function onResize(el, fn) {
  let w = el.clientWidth;
  new ResizeObserver(() => {
    if (el.clientWidth !== w) { w = el.clientWidth; fn(); }
  }).observe(el);
}

/* ------------------------------------------------------------------ globe */

class Globe {
  constructor(el, texture, F, onFollowChange) {
    this.el = el;
    this.F = F;
    this.N = F.t.length;
    this.follow = true;
    this.raf = 0;
    this.animate = this.animate.bind(this);
    this.onFollowChange = onFollowChange;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    r.setPixelRatio(DPR());
    r.setClearColor(0x000000, 0);
    el.prepend(r.domElement);
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    const tex = new THREE.Texture(texture);
    tex.anisotropy = r.capabilities.getMaxAnisotropy();
    tex.needsUpdate = true;
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), new THREE.MeshBasicMaterial({ map: tex })));

    const R = 1 + F.alt_km / 1737.4;
    this.pos = F.lat.map((la, i) => Globe.vec(la, F.lon[i], R));
    this.ground = F.lat.map((la, i) => Globe.vec(la, F.lon[i], 1.002));
    const trackGeo = new THREE.BufferGeometry().setFromPoints(this.pos);
    this.scene.add(new THREE.Line(trackGeo, new THREE.LineBasicMaterial({ color: 0x8796a0, transparent: true, opacity: 0.28 })));

    // flown orbit, coloured by what the camera was doing
    const teal = new THREE.Color(0x36d3c1), amber = new THREE.Color(0xf39a3e), grey = new THREE.Color(0x5d6a72);
    const cols = [];
    for (let i = 0; i < this.N; i++) {
      const c = F.frame[i] < 0 ? grey : F.used[i] > 0 ? teal : amber;
      cols.push(c.r, c.g, c.b);
    }
    const flownGeo = new THREE.BufferGeometry().setFromPoints(this.pos);
    flownGeo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    this.flown = new THREE.Line(flownGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.scene.add(this.flown);

    // ground track where craters were identified
    const used = [];
    for (let i = 0; i < this.N; i++) if (F.used[i] > 0) used.push(i);
    this.usedIdx = used;
    const gpGeo = new THREE.BufferGeometry().setFromPoints(used.map((i) => this.ground[i]));
    this.groundPts = new THREE.Points(gpGeo, new THREE.PointsMaterial({ color: 0x36d3c1, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.85 }));
    this.scene.add(this.groundPts);

    // spacecraft, its nadir line and the camera footprint
    this.sc = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf39a3e }));
    this.scene.add(this.sc);
    this.halo = new THREE.Mesh(new THREE.RingGeometry(0.024, 0.03, 32), new THREE.MeshBasicMaterial({ color: 0xf39a3e, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    this.scene.add(this.halo);
    this.nadir = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xf39a3e, transparent: true, opacity: 0.7 }));
    this.scene.add(this.nadir);
    this.foot = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([0, 1, 2, 3].map(() => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0x36d3c1 }));
    this.scene.add(this.foot);

    this.view = { az: 0, el: 20, dist: 4.4 };
    this.target = { ...this.view };
    this.i = 0;
    this.bindDrag();
    this.resize();
    onResize(el, () => this.resize());
  }
  static vec(lat, lon, r) {
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    return new THREE.Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
  }
  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight || w;
    this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.kick();
  }
  bindDrag() {
    const c = this.renderer.domElement;
    let last = null;
    c.addEventListener("pointerdown", (e) => { last = [e.clientX, e.clientY]; c.setPointerCapture(e.pointerId); });
    c.addEventListener("pointermove", (e) => {
      if (!last) return;
      const dx = e.clientX - last[0], dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      if (this.follow) { this.follow = false; this.onFollowChange(false); }
      const k = 140 / this.el.clientWidth;
      this.target.az -= dx * k;
      this.target.el = clamp(this.target.el + dy * k, -80, 80);
      this.view.az = this.target.az;
      this.view.el = this.target.el;
      this.kick();
    });
    const up = () => { last = null; };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.target.dist = this.view.dist = clamp(this.view.dist * (1 + Math.sign(e.deltaY) * 0.08), 2.2, 7);
      this.kick();
    }, { passive: false });
  }
  setFollow(on) {
    this.follow = on;
    this.setIndex(this.i);
  }
  setIndex(i) {
    this.i = i;
    const p = this.pos[i];
    this.sc.position.copy(p);
    this.halo.position.copy(p);
    this.halo.lookAt(p.clone().multiplyScalar(2));
    const g = this.ground[i];
    this.nadir.geometry.setFromPoints([p, g]);
    // camera footprint: 83 km square, oriented along the direction of flight
    const j = Math.min(i + 1, this.N - 1), k = Math.max(i - 1, 0);
    const fwd = this.ground[j].clone().sub(this.ground[k]).normalize();
    const up = g.clone().normalize();
    const side = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const h = 0.0239;
    const day = this.F.frame[i] >= 0;
    this.foot.visible = day;
    if (day) {
      this.foot.geometry.setFromPoints([[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) =>
        g.clone().add(fwd.clone().multiplyScalar(a * h)).add(side.clone().multiplyScalar(b * h)).normalize().multiplyScalar(1.003)));
    }
    this.flown.geometry.setDrawRange(0, i + 1);
    let n = 0;
    while (n < this.usedIdx.length && this.usedIdx[n] <= i) n++;
    this.groundPts.geometry.setDrawRange(0, n);
    if (this.follow) {
      const lat = this.F.lat[i], lon = this.F.lon[i];
      this.target.az = Globe.unwrap(this.view.az, lon - 32);
      this.target.el = clamp(lat * 0.8, -62, 62);
    }
    this.kick();
  }
  static unwrap(from, to) {
    let d = ((to - from + 540) % 360) - 180;
    return from + d;
  }
  kick() {
    if (!this.raf) this.raf = requestAnimationFrame(this.animate);
  }
  animate() {
    this.raf = 0;
    const v = this.view, t = this.target;
    const a = reduceMotion ? 1 : 0.12;
    v.az += (t.az - v.az) * a;
    v.el += (t.el - v.el) * a;
    v.dist += (t.dist - v.dist) * a;
    const p = Globe.vec(v.el, v.az, v.dist);
    this.cam.position.copy(p);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.cam);
    if (Math.abs(t.az - v.az) + Math.abs(t.el - v.el) + Math.abs(t.dist - v.dist) > 0.01) this.kick();
  }
}

/* ------------------------------------------------------------------ camera feed */

class Feed {
  constructor(canvas, atlases, FR) {
    this.c = canvas;
    this.atlases = atlases;
    this.FR = FR;
    this.layers = { found: true, ident: true, pred: false };
    this.resize();
    onResize(canvas, () => { this.resize(); this.draw(this.i ?? 0); });
  }
  resize() {
    Object.assign(this, fit(this.c));
  }
  drawFrame(ctx, k, size) {
    const per = this.FR.per_atlas, cols = this.FR.cols, s = this.FR.size;
    const a = this.atlases[Math.floor(k / per)], j = k % per;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(a, (j % cols) * s, Math.floor(j / cols) * s, s, s, 0, 0, size, size);
  }
  draw(i, k) {
    this.i = i;
    const { ctx, w } = this;
    ctx.fillStyle = tok("--scope");
    ctx.fillRect(0, 0, w, w);
    if (k < 0) return;
    this.drawFrame(ctx, k, w);
    const f = this.FR.frames[k], s = w / this.FR.size;
    const hit = new Set(f.pairs.map((p) => p[0]));
    const amber = tok("--amber-lit"), teal = tok("--teal-lit");
    if (this.layers.pred) for (const [u, v, r] of f.pred) circle(ctx, u * s, v * s, r * s, teal, 1.4, [5, 4]);
    f.det.forEach(([u, v, r], j) => {
      if (hit.has(j) && this.layers.ident) circle(ctx, u * s, v * s, r * s, teal, 2.6);
      else if (this.layers.found) circle(ctx, u * s, v * s, r * s, amber, 1.6);
    });
  }
}

/* ------------------------------------------------------------------ replay chart */

class ErrorChart {
  constructor(canvas, F, onSeek) {
    this.c = canvas;
    this.F = F;
    this.onSeek = onSeek;
    this.hours = F.t.map((t) => t / 3600);
    this.static = document.createElement("canvas");
    this.resize();
    onResize(canvas, () => { this.resize(); this.draw(this.i ?? 0); });
    onThemeChange(() => { this.drawStatic(); this.draw(this.i ?? 0); });
    let down = false;
    const seek = (e) => {
      const rect = canvas.getBoundingClientRect();
      const h = this.x.invert(e.clientX - rect.left);
      let best = 0, bd = 1e9;
      this.hours.forEach((v, j) => { const d = Math.abs(v - h); if (d < bd) { bd = d; best = j; } });
      onSeek(best);
    };
    canvas.addEventListener("pointerdown", (e) => { down = true; canvas.setPointerCapture(e.pointerId); seek(e); });
    canvas.addEventListener("pointermove", (e) => { if (down) seek(e); });
    canvas.addEventListener("pointerup", () => { down = false; });
  }
  resize() {
    const h = this.c.clientWidth < 600 ? 180 : 230;
    Object.assign(this, fit(this.c, h));
    this.m = { l: 58, r: 14, t: 12, b: 28 };
    const { l, r, t, b } = this.m, H = this.hours[this.hours.length - 1];
    const x = (v) => l + (v / H) * (this.w - l - r);
    x.invert = (px) => ((px - l) / (this.w - l - r)) * H;
    const y = (m) => t + (1 - (Math.log10(clamp(m, 10, 1e5)) - 1) / 4) * (this.h - t - b);
    this.x = x;
    this.y = y;
    this.drawStatic();
  }
  drawStatic() {
    const d = DPR();
    this.static.width = this.c.width;
    this.static.height = this.c.height;
    const ctx = this.static.getContext("2d");
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const { x, y, F, hours } = this;
    const { l, r, t, b } = this.m;
    ctx.font = `500 11px ${tok("--ui")}`;
    // night
    ctx.fillStyle = tok("--night");
    let s = null;
    for (let i = 0; i <= hours.length; i++) {
      const night = i < hours.length && F.frame[i] < 0;
      if (night && s === null) s = hours[i];
      if (!night && s !== null) { ctx.fillRect(x(s), t, x(hours[i - 1]) - x(s), this.h - t - b); s = null; }
    }
    // grid
    ctx.strokeStyle = tok("--rule");
    ctx.fillStyle = tok("--ink-soft");
    ctx.lineWidth = 1;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const [m, lab] of [[10, "10 m"], [100, "100 m"], [1e3, "1 km"], [1e4, "10 km"], [1e5, "100 km"]]) {
      ctx.beginPath(); ctx.moveTo(l, y(m)); ctx.lineTo(this.w - r, y(m)); ctx.stroke();
      ctx.fillText(lab, l - 8, y(m));
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (let hh = 0; hh <= 6; hh++) if (hh <= hours[hours.length - 1] + 0.01) ctx.fillText(`${hh} h`, x(hh), this.h - b + 8);
    const line = (vals, color, wdt) => {
      ctx.beginPath();
      vals.forEach((v, i) => (i ? ctx.lineTo(x(hours[i]), y(v)) : ctx.moveTo(x(hours[i]), y(v))));
      ctx.strokeStyle = color; ctx.lineWidth = wdt; ctx.stroke();
    };
    line(F.err_dr, tok("--drift"), 1.8);
    line(F.err, tok("--amber"), 2);
  }
  draw(i) {
    this.i = i;
    const { ctx, x, y, F, hours } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.drawImage(this.static, 0, 0, this.w, this.h);
    ctx.strokeStyle = tok("--ink");
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(hours[i]), this.m.t); ctx.lineTo(x(hours[i]), this.h - this.m.b); ctx.stroke();
    for (const [v, c] of [[F.err_dr[i], tok("--drift")], [F.err[i], tok("--amber")]]) {
      ctx.beginPath(); ctx.arc(x(hours[i]), y(v), 4.5, 0, Math.PI * 2);
      ctx.fillStyle = c; ctx.fill();
      ctx.strokeStyle = tok("--sheet"); ctx.lineWidth = 2; ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------------ replay */

function replay(F, FR, globe, feed, chart) {
  const N = F.t.length;
  const scrub = $("#scrub"), play = $("#play");
  scrub.max = N - 1;
  // open on a busy daylight image after the filter has settled
  let start = 0, best = -1;
  for (let i = 0; i < N; i++) if (F.t[i] > 5600 && F.t[i] < 7300 && F.used[i] > best) { best = F.used[i]; start = i; }
  const st = { i: start, playing: false, speed: 1, acc: 0, last: 0 };

  // the slider shows day and night
  const stops = [];
  for (let i = 0; i < N; i++) {
    const night = F.frame[i] < 0;
    if (i === 0 || night !== (F.frame[i - 1] < 0)) stops.push(`${night ? "var(--rule)" : "var(--sheet)"} ${(i / (N - 1)) * 100}%`);
  }

  function set(i) {
    st.i = clamp(i, 0, N - 1);
    const k = F.frame[st.i];
    scrub.value = st.i;
    feed.draw(st.i, k);
    $("#feed-night").hidden = k >= 0;
    $("#feed-tag").textContent = k >= 0 ? `Onboard camera · ${latText(F.lat[st.i])}` : "Onboard camera";
    globe.setIndex(st.i);
    chart.draw(st.i);
    $("#ro-time").textContent = clock(F.t[st.i]);
    $("#ro-sun").textContent = F.sun_el[st.i] > 0 ? `${F.sun_el[st.i].toFixed(0)}°` : "below";
    $("#ro-craters").textContent = k >= 0 ? `${F.n_det[st.i]} / ${F.used[st.i]}` : "–";
    $("#ro-err").textContent = fmtM(F.err[st.i]);
    $("#ro-dr").textContent = fmtM(F.err_dr[st.i]);
  }
  function tick(ts) {
    if (!st.playing) return;
    const dt = st.last ? Math.min((ts - st.last) / 1000, 0.1) : 0;
    st.last = ts;
    const rate = (F.frame[st.i] >= 0 ? 6 : 30) * st.speed;
    st.acc += dt * rate;
    if (st.acc >= 1) {
      const n = Math.floor(st.acc);
      st.acc -= n;
      if (st.i + n >= N - 1) { set(N - 1); stop(); return; }
      set(st.i + n);
    }
    requestAnimationFrame(tick);
  }
  function stop() {
    st.playing = false;
    play.textContent = st.i >= N - 1 ? "Replay" : "Play";
  }
  play.addEventListener("click", () => {
    if (st.playing) return stop();
    if (st.i >= N - 1) set(0);
    st.playing = true;
    st.last = 0;
    play.textContent = "Pause";
    requestAnimationFrame(tick);
  });
  scrub.addEventListener("input", () => set(+scrub.value));
  $$(".transport .seg button").forEach((b) => b.addEventListener("click", () => {
    st.speed = +b.dataset.speed;
    $$(".transport .seg button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
  }));
  for (const [id, key] of [["#lay-found", "found"], ["#lay-ident", "ident"], ["#lay-pred", "pred"]]) {
    $(id).addEventListener("change", (e) => { feed.layers[key] = e.target.checked; set(st.i); });
  }
  const followBtn = $("#follow");
  globe.onFollowChange = (on) => { followBtn.hidden = on; };
  followBtn.addEventListener("click", () => { followBtn.hidden = true; globe.setFollow(true); });
  chart.onSeek = (i) => set(i);
  set(start);
  return set;
}

/* ------------------------------------------------------------------ 1 · lighting demo */

/* A heightfield (metres, row-major) seen from straight above: lunar-Lambert shading and cast
   shadows for a Sun at (elevation, azimuth from north through east). Columns point east and
   rows south. With ``sphere`` the heights are above the Moon's sphere, so a sunbeam also rises
   by d^2 / 2R over a distance d. */
function shade(G, r0, size, scale, el, az, shadows) {
  const { H, cols, rows, px, sphere, rowMax } = G;
  const m = Math.round(size / scale);
  const img = new ImageData(m, m);
  const L = 0.5, sz = Math.sin(el), sx = Math.sin(az) * Math.cos(el), sy = Math.cos(az) * Math.cos(el);
  const flat = (2 * L * sz) / (sz + 1) + (1 - L) * sz;
  const rise = Math.tan(el) * px, bend = sphere ? (px * px) / (2 * 1737400) : 0;
  const dc = Math.sin(az), dr = -Math.cos(az);
  let hmax = -1e9;
  for (let r = Math.max(0, r0 - 250); r < Math.min(rows, r0 + size + 250); r++) hmax = Math.max(hmax, rowMax[r]);
  const at = (r, c) => H[clamp(r, 0, rows - 1) * cols + clamp(c, 0, cols - 1)];
  for (let rr = 0; rr < m; rr++) for (let cc = 0; cc < m; cc++) {
    const r = Math.min(rows - 1, r0 + Math.round(rr * scale)), c = Math.min(cols - 1, Math.round(cc * scale));
    const de = (at(r, c + 1) - at(r, c - 1)) / (2 * px), dn = (at(r - 1, c) - at(r + 1, c)) / (2 * px);
    const l = Math.hypot(de, dn, 1);
    const nx = -de / l, ny = -dn / l, nz = 1 / l;
    const ci = nx * sx + ny * sy + nz * sz;
    let b = 0;
    if (ci > 0 && el > 0) {
      b = (2 * L * ci) / (ci + nz) + (1 - L) * ci;
      if (shadows) {
        const h0 = H[r * cols + c] + 3;
        for (let k = 1; ; k++) {
          const ray = h0 + k * rise + k * k * bend;
          if (ray > hmax) break;
          const rf = r + dr * k, cf = c + dc * k;
          if (rf < 0 || rf > rows - 2 || cf < 0 || cf > cols - 2) break;
          const a = rf | 0, q = cf | 0, fr = rf - a, fc = cf - q, o = a * cols + q;
          const hk = (1 - fr) * ((1 - fc) * H[o] + fc * H[o + 1]) + fr * ((1 - fc) * H[o + cols] + fc * H[o + cols + 1]);
          if (hk > ray) { b = 0; break; }
        }
      }
    }
    const g = 255 * Math.pow(clamp((b / Math.max(flat, 0.02)) * 0.42, 0, 1), 1 / 1.6);
    const o = 4 * (rr * m + cc);
    img.data[o] = g; img.data[o + 1] = g; img.data[o + 2] = g * 1.01; img.data[o + 3] = 255;
  }
  return img;
}
function withRowMax(G) {
  G.rowMax = new Float32Array(G.rows);
  for (let r = 0; r < G.rows; r++) {
    let mx = -1e9;
    for (let c = 0; c < G.cols; c++) mx = Math.max(mx, G.H[r * G.cols + c]);
    G.rowMax[r] = mx;
  }
  return G;
}
/* elevation and azimuth (rad) of the run's Sun, seen from (lat, lon) */
function flightSun(lat, lon, sunLon) {
  const d = Math.PI / 180, la = lat * d, lo = lon * d, sl = sunLon * d;
  const s = [Math.cos(sl), Math.sin(sl), 0];
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return { el: Math.asin(dot(s, up)), az: Math.atan2(dot(s, east), dot(s, north)) };
}

function lighting(T, stripPromise, moon, sunLon) {
  // Tycho: a tangent-plane tile; the orbit: a band along the ground track, loaded once
  const n = T.size, raw = atob(T.heights);
  const tycho = { H: new Float32Array(n * n), cols: n, rows: n, px: T.pixel_m, sphere: false,
                  lat: T.center[0], lon: T.center[1], view: n, craters: T.craters };
  for (let i = 0; i < n * n; i++) {
    let v = raw.charCodeAt(2 * i) | (raw.charCodeAt(2 * i + 1) << 8);
    if (v > 32767) v -= 65536;
    tycho.H[i] = v;
  }
  withRowMax(tycho);
  let strip = null;
  let place = "orbit", lat = -55.3, flying = false, pending = 0;

  const canvas = $("#tycho"), loc = $("#locator");
  let view = fit(canvas);
  const off = document.createElement("canvas");
  const sunEl = $("#sun-el"), sunAz = $("#sun-az"), pos = $("#pos"), fly = $("#fly"), useFlight = $("#sun-flight");

  // an orthographic picture of the near side, made once per size from the globe's texture
  const discs = {};
  function nearSide(size) {
    if (discs[size]) return discs[size];
    const src = document.createElement("canvas");
    src.width = 512; src.height = 256;
    const sg = src.getContext("2d");
    sg.drawImage(moon, 0, 0, 512, 256);
    const tex = sg.getImageData(0, 0, 512, 256).data;
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d"), out = g.createImageData(size, size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const X = (2 * (i + 0.5)) / size - 1, Y = 1 - (2 * (j + 0.5)) / size, R2 = X * X + Y * Y;
      if (R2 > 1) continue;
      const Z = Math.sqrt(1 - R2), la = Math.asin(Y), lo = Math.atan2(X, Z);
      const u = Math.min(511, Math.floor(((lo / Math.PI + 1) / 2) * 512)), v = Math.min(255, Math.floor((0.5 - la / Math.PI) * 256));
      const k = 4 * (v * 512 + u), o = 4 * (j * size + i);
      out.data[o] = tex[k]; out.data[o + 1] = tex[k + 1]; out.data[o + 2] = tex[k + 2]; out.data[o + 3] = 255;
    }
    g.putImageData(out, 0, 0);
    return (discs[size] = c);
  }

  const G = () => (place === "orbit" ? strip : tycho);
  const rowOf = (la) => Math.round(((strip.latMax - la) * Math.PI / 180) * 1737400 / strip.px);
  const window0 = () => (place === "orbit" ? clamp(rowOf(lat) - strip.view / 2, 0, strip.rows - strip.view) : 0);
  const here = () => (place === "orbit" ? [lat, strip.lon] : [tycho.lat, tycho.lon]);

  function sun() {
    if (useFlight.checked) {
      const [la, lo] = here(), s = flightSun(la, lo, sunLon);
      sunEl.value = Math.round((s.el * 180) / Math.PI);
      sunAz.value = Math.round(((s.az * 180) / Math.PI + 360) % 360);
      return s;
    }
    return { el: (+sunEl.value * Math.PI) / 180, az: (+sunAz.value * Math.PI) / 180 };
  }
  function labels() {
    sunEl.disabled = sunAz.disabled = useFlight.checked;
    $("#sun-el-v").textContent = `${sunEl.value}°`;
    $("#sun-az-v").textContent = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(+sunAz.value / 45) % 8];
    $("#pos-v").textContent = latText(lat);
    $("#pos-row").hidden = $("#fly-row").querySelector("#fly").hidden = place !== "orbit";
    $("#ty-hint").hidden = place !== "orbit";
    const [la, lo] = here(), km = Math.round((G().view * G().px) / 1000);
    $("#ty-tag").textContent = place === "orbit"
      ? `Under the orbit, ${Math.abs(la).toFixed(1)}° ${la >= 0 ? "N" : "S"} ${Math.abs(lo).toFixed(0)}° W · ${km} km across`
      : `Tycho, 43.3° S 11.4° W · ${km} km across`;
    $$("#ty-place button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.place === place)));
  }
  function render(scale) {
    const g = G();
    if (!g) return;
    const s = sun();
    labels();
    const img = shade(g, window0(), g.view, scale, s.el, s.az, $("#ty-shadow").checked);
    off.width = img.width; off.height = img.height;
    off.getContext("2d").putImageData(img, 0, 0);
    draw();
  }
  function draw() {
    const g = G();
    if (!g) return;
    const { ctx, w } = view, sc = w / g.view, r0 = window0();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, w, w);
    if ($("#ty-cat").checked) {
      const teal = tok("--teal-lit");
      if (place === "tycho") for (const [x, y, r, deep] of g.craters) circle(ctx, x * sc, y * sc, r * sc, teal, deep ? 1.8 : 1, deep ? [] : [3, 3]);
      else for (let k = 0; k < g.deep.length; k++) {
        const y = g.craters[3 * k] - r0, x = g.craters[3 * k + 1], r = g.craters[3 * k + 2];
        if (y + r < 0 || y - r > g.view) continue;
        circle(ctx, x * sc, y * sc, r * sc, teal, g.deep[k] ? 1.8 : 1, g.deep[k] ? [] : [3, 3]);
      }
    }
    // where on the Moon: the near side, seen from straight above 0 N 0 E
    const lc = loc.getContext("2d"), d = DPR(), side = loc.clientWidth;
    if (loc.width !== Math.round(side * d)) { loc.width = loc.height = Math.round(side * d); }
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.drawImage(nearSide(loc.width), 0, 0);
    lc.setTransform(d, 0, 0, d, 0, 0);
    const proj = (la, lo) => {
      const a = (la * Math.PI) / 180, b = (lo * Math.PI) / 180;
      return [side / 2 + (side / 2) * Math.cos(a) * Math.sin(b), side / 2 - (side / 2) * Math.sin(a)];
    };
    const [la, lo] = here();
    if (place === "orbit") {
      lc.strokeStyle = "rgba(54, 211, 193, 0.85)"; lc.lineWidth = 1.2;
      lc.beginPath();
      for (let q = -strip.latMax; q <= strip.latMax; q += 2) { const [x, y] = proj(q, lo); q === -strip.latMax ? lc.moveTo(x, y) : lc.lineTo(x, y); }
      lc.stroke();
    }
    const [x, y] = proj(la, lo);
    lc.fillStyle = tok("--amber-lit");
    lc.beginPath(); lc.arc(x, y, 3.5, 0, 7); lc.fill();
  }
  function update(quick) {
    if (quick) {
      render(2);
      clearTimeout(pending);
      pending = setTimeout(() => render(1), 160);
    } else render(1);
  }
  function step() {
    if (!flying) return;
    lat = Math.min(strip.latMax, lat + 0.09);
    pos.value = lat;
    render(2);
    if (lat >= strip.latMax) return stop();
    requestAnimationFrame(step);
  }
  function stop() {
    flying = false;
    fly.textContent = "Fly north";
    render(1);
  }
  fly.addEventListener("click", () => {
    if (flying) return stop();
    if (lat >= strip.latMax - 0.5) lat = -strip.latMax;
    flying = true;
    fly.textContent = "Stop";
    requestAnimationFrame(step);
  });
  pos.addEventListener("input", () => { lat = +pos.value; update(true); });
  for (const el of [sunEl, sunAz]) el.addEventListener("input", () => update(true));
  useFlight.addEventListener("change", () => update(false));
  $("#ty-shadow").addEventListener("change", () => update(false));
  $("#ty-cat").addEventListener("change", draw);
  $$("#ty-place button").forEach((b) => b.addEventListener("click", () => {
    if (!strip && b.dataset.place === "orbit") return;
    if (flying) stop();
    place = b.dataset.place;
    update(false);
  }));
  // drag the image up or down to move along the orbit
  let drag = null;
  canvas.addEventListener("pointerdown", (e) => { if (place === "orbit") { drag = e.clientY; canvas.setPointerCapture(e.pointerId); } });
  canvas.addEventListener("pointermove", (e) => {
    if (drag === null) return;
    const rowsPerPx = strip.view / canvas.clientWidth;
    lat = clamp(lat + ((e.clientY - drag) * rowsPerPx * strip.px * 180) / (Math.PI * 1737400), -strip.latMax, strip.latMax);
    drag = e.clientY;
    pos.value = lat;
    update(true);
  });
  canvas.addEventListener("pointerup", () => { drag = null; });
  onResize(canvas, () => { view = fit(canvas); draw(); });

  stripPromise.then(({ meta, image }) => {
    const c = document.createElement("canvas");
    c.width = meta.cols; c.height = meta.rows;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(image, 0, 0);
    const px = g.getImageData(0, 0, meta.cols, meta.rows).data;
    const H = new Float32Array(meta.cols * meta.rows);
    for (let i = 0; i < H.length; i++) H[i] = (((px[4 * i] << 8) | px[4 * i + 1]) - 32768) * meta.step_m;
    strip = withRowMax({ H, cols: meta.cols, rows: meta.rows, px: meta.pixel_m, sphere: true, view: meta.cols,
                         lon: meta.lon, latMax: meta.lat_max, craters: meta.craters, deep: meta.deep });
    $("#ty-loading").hidden = true;
    if (place === "orbit") update(false);
  }).catch(() => {
    $("#ty-loading").textContent = "The terrain under the orbit did not load. Tycho is shown instead.";
    place = "tycho";
    update(false);
  });
}

/* ------------------------------------------------------------------ 2 · detector */

function detector(D, strip, rims) {
  const canvas = $("#det");
  let view = fit(canvas);
  let ex = 1, mode = "found";
  // rim probability as an amber overlay, one per example
  const overlays = D.examples.map((_, k) => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    g.drawImage(rims, k * 256, 0, 256, 256, 0, 0, 256, 256);
    const id = g.getImageData(0, 0, 256, 256);
    for (let i = 0; i < id.data.length; i += 4) {
      const p = id.data[i] / 255;
      id.data[i] = 243; id.data[i + 1] = 154; id.data[i + 2] = 62; id.data[i + 3] = Math.round(255 * Math.min(1, p * 1.3));
    }
    g.putImageData(id, 0, 0);
    return c;
  });
  const thumbs = $("#det-thumbs");
  D.examples.forEach((e, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.style.backgroundImage = "url(data/detector_images.png)";
    b.style.backgroundSize = `${D.examples.length * 100}% 100%`;
    b.style.backgroundPosition = `${(k / (D.examples.length - 1)) * 100}% 0`;
    b.setAttribute("aria-label", `Example ${k + 1}, sun ${e.sun_el}° above the horizon`);
    b.addEventListener("click", () => { ex = k; draw(); });
    thumbs.appendChild(b);
  });
  $$("#det-mode button").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; draw(); }));
  onResize(canvas, () => { view = fit(canvas); draw(); });

  function draw() {
    const { ctx, w } = view, s = w / 256, e = D.examples[ex];
    $$("#det-thumbs button").forEach((b, k) => b.setAttribute("aria-pressed", String(k === ex)));
    $$("#det-mode button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    ctx.fillStyle = tok("--scope");
    ctx.fillRect(0, 0, w, w);
    ctx.globalAlpha = mode === "rims" ? 0.35 : 1;
    ctx.drawImage(strip, ex * 256, 0, 256, 256, 0, 0, w, w);
    ctx.globalAlpha = 1;
    const amber = tok("--amber-lit"), teal = tok("--teal-lit");
    if (mode === "rims") ctx.drawImage(overlays[ex], 0, 0, w, w);
    if (mode === "found") for (const [u, v, r] of e.found) circle(ctx, u * s, v * s, r * s, amber, 1.8);
    if (mode === "check") {
      for (const [u, v, r, deep, hit] of e.catalogue) {
        if (deep) circle(ctx, u * s, v * s, r * s, teal, hit ? 2.4 : 1.6, hit ? [] : [5, 4]);
        else if (hit) circle(ctx, u * s, v * s, r * s, "rgba(200,210,215,0.7)", 1.2);
      }
      for (const [u, v, r, hit] of e.found) if (!hit) circle(ctx, u * s, v * s, r * s, amber, 1.8);
    }
    const deep = e.catalogue.filter((c) => c[3]);
    const foundDeep = deep.filter((c) => c[4]).length;
    const inCat = e.found.filter((f) => f[3]).length;
    $("#det-tag").textContent = `Sun ${e.sun_el.toFixed(0)}° above the horizon · ${e.alt_km.toFixed(0)} km altitude · ${latText(e.lat)}`;
    const txt = {
      image: `Rendered view, ${e.alt_km.toFixed(0)} km up, Sun ${e.sun_el.toFixed(0)}° above the horizon.`,
      rims: "Network output: the probability that each pixel lies on a crater rim.",
      found: `<b>${e.found.length}</b> craters found in this view.`,
      check: `<b>${foundDeep}</b> of the <b>${deep.length}</b> catalogue craters deep enough to see were found (solid teal; dashed: missed). <b>${inCat}</b> of the ${e.found.length} detections are in the catalogue; the rest are in amber.`,
    }[mode];
    $("#det-stat").innerHTML = txt;
  }
  draw();
}

/* ------------------------------------------------------------------ 3 · identification by voting */

function voting(F, FR, atlases, feed) {
  // a busy but readable image from the replay
  let k = 0, bd = 1e9;
  FR.frames.forEach((f, j) => {
    const d = Math.abs(f.pairs.length - 16) + Math.max(0, f.det.length - 26) * 2;
    if (f.pairs.length >= 8 && d < bd) { bd = d; k = j; }
  });
  const f = FR.frames[k];
  const truePair = new Map(f.pairs.map(([d, p]) => [d, p]));
  const gsd = F.gsd_m;
  const img = $("#vote-img"), plot = $("#vote-plot");
  let vi = fit(img), vp = fit(plot, plot.clientWidth * 1.5);
  const off = { x: 0, y: 0 };
  onResize(img, () => { vi = fit(img); draw(); });
  onResize(plot, () => { vp = fit(plot, plot.clientWidth * 1.5); draw(); });

  function vote() {
    const cand = [];
    f.det.forEach(([u, v, r], i) => f.pred.forEach(([pu, pv, pr], j) => {
      const du = u - (pu + off.x), dv = v - (pv + off.y), q = r / pr;
      if (q < 1.5 && q > 1 / 1.5 && Math.hypot(du, dv) < 60) cand.push({ i, j, du, dv });
    }));
    if (cand.length < 3) return { cand, pairs: [], best: null };
    let bestK = 0, bestS = -1;
    cand.forEach((a, ka) => {
      const s = new Set();
      for (const b of cand) if (Math.hypot(a.du - b.du, a.dv - b.dv) < 2.5) s.add(b.i);
      if (s.size > bestS) { bestS = s.size; bestK = ka; }
    });
    const close = cand.filter((b) => Math.hypot(cand[bestK].du - b.du, cand[bestK].dv - b.dv) < 2.5);
    const best = { du: close.reduce((a, b) => a + b.du, 0) / close.length, dv: close.reduce((a, b) => a + b.dv, 0) / close.length };
    const good = cand.filter((c) => Math.hypot(c.du - best.du, c.dv - best.dv) < 4)
      .sort((a, b) => Math.hypot(a.du - best.du, a.dv - best.dv) - Math.hypot(b.du - best.du, b.dv - best.dv));
    const ui = new Set(), uj = new Set(), pairs = [];
    for (const c of good) if (!ui.has(c.i) && !uj.has(c.j)) { ui.add(c.i); uj.add(c.j); pairs.push(c); }
    return { cand, pairs: pairs.length >= 3 ? pairs : [], best: pairs.length >= 3 ? best : null };
  }

  function draw() {
    const res = vote();
    const amber = tok("--amber-lit"), teal = tok("--teal-lit"), soft = tok("--scope-soft"), ink = tok("--scope-ink");
    // image panel
    {
      const { ctx, w } = vi, s = w / 256;
      ctx.fillStyle = tok("--scope");
      ctx.fillRect(0, 0, w, w);
      feed.drawFrame(ctx, k, w);
      const matched = new Map(res.pairs.map((p) => [p.i, p.j]));
      for (const [u, v, r] of f.pred) circle(ctx, (u + off.x) * s, (v + off.y) * s, r * s, teal, 1.4, [5, 4]);
      ctx.strokeStyle = teal; ctx.lineWidth = 1.2;
      for (const p of res.pairs) {
        const [u, v] = f.det[p.i], [pu, pv] = f.pred[p.j];
        ctx.beginPath(); ctx.moveTo((pu + off.x) * s, (pv + off.y) * s); ctx.lineTo(u * s, v * s); ctx.stroke();
      }
      f.det.forEach(([u, v, r], i) => circle(ctx, u * s, v * s, r * s, matched.has(i) ? teal : amber, matched.has(i) ? 2.6 : 1.6));
    }
    // vote panel: every candidate pair is a dot at the shift it proposes
    {
      const { ctx, w, h } = vp;
      ctx.fillStyle = tok("--scope");
      ctx.fillRect(0, 0, w, h);
      const pad = 18, size = w - 2 * pad, cx = w / 2, cy = pad + 24 + size / 2, sc = size / 2 / 60;
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
      for (const rr of [20, 40, 60]) { ctx.beginPath(); ctx.arc(cx, cy, rr * sc, 0, Math.PI * 2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - 60 * sc, cy); ctx.lineTo(cx + 60 * sc, cy); ctx.moveTo(cx, cy - 60 * sc); ctx.lineTo(cx, cy + 60 * sc); ctx.stroke();
      ctx.fillStyle = soft; ctx.font = `500 11px ${tok("--ui")}`; ctx.textAlign = "left"; ctx.textBaseline = "top";
      for (const rr of [20, 40, 60]) ctx.fillText(`${((rr * gsd) / 1000).toFixed(0)} km`, cx + rr * sc * 0.72 + 3, cy - rr * sc * 0.72 - 6);
      ctx.fillStyle = "rgba(213,221,224,0.45)";
      for (const c of res.cand) { ctx.beginPath(); ctx.arc(cx + c.du * sc, cy + c.dv * sc, 2.2, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = teal;
      for (const c of res.pairs) { ctx.beginPath(); ctx.arc(cx + c.du * sc, cy + c.dv * sc, 3.6, 0, Math.PI * 2); ctx.fill(); }
      // the true shift
      ctx.strokeStyle = amber; ctx.lineWidth = 1.6;
      const tx = cx - off.x * sc, ty = cy - off.y * sc;
      ctx.beginPath(); ctx.moveTo(tx - 7, ty); ctx.lineTo(tx + 7, ty); ctx.moveTo(tx, ty - 7); ctx.lineTo(tx, ty + 7); ctx.stroke();
      // legend
      const ly = cy + size / 2 + 22;
      ctx.textBaseline = "middle"; ctx.font = `500 12px ${tok("--ui")}`;
      ctx.fillStyle = "rgba(213,221,224,0.6)"; ctx.beginPath(); ctx.arc(pad + 5, ly, 3, 0, 7); ctx.fill();
      ctx.fillStyle = ink; ctx.fillText("one vote per pair of similar size", pad + 16, ly);
      ctx.fillStyle = teal; ctx.beginPath(); ctx.arc(pad + 5, ly + 22, 3.6, 0, 7); ctx.fill();
      ctx.fillStyle = ink; ctx.fillText("winning cluster: craters identified", pad + 16, ly + 22);
      ctx.strokeStyle = amber; ctx.beginPath(); ctx.moveTo(pad, ly + 44); ctx.lineTo(pad + 10, ly + 44); ctx.moveTo(pad + 5, ly + 39); ctx.lineTo(pad + 5, ly + 49); ctx.stroke();
      ctx.fillText("the position error you set", pad + 16, ly + 44);
    }
    const err = Math.hypot(off.x, off.y) * gsd;
    if (!res.best) {
      $("#vote-stat").innerHTML = `Position error <b>${fmtM(err)}</b>. Not enough agreeing pairs: no identification in this image.`;
    } else {
      const wrong = res.pairs.filter((p) => truePair.get(p.i) !== undefined ? truePair.get(p.i) !== p.j : Math.hypot(f.det[p.i][0] - f.pred[p.j][0], f.det[p.i][1] - f.pred[p.j][1]) > 3).length;
      const found = Math.hypot(res.best.du, res.best.dv) * gsd;
      $("#vote-stat").innerHTML = `Position error <b>${fmtM(err)}</b>, shift found <b>${fmtM(found)}</b>. <b>${res.pairs.length}</b> craters identified${wrong ? `, ${wrong} of them wrongly` : ", all correctly"}.`;
    }
  }
  let drag = null;
  img.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; img.setPointerCapture(e.pointerId); });
  img.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const s = 256 / img.clientWidth;
    off.x = clamp(off.x + (e.clientX - drag[0]) * s, -55, 55);
    off.y = clamp(off.y + (e.clientY - drag[1]) * s, -55, 55);
    drag = [e.clientX, e.clientY];
    draw();
  });
  img.addEventListener("pointerup", () => { drag = null; });
  $("#vote-random").addEventListener("click", () => {
    const a = Math.random() * Math.PI * 2, m = 5000 / gsd;
    off.x = Math.cos(a) * m; off.y = Math.sin(a) * m;
    draw();
  });
  $("#vote-reset").addEventListener("click", () => { off.x = 0; off.y = 0; draw(); });
  const a0 = 2.2, m0 = 4000 / gsd;
  off.x = Math.cos(a0) * m0; off.y = Math.sin(a0) * m0;
  onThemeChange(draw);
  draw();
}

/* ------------------------------------------------------------------ 4 · filter consistency */

function consistency(F) {
  const canvas = $("#flt");
  let axis = "t";
  let view;
  const hours = F.t.map((t) => t / 3600), H = hours[hours.length - 1];
  const day = F.frame.map((k) => k >= 0);
  const names = { t: "along-track", n: "cross-track", r: "radial" };
  function size() { view = fit(canvas, canvas.clientWidth < 600 ? 300 : 400); }
  function draw() {
    const { ctx, w, h } = view;
    const m = { l: 58, r: 14, t: 14, b: 30 };
    const e = F[`err_${axis}`], s = F[`sig_${axis}`];
    const lim = 500;
    const x = (v) => m.l + (v / H) * (w - m.l - m.r);
    const y = (v) => m.t + (1 - (clamp(v, -lim, lim) + lim) / (2 * lim)) * (h - m.t - m.b);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = tok("--night");
    let st = null;
    for (let i = 0; i <= hours.length; i++) {
      const night = i < hours.length && !day[i];
      if (night && st === null) st = hours[i];
      if (!night && st !== null) { ctx.fillRect(x(st), m.t, x(hours[i - 1]) - x(st), h - m.t - m.b); st = null; }
    }
    ctx.font = `500 11px ${tok("--ui")}`;
    ctx.strokeStyle = tok("--rule"); ctx.fillStyle = tok("--ink-soft"); ctx.lineWidth = 1;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (const v of [-400, -200, 0, 200, 400]) {
      ctx.beginPath(); ctx.moveTo(m.l, y(v)); ctx.lineTo(w - m.r, y(v)); ctx.stroke();
      ctx.fillText(`${v} m`, m.l - 8, y(v));
    }
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let hh = 0; hh <= 6; hh++) if (hh <= H + 0.01) ctx.fillText(`${hh} h`, x(hh), h - m.b + 8);
    // 3-sigma band
    ctx.beginPath();
    hours.forEach((v, i) => (i ? ctx.lineTo(x(v), y(3 * s[i])) : ctx.moveTo(x(v), y(3 * s[i]))));
    for (let i = hours.length - 1; i >= 0; i--) ctx.lineTo(x(hours[i]), y(-3 * s[i]));
    ctx.closePath();
    ctx.fillStyle = tok("--teal"); ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;
    // error
    ctx.save();
    ctx.beginPath(); ctx.rect(m.l, m.t, w - m.l - m.r, h - m.t - m.b); ctx.clip();
    ctx.beginPath();
    hours.forEach((v, i) => (i ? ctx.lineTo(x(v), y(e[i])) : ctx.moveTo(x(v), y(e[i]))));
    ctx.strokeStyle = tok("--amber"); ctx.lineWidth = 1.8; ctx.stroke();
    let out = 0, nd = 0;
    ctx.fillStyle = tok("--ink");
    hours.forEach((v, i) => {
      if (!day[i]) return;
      nd++;
      if (Math.abs(e[i]) > 3 * s[i]) { out++; ctx.beginPath(); ctx.arc(x(v), y(e[i]), 2.6, 0, 7); ctx.fill(); }
    });
    ctx.restore();
    ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.font = `500 12px ${tok("--ui")}`;
    ctx.fillStyle = tok("--ink-soft");
    ctx.fillText(`${names[axis]} error (line) and the filter's own ±3σ (band)`, m.l + 8, m.t + 6);
    const pct = (100 * out) / nd;
    $("#flt-stat").innerHTML = `The ${names[axis]} error is outside its 3σ band in <b>${pct.toFixed(1)} %</b> of the daylight images. For a filter whose uncertainty is right, that should happen about 0.3 % of the time.`;
  }
  $$("#flt-axis button").forEach((b) => b.addEventListener("click", () => {
    axis = b.dataset.a;
    $$("#flt-axis button").forEach((o) => o.setAttribute("aria-pressed", String(o === b)));
    draw();
  }));
  size();
  onResize(canvas, () => { size(); draw(); });
  onThemeChange(draw);
  draw();
}

/* ------------------------------------------------------------------ results */

function results(S) {
  const n = S.network, o = S.oracle;
  const pct = (a) => `${Math.round((100 * a.images_used) / a.images)} %`;
  const rows = [
    ["Position error in daylight, median", fmtM(n.day_median_m), fmtM(o.day_median_m)],
    ["95 % of the time below", fmtM(n.day_p95_m), fmtM(o.day_p95_m)],
    ["Largest error after a night pass", fmtM(n.night_max_m), fmtM(o.night_max_m)],
    ["Error at the end", fmtM(n.end_m), fmtM(o.end_m)],
    ["Same filter without craters, at the end", fmtM(n.dr_end_m), fmtM(o.dr_end_m)],
    ["Daylight images with a crater identified", pct(n), pct(o)],
    ["Craters per image, found / identified (median)", `${n.median_found} / ${n.median_used}`, `${o.median_found} / ${o.median_used}`],
  ];
  $("#res-table").innerHTML = rows.map(([a, b, c]) => `<tr><td>${a}</td><td class="v net">${b}</td><td class="v">${c}</td></tr>`).join("");
}

/* ------------------------------------------------------------------ boot */

(async function main() {
  const [F, FR, T, D, S] = await Promise.all([
    getJSON("data/flight.json"), getJSON("data/frames.json"), getJSON("data/tycho.json"),
    getJSON("data/detector.json"), getJSON("data/summary.json"),
  ]);
  results(S);
  const stripPromise = Promise.all([getJSON("data/orbit_strip.json"), getImage("data/orbit_strip.png")])
    .then(([meta, image]) => ({ meta, image }));
  const nAtlas = Math.ceil(FR.frames.length / FR.per_atlas);
  const [moon, strip, rims, ...atlases] = await Promise.all([
    getImage("data/moon.jpg"), getImage("data/detector_images.png"), getImage("data/detector_rims.png"),
    ...Array.from({ length: nAtlas }, (_, a) => getImage(`data/frames_${a}.webp`)),
  ]);
  lighting(T, stripPromise, moon, F.sun_lon);
  detector(D, strip, rims);
  consistency(F);
  const feed = new Feed($("#feed"), atlases, FR);
  const chart = new ErrorChart($("#chart"), F, () => {});
  let globe;
  try {
    globe = new Globe($("#globe"), moon, F, () => {});
  } catch (err) {
    $("#globe").insertAdjacentHTML("beforeend", '<p class="feed-night">This browser could not start WebGL, so the globe is not shown.</p>');
    globe = { setIndex() {}, setFollow() {}, onFollowChange: null };
  }
  replay(F, FR, globe, feed, chart);
  voting(F, FR, atlases, feed);
})().catch((err) => {
  console.error(err);
  document.querySelector(".console").insertAdjacentHTML("afterbegin", `<p class="note">The flight data did not load (${err.message}). Reload the page to try again.</p>`);
});
