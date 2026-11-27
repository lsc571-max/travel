/* =====================================================================
 * 푸른 AI CAM - [가공 모듈: 평면(페이스)] ops/face.js  (V0.5)
 * 역할: 소재 윗면을 고르게 깎는 평면 가공 (faceMill). 공구: 페이스밀 또는 평 엔드밀.
 *   - 범위: 소재 전체 (위치 입력 없음). Z0(원래 윗면)에서 깊이만큼 깎는다.
 *     ※ 다른 가공의 깊이는 원래 윗면(Z0) 기준이므로, 평면 깊이를 더해 입력해야 한다 (화면 안내).
 *   - 경로: X 방향 왕복(지그재그). 줄 간격 = 경로 간격(공구 직경 %) 이하로 균등,
 *     첫·마지막 줄은 소재 가장자리 밖으로 공구 반경의 70% 이상 걸침 → 남는 살 없음
 *   - 진입·줄 바꿈·단 내림: 모두 소재 밖(X 양 끝, 공구가 소재에 닿지 않는 위치)에서
 * 의존: engine/*, ops/hole-common.js, ops/mill-common.js
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM, H = P.HOLE, MC = P.MILL;
  const { toNum, r3, EPS, stockRect } = P;
  const PARAMS = { stepover: 70, stepdown: 0.5, margin: 2 };

  // 줄 위치와 X 범위
  function rows(st, tool, pk) {
    const sr = stockRect(st), rt = tool.dia / 2;
    const so = Math.max(0.05, Math.min(90, toNum(pk.stepover, 70)) / 100) * tool.dia;
    const inset = 0.3 * rt; // 첫·마지막 줄 중심을 가장자리 안쪽 0.3R → 공구가 0.7R 바깥으로 걸침
    const ya = sr.y0 + inset, yb = sr.y1 - inset;
    const ys = [];
    if (yb <= ya) ys.push((sr.y0 + sr.y1) / 2);
    else { const n = Math.max(1, Math.ceil((yb - ya) / so - 1e-9)); for (let i = 0; i <= n; i++) ys.push(ya + (yb - ya) * i / n); }
    const m = Math.max(0.5, toNum(pk.margin, 2));
    return { ys, xa: sr.x0 - rt - m, xb: sr.x1 + rt + m, sr, rt, m };
  }
  function faceMoves(s, tool, c, machine, project) {
    const pk = s.pk, st = project.stock, R = rows(st, tool, pk);
    const zs = MC.levels(-s.z, 0, toNum(pk.stepdown, 0.5), false);
    const F = s.feed, B = MC.builder();
    let fwd = true, rowsOrder = R.ys.slice();
    zs.forEach((z, li) => {
      const x0 = fwd ? R.xa : R.xb;
      // 단 내림: 소재 밖(공구 전체가 소재 바깥)에서 이송 하강
      B.push(1, x0, rowsOrder[0], li === 0 ? 0.5 : zs[li - 1], F);
      B.push(1, x0, rowsOrder[0], z, Math.max(1, Math.round(F * 0.5)));
      rowsOrder.forEach((y, k) => {
        if (k > 0) B.push(1, fwd ? R.xa : R.xb, y, z, F); // 소재 밖에서 다음 줄로
        B.push(1, fwd ? R.xb : R.xa, y, z, F);
        fwd = !fwd;
      });
      rowsOrder = rowsOrder.slice().reverse(); // 다음 단은 끝난 쪽에서 거꾸로
    });
    const f0 = B.M[0];
    return { sx: f0.x, sy: f0.y, moves: B.M };
  }
  function region(o, h, st, tool) {
    const sr = stockRect(st), rt = tool ? tool.dia / 2 : 0, m = Math.max(0.5, toNum(o.margin, 2));
    return { kind: 'face', x0: sr.x0 - rt - m - 0.01, x1: sr.x1 + rt + m + 0.01, y0: sr.y0 - 0.01, y1: sr.y1 + 0.01, floorZ: -toNum(o.depth, 0) };
  }
  function validate(ctx) {
    const { op, tool, d, st, on, add, project } = ctx;
    H.validateConditions(ctx);
    if (!(d.depth > 0)) add('error', 8, on + ': 평면 깊이가 0 이하입니다.');
    else if (d.depth > 10 + EPS) add('warn', 8, on + ': 평면 깊이 ' + d.depth + 'mm — 깊습니다. 여러 단으로 나뉘어 시간이 오래 걸립니다.');
    if (d.depth >= st.sz - EPS) add('error', 8, on + ': 평면 깊이가 소재 두께 이상입니다.');
    const sd = toNum(op.stepdown, NaN), so = toNum(op.stepover, NaN);
    if (!(sd >= 0.05)) add('error', 9, on + ': 절입 깊이(1회)는 0.05mm 이상이어야 합니다.');
    else if (tool.flute > 0 && sd > tool.flute + EPS) add('error', 9, on + ': 절입 깊이가 공구 날 길이를 넘습니다.');
    else if (sd > 0.5 * tool.dia + EPS) add('warn', 9, on + ': 절입 깊이가 공구 직경의 50% 를 넘습니다.');
    if (!(so >= 10 && so <= 90)) add('error', 9, on + ': 경로 간격은 공구 직경의 10~90% 여야 합니다.');
    if (!(toNum(op.margin, NaN) >= 0.5 && toNum(op.margin, NaN) <= 50)) add('error', 9, on + ': 가장자리 밖 여유는 0.5~50mm 여야 합니다.');
    // 클램프: 공구가 지나가는 범위(소재 + 양옆 걸침)와 겹치면 차단 (위치와 무관한 소재 전체 가공)
    const R = rows(st, tool, op);
    (project && project.clamps || []).forEach((c, ci) => {
      const cx0 = Math.min(c.x, c.x + c.w), cx1 = Math.max(c.x, c.x + c.w), cy0 = Math.min(c.y, c.y + c.h), cy1 = Math.max(c.y, c.y + c.h);
      const hit = cx0 < R.xb + R.rt + 1 && cx1 > R.xa - R.rt - 1 && cy0 < R.sr.y1 + R.rt + 1 && cy1 > R.sr.y0 - R.rt - 1;
      if (hit) add('error', 10, on + ': 평면 가공 범위(소재 전체 + 양옆 ' + r3(R.rt + R.m) + 'mm)가 클램프 ' + (ci + 1) + ' 와 겹칩니다. 바이스처럼 소재 옆면을 잡거나 클램프 위치를 옮기세요.');
    });
    add('info', 8, on + ': 평면 가공 후 소재 윗면은 Z' + r3(-d.depth) + ' 입니다. 다른 가공의 깊이는 원래 윗면(Z0) 기준입니다.');
    H.validateRPlane(ctx);
  }
  P.OPS.register({
    id: 'faceMill', label: '평면 가공', code: 'G01', ncName: 'FACE MILL', ncUnit: 'FACE', stage: -1, role: 'mill', family: 'mill', toolTypes: ['facemill', 'endmill'],
    defaults: Object.assign({ depth: 0.5, r: 3 }, PARAMS), params: PARAMS, moves: faceMoves, mill: 'face',
    regions: (op, h, st, tool) => [region(op, h, st, tool)],
    ui: { q: false, dwell: false, thru: false, depthMode: false, pocket: true, face: true },
    depth(op) { const dd = toNum(op.depth, 0); return { depth: r3(dd), full: r3(dd), tip: 0, z: r3(-dd) }; },
    ref: (tool, matKey) => MC.ref(tool, matKey, tool.type === 'facemill' ? 'face' : 'finish'),
    recommend: (tool, matKey, machine) => MC.recommend(tool.type === 'facemill' ? 'face' : 'finish')(tool, matKey, machine),
    conditions: H.conditionsWith({ tap: false }),
    validate,
    toolpath: () => ({ kind: 'path', spindle: 'cw' })
  });
  Object.assign(P, { faceMoves, faceRows: rows, FACE_PARAMS: PARAMS });
})(typeof globalThis !== 'undefined' ? globalThis : this);
