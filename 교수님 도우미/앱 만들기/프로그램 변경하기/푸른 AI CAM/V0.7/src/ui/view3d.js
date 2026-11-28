/* =====================================================================
 * 푸른 AI CAM - [3D 화면·가공 시뮬레이션] ui/view3d.js
 * 역할: three.js(MIT, 파일 안에 포함)로 소재·가공면·공구·경로를 3D 로 표시하고,
 *       독립 NC 검증기가 해석한 실제 이동을 시간축으로 재생하며 소재를 깎는다 (sim/stock-sim.js).
 *   - 마우스: 왼쪽 드래그 회전 / 오른쪽·Shift 드래그 이동 / 휠 확대
 *   - 터치: 한 손가락 회전 / 두 손가락 확대·이동
 *   - 좌표계: CAM 좌표(X 오른쪽, Y 안쪽, Z 위)를 three(Y 위)로 변환해 표시
 * 의존: window.THREE, PCAM(SIM), 상태 제공 함수
 * ===================================================================== */
(function () {
  'use strict';
  const C = window.PCAM;
  window.PCAM_UI = window.PCAM_UI || {};

  const TAG_COLORS = { 0: [0.82, 0.85, 0.89], 1: [0.10, 0.66, 0.50], 2: [0.20, 0.45, 0.93], 3: [0.56, 0.36, 0.96], 4: [0.95, 0.56, 0.10], 5: [0.62, 0.72, 0.80], 6: [0.90, 0.30, 0.55] };
  const THRU = [0.13, 0.15, 0.18];

  window.PCAM_UI.createView3D = function (host, hooks) {
    const THREE = window.THREE;
    const api = { ok: false };
    if (!THREE) { host.innerHTML = '<div class="v3-msg">3D 라이브러리를 불러오지 못했습니다.</div>'; return api; }
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch (e) { host.innerHTML = '<div class="v3-msg">이 브라우저(또는 PC)에서 3D(WebGL)를 쓸 수 없습니다. 2D 화면은 그대로 사용할 수 있습니다.</div>'; return api; }
    api.ok = true;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.localClippingEnabled = true; // 단면 보기
    host.appendChild(renderer.domElement);
    renderer.domElement.className = 'v3-canvas';
    renderer.domElement.setAttribute('aria-label', '3D 가공 시뮬레이션 화면');
    renderer.domElement.tabIndex = 0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 20000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a93a0, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(-0.6, 1.2, 0.8); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.25); fill.position.set(0.8, 0.4, -0.6); scene.add(fill);

    // CAM(x, y, z) → three(x, z, -y)
    const V = (x, y, z) => new THREE.Vector3(x, z, -y);
    let stockGroup = null, mesh = null, geo = null, sim = null, toolGroup = null, pathGroup = null, gridHelper = null, axes = null;
    let motions = [], tl = [], tools = new Map(), total = 0, simT = 0, cutIndex = 0, playing = false, speed = 10, lastFrame = 0;
    let target = new THREE.Vector3(), sph = { r: 300, th: -0.9, ph: 0.95 }, theme = 'light';
    let snaps = new Map(), zTop = 50, zClip = Infinity, clipMats = [];
    // 단면: CAM Y ≥ ys 쪽만 남김 (앞쪽을 잘라 구멍 깊이를 옆에서 보이게)
    const section = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0); let sectionOn = false;
    function applySection() { clipMats.forEach(m => { m.clippingPlanes = sectionOn ? [section] : []; m.needsUpdate = true; }); render(); }

    /* ---------- 카메라 (궤도) ---------- */
    function applyCam() {
      const { r, th, ph } = sph;
      camera.position.set(target.x + r * Math.sin(ph) * Math.sin(th), target.y + r * Math.cos(ph), target.z + r * Math.sin(ph) * Math.cos(th));
      camera.lookAt(target);
      render();
    }
    api.view = function (kind) {
      if (!sim) return;
      const cx = sim.x0 + sim.sx / 2, cy = sim.y0 + sim.sy / 2;
      target = V(cx, cy, sim.bottom / 2);
      // 소재 + 공구가 다니는 높이(초기점)까지 화면에 들어오게
      const top = Math.max(0, Math.min(zTop, 200));
      target = V(cx, cy, (sim.bottom + top) / 2);
      const size = Math.max(sim.sx, sim.sy, top - sim.bottom);
      sph.r = size * 2.0;
      if (kind === 'top') { sph.th = 0; sph.ph = 0.0001; }
      else if (kind === 'front') { sph.th = 0; sph.ph = Math.PI / 2 - 0.02; }
      else if (kind === 'side') { sph.th = Math.PI / 2; sph.ph = Math.PI / 2 - 0.02; }
      else { sph.th = -0.75; sph.ph = 0.95; }
      applyCam();
    };
    // 마우스·터치 궤도 조작
    (function controls() {
      const el = renderer.domElement, ptr = new Map();
      let mode = null, last = null, pinch = null;
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('pointerdown', e => {
        el.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; mode = 'pinch'; return; }
        mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rot'; last = { x: e.clientX, y: e.clientY };
      });
      el.addEventListener('pointermove', e => {
        hover(e);
        if (!ptr.has(e.pointerId)) return;
        ptr.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (mode === 'pinch' && ptr.size === 2) {
          const [a, b] = [...ptr.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (pinch.d > 0) sph.r = Math.max(5, Math.min(20000, sph.r * pinch.d / d));
          pan(mx - pinch.mx, my - pinch.my); pinch = { d, mx, my }; applyCam(); return;
        }
        if (!last) return;
        const dx = e.clientX - last.x, dy = e.clientY - last.y; last = { x: e.clientX, y: e.clientY };
        if (mode === 'rot') { sph.th -= dx * 0.008; sph.ph = Math.max(0.0001, Math.min(Math.PI - 0.0001, sph.ph - dy * 0.008)); applyCam(); }
        else if (mode === 'pan') { pan(dx, dy); applyCam(); }
      });
      const up = e => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch = null; if (!ptr.size) { mode = null; last = null; } };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('wheel', e => { e.preventDefault(); sph.r = Math.max(5, Math.min(20000, sph.r * (e.deltaY > 0 ? 1.12 : 1 / 1.12))); applyCam(); }, { passive: false });
      function pan(dx, dy) {
        const k = sph.r * 0.0016, right = new THREE.Vector3(), upv = new THREE.Vector3();
        camera.matrix.extractBasis(right, upv, new THREE.Vector3());
        target.addScaledVector(right, -dx * k).addScaledVector(upv, dy * k);
      }
    })();

    /* ---------- 마우스 위치의 X·Y·Z ---------- */
    const ray = new THREE.Raycaster(); let hoverT = 0;
    function hover(e) {
      if (!mesh || !hooks.onHover) return;
      const now = performance.now(); if (now - hoverT < 60) return; hoverT = now;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
      const hit = ray.intersectObject(mesh, false)[0];
      hooks.onHover(hit ? { x: hit.point.x, y: -hit.point.z, z: hit.point.y } : null);
    }

    /* ---------- 소재 메시 (높이맵 + 옆면 + 바닥) ---------- */
    function buildStock() {
      if (stockGroup) { scene.remove(stockGroup); stockGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
      stockGroup = new THREE.Group();
      const { nx, ny } = sim;
      geo = new THREE.BufferGeometry();
      const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3), nor = new Float32Array(nx * ny * 3);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      const idx = new Uint32Array((nx - 1) * (ny - 1) * 6); let q = 0;
      for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      updateRegion(0, nx - 1, 0, ny - 1);
      mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.08, roughness: 0.62, side: THREE.DoubleSide }));
      clipMats = [mesh.material];
      stockGroup.add(mesh);
      // 옆면·바닥 (높이맵 가장자리 아래 얇은 벽)
      const sideMat = new THREE.MeshStandardMaterial({ color: 0xaab3bd, metalness: 0.08, roughness: 0.7 });
      const walls = edgeWalls(sideMat); stockGroup.add(walls); clipMats.push(sideMat);
      // 소재 외곽선 (입체감)
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(sim.sx, -sim.bottom, sim.sy)), new THREE.LineBasicMaterial({ color: theme === 'dark' ? 0x8fa3b8 : 0x55687c, transparent: true, opacity: 0.8 }));
      edges.position.copy(V(sim.x0 + sim.sx / 2, sim.y0 + sim.sy / 2, sim.bottom / 2)); stockGroup.add(edges); clipMats.push(edges.material);
      scene.add(stockGroup);
    }
    function edgeWalls(mat) {
      const g = new THREE.Group(), sx = sim.sx, sy = sim.sy, h = -sim.bottom, cx = sim.x0 + sx / 2, cy = sim.y0 + sy / 2;
      const add = (w, d, x, y) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.copy(V(x, y, -h / 2 - 0.01)); g.add(m); };
      // 높이맵 가장자리 아래 얇은 벽 4장 + 바닥
      add(sx, 0.02, cx, sim.y0); add(sx, 0.02, cx, sim.y0 + sy); add(0.02, sy, sim.x0, cy); add(0.02, sy, sim.x0 + sx, cy);
      const bot = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.02, sy), mat); bot.position.copy(V(cx, cy, -h - 0.02)); g.add(bot);
      return g;
    }
    // 격자 일부(더러워진 영역)의 위치·색·법선 갱신
    function updateRegion(i0, i1, j0, j1) {
      const { nx, ny, h, tag, dx, x0, y0, bottom } = sim;
      const pos = geo.attributes.position.array, col = geo.attributes.color.array, nor = geo.attributes.normal.array;
      const a0 = Math.max(0, i0 - 1), a1 = Math.min(nx - 1, i1 + 1), b0 = Math.max(0, j0 - 1), b1 = Math.min(ny - 1, j1 + 1);
      for (let j = b0; j <= b1; j++) for (let i = a0; i <= a1; i++) {
        const k = j * nx + i, z = h[k], p = k * 3;
        pos[p] = x0 + i * dx; pos[p + 1] = z; pos[p + 2] = -(y0 + j * dx);
        const c = z <= bottom ? THRU : TAG_COLORS[tag[k]] || TAG_COLORS[0];
        const shade = z < -1e-3 ? 1 - 0.5 * Math.min(1, -z / Math.max(1, -bottom)) : 1; // 깊을수록 어둡게
        col[p] = c[0] * shade; col[p + 1] = c[1] * shade; col[p + 2] = c[2] * shade;
        const hl = h[j * nx + Math.max(0, i - 1)], hr = h[j * nx + Math.min(nx - 1, i + 1)];
        const hd = h[Math.max(0, j - 1) * nx + i], hu = h[Math.min(ny - 1, j + 1) * nx + i];
        let gx = (hl - hr), gy = 2 * dx, gz = -(hd - hu); const L = Math.hypot(gx, gy, gz) || 1;
        nor[p] = gx / L; nor[p + 1] = gy / L; nor[p + 2] = gz / L;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
      geo.computeBoundingSphere();
    }
    function flushDirty() { if (sim && sim.dirty) { const d = sim.dirty; sim.dirty = null; updateRegion(d.i0, d.i1, d.j0, d.j1); } }

    /* ---------- 공구·경로 ---------- */
    function buildTool(t) {
      if (toolGroup) { scene.remove(toolGroup); toolGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); toolGroup = null; }
      if (!t) return;
      toolGroup = new THREE.Group();
      const R = t.dia / 2, L = Math.max(4 * R, Math.min(t.flute || 20, 60));
      const steel = new THREE.MeshStandardMaterial({ color: t.type === 'tap' ? 0xd7c37a : 0xe8edf2, metalness: 0.9, roughness: 0.25 });
      if (t.type === 'chamfer') {
        const tipR = Math.max(0.05, (t.tip || 0) / 2), coneH = (R - tipR) / Math.tan((t.angle || 90) / 2 * Math.PI / 180);
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(R, tipR, coneH, 32), steel); tip.position.y = coneH / 2; toolGroup.add(tip);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.6, R * 0.6, L, 24), steel); body.position.y = coneH + L / 2; toolGroup.add(body);
      } else if (t.type === 'facemill') {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, Math.max(4, R * 0.35), 40), steel); disc.position.y = Math.max(4, R * 0.35) / 2; toolGroup.add(disc);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.45, R * 0.45, 20, 28), steel); body.position.y = Math.max(4, R * 0.35) + 10; toolGroup.add(body);
      } else if (t.type === 'drill' || t.type === 'center') {
        const tipL = R / Math.tan((t.angle || 118) / 2 * Math.PI / 180);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(R, tipL, 24), steel); tip.rotation.x = Math.PI; tip.position.y = tipL / 2; toolGroup.add(tip);
        const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 24), steel); body.position.y = tipL + L / 2; toolGroup.add(body);
      } else {
        const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 24), steel); body.position.y = L / 2; toolGroup.add(body);
      }
      const holder = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(R * 1.6, 6), Math.max(R * 2.4, 10), 18, 28), new THREE.MeshStandardMaterial({ color: 0x3b4450, metalness: 0.6, roughness: 0.4 }));
      holder.position.y = L + 12; toolGroup.add(holder);
      scene.add(toolGroup);
    }
    function buildPaths() {
      if (pathGroup) { scene.remove(pathGroup); pathGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
      pathGroup = new THREE.Group();
      const rap = [], feed = [];
      motions.forEach(m => {
        const arr = m.k === 'rapid' ? rap : feed;
        if (m.k === 'arc') {
          let prev = C.SIM.motionPoint(m, 0);
          const n = 24;
          for (let s = 1; s <= n; s++) { const p = C.SIM.motionPoint(m, s / n); arr.push(prev.x, prev.z + 0.02, -prev.y, p.x, p.z + 0.02, -p.y); prev = p; }
        } else { const za = Math.min(m.z0, zClip), zb = Math.min(m.z1, zClip); if (m.k === 'rapid' && za === zb && m.x0 === m.x1 && m.y0 === m.y1) return; arr.push(m.x0, za + 0.02, -m.y0, m.x1, zb + 0.02, -m.y1); }
      });
      const mk = (arr, color, op) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: op })); pathGroup.add(l); return l; };
      mk(rap, 0xf2994a, 0.35).name = 'rapid'; mk(feed, 0x12b76a, 0.85).name = 'feed';
      pathGroup.visible = api.showPaths !== false;
      scene.add(pathGroup);
    }
    function buildClamps(clamps) {
      clamps.forEach(c => {
        const x0 = Math.min(c.x, c.x + c.w), y0 = Math.min(c.y, c.y + c.h), w = Math.abs(c.w), d = Math.abs(c.h), hh = Math.max(1, c.height);
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), new THREE.MeshStandardMaterial({ color: 0xf08c00, transparent: true, opacity: 0.55, roughness: 0.6 }));
        clipMats.push(m.material);
        m.position.copy(V(x0 + w / 2, y0 + d / 2, hh / 2)); stockGroup.add(m);
      });
    }
    function decor() {
      if (gridHelper) scene.remove(gridHelper); if (axes) scene.remove(axes);
      const size = Math.max(sim.sx, sim.sy) * 1.8;
      gridHelper = new THREE.GridHelper(size, 24, theme === 'dark' ? 0x3a4654 : 0xc9d2dc, theme === 'dark' ? 0x26303a : 0xe3e8ee);
      gridHelper.position.copy(V(sim.x0 + sim.sx / 2, sim.y0 + sim.sy / 2, sim.bottom - 0.05)); scene.add(gridHelper);
      axes = new THREE.Group();
      const L = Math.max(15, Math.min(sim.sx, sim.sy) * 0.25);
      [[1, 0, 0, 0xe5484d], [0, 1, 0, 0x30a46c], [0, 0, 1, 0x3e63dd]].forEach(([x, y, z, c]) => {
        const g = new THREE.BufferGeometry().setFromPoints([V(0, 0, 0.05), V(x * L, y * L, z * L + 0.05)]);
        axes.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: c })));
      });
      scene.add(axes);
    }

    /* ---------- 재생 ---------- */
    function toolAt(t) {
      let i = 0; while (i < tl.length - 1 && tl[i].t1 < t) i++;
      const m = motions[i]; if (!m) return null;
      const seg = tl[i], u = seg.sec > 0 ? Math.min(1, Math.max(0, (t - seg.t0) / seg.sec)) : 1;
      return { i, u, m, p: C.SIM.motionPoint(m, u) };
    }
    // 시간 t 까지 소재를 깎음. 뒤로 가면 저장해 둔 중간 상태(공구 교환·일정 간격)에서 다시 시작
    function advanceTo(t) {
      if (t < simT - 1e-9) {
        let best = 0; snaps.forEach((v, b) => { if (b > best && tl[b].t0 <= t) best = b; });
        if (best > 0) { const sn = snaps.get(best); sim.h.set(sn.h); sim.tag.set(sn.tag); sim.dirty = { i0: 0, i1: sim.nx - 1, j0: 0, j1: sim.ny - 1 }; cutIndex = best; }
        else { C.SIM.resetSim(sim); cutIndex = 0; }
        simT = 0;
      }
      while (cutIndex < motions.length && tl[cutIndex].t1 <= t) {
        const m = motions[cutIndex]; C.SIM.cutMotion(sim, m, tools.get(m.t)); cutIndex++;
        if (cutIndex < motions.length && !snaps.has(cutIndex) && (motions[cutIndex].t !== m.t || cutIndex % 1500 === 0)) snaps.set(cutIndex, { h: sim.h.slice(), tag: sim.tag.slice() });
      }
      const cur = motions[cutIndex];
      if (cur && t > tl[cutIndex].t0) { const u = (t - tl[cutIndex].t0) / Math.max(1e-9, tl[cutIndex].sec); C.SIM.cutMotion(sim, cur, tools.get(cur.t), 0, Math.min(1, u)); }
      simT = t;
      flushDirty();
      const at = toolAt(t);
      let curTool = null;
      if (at) {
        curTool = tools.get(at.m.t) || null;
        if (!toolGroup || toolGroup.userData.no !== (curTool && curTool.no)) { buildTool(curTool); if (toolGroup) toolGroup.userData.no = curTool && curTool.no; }
        if (toolGroup) { toolGroup.position.copy(V(at.p.x, at.p.y, at.p.z)); toolGroup.visible = t < total - 1e-9; } // 가공 완료 상태에서는 공구를 숨겨 결과가 잘 보이게
      }
      if (hooks.onProgress) hooks.onProgress({ t, total, at, tool: curTool });
      render();
    }
    function loop(ts) {
      if (!playing) return;
      const dt = lastFrame ? (ts - lastFrame) / 1000 : 0; lastFrame = ts;
      let t = simT + dt * speed;
      if (t >= total) { t = total; playing = false; if (hooks.onState) hooks.onState('end'); }
      advanceTo(t);
      if (playing) requestAnimationFrame(loop);
    }
    api.play = () => { if (!sim || !motions.length) return; if (simT >= total) api.seek(0); playing = true; lastFrame = 0; if (hooks.onState) hooks.onState('play'); requestAnimationFrame(loop); };
    api.pause = () => { playing = false; if (hooks.onState) hooks.onState('pause'); };
    api.isPlaying = () => playing;
    api.seek = t => { if (!sim) return; advanceTo(Math.max(0, Math.min(total, t))); };
    api.finish = () => { api.pause(); api.seek(total); };
    api.setSpeed = s => { speed = s; };
    api.stepOp = dir => { // 다음/이전 공구 교환 지점으로
      if (!tl.length) return;
      const at = toolAt(simT), cur = at ? at.m.t : null;
      if (dir > 0) { let i = at ? at.i : 0; while (i < motions.length && motions[i].t === cur) i++; let j = i; while (j < motions.length && motions[j].t === motions[i].t && motions[j].k === 'rapid') j++; if (j >= motions.length || (i < motions.length && motions[j].t !== motions[i].t)) j = i; api.seek(j < motions.length ? tl[j].t0 + 1e-6 : total); } // 다음 공구의 첫 절삭 시작점으로
      else { let i = at ? at.i : 0; while (i > 0 && motions[i - 1].t === cur) i--; let k = Math.max(0, i - 1); const prevT = motions[k] ? motions[k].t : null; while (k > 0 && motions[k - 1].t === prevT) k--; api.seek(i === 0 ? 0 : tl[k].t0); }
    };
    api.setSection = ys => { sectionOn = ys !== null && ys !== undefined; if (sectionOn) section.constant = -ys; applySection(); };
    api.sectionOn = () => sectionOn;
    api.setShowPaths = v => { api.showPaths = v; if (pathGroup) pathGroup.visible = v; render(); };
    api.setTheme = th => { theme = th; scene.background = new THREE.Color(th === 'dark' ? 0x12171d : 0xf1f4f8); if (sim) decor(); render(); };

    /* ---------- 데이터 적용 ---------- */
    // data: { stock, motions, tools(Map), clamps, machine }
    api.load = function (data, keepCamera) {
      const first = !sim;
      sim = C.SIM.createSim(data.stock, { maxCells: data.maxCells || 160000 });
      motions = data.motions || []; tools = data.tools; tl = C.SIM.timeline(motions, data.machine);
      total = tl.length ? tl[tl.length - 1].t1 : 0; simT = 0; cutIndex = 0; playing = false; snaps = new Map();
      zClip = isFinite(data.zClip) ? data.zClip : Infinity; zTop = isFinite(data.zClip) ? data.zClip + 15 : 50;
      buildStock(); buildClamps(data.clamps || []); buildPaths(); decor(); buildTool(null); applySection();
      if (first || !keepCamera) api.view('iso');
      // 기본: 가공 완료 상태로 보여줌
      api.seek(data.startAt === 0 ? 0 : total);
      return { total, timeline: tl };
    };
    api.resize = function () {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); render();
    };
    function render() { renderer.render(scene, camera); }
    api.render = render;
    api.snapshot = () => renderer.domElement.toDataURL('image/png');
    api.setTheme('light');
    if (window.ResizeObserver) new ResizeObserver(() => api.resize()).observe(host);
    return api;
  };
})();
