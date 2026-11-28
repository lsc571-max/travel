/* =====================================================================
 * 푸른 AI CAM - [홀 가공 공통 모듈] ops/hole-common.js
 * 역할: 센터·드릴·펙·심공·탭·리지드 탭 모듈이 함께 쓰는 계산과 검증.
 *       (깊이 계산, 참고 절삭 조건, 추천 조건, 공통 검증, 모듈 정의 도우미)
 * 의존: engine/common.js, ops/registry.js
 * 공개: PCAM.HOLE
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { EPS, MATERIALS, toNum, r3, fmt, tipLength } = P;

  /* ---------- 깊이 계산 (Z0 = 소재 상면, 아래 방향이 +깊이) ---------- */
  const out = (depth, full, tip) => ({ depth: r3(depth), full: r3(full), tip: r3(tip), z: r3(-depth) });
  // 드릴 계열: 공구 끝 / 직경부(끝각 추가) / 관통(두께 + 여유 + 끝각)
  function drillDepth(op, tool, stock) {
    const tip = tipLength(tool);
    let depth, full;
    if (op.thru) { full = stock.sz + toNum(op.brk, 1); depth = full + tip; }
    else if (op.depthMode === 'full') { full = toNum(op.depth, 0); depth = full + tip; }
    else { depth = toNum(op.depth, 0); full = depth - tip; }
    return out(depth, full, tip);
  }
  // 탭 계열: 입력 깊이 또는 관통(두께 + 여유)
  function tapDepth(op, tool, stock) {
    const depth = op.thru ? stock.sz + toNum(op.brk, 1) : toNum(op.depth, 0);
    return out(depth, depth, tipLength(tool));
  }
  // 센터 드릴: 입력 깊이 그대로
  function plainDepth(op, tool) {
    const depth = toNum(op.depth, 0);
    return out(depth, depth, tipLength(tool));
  }

  /* ---------- 참고 절삭 조건 (Vc: m/min, fpr: mm/rev) ---------- */
  const mat = k => MATERIALS[k] || MATERIALS.S45C;
  function drillRef(tool, matKey) {
    const m = mat(matKey), carb = tool.mat === 'CARBIDE';
    return { vc: carb ? m.vcCarb : m.vcHss, fpr: (0.02 + 0.016 * tool.dia) * m.fFactor };
  }
  function spotRef(tool, matKey) {
    const r = drillRef(tool, matKey);
    return { vc: r.vc * 0.8, fpr: r.fpr * 0.5 };
  }
  // [V0.6] 리머: 드릴의 약 1/3 속도, 회전당 이송은 드릴보다 큼 / 보링(초경 인서트): 정삭 속도·작은 이송
  function reamRef(tool, matKey) {
    const m = mat(matKey), carb = tool.mat === 'CARBIDE';
    return { vc: (carb ? m.vcCarb : m.vcHss) * 0.35, fpr: (0.04 + 0.025 * tool.dia) * m.fFactor };
  }
  function boreRef(tool, matKey) {
    const m = mat(matKey);
    return { vc: m.emCarb * 0.6, fpr: 0.06 * m.fFactor };
  }
  function tapRef(tool, matKey) {
    const m = mat(matKey);
    return { vc: m.vcTap * (tool.mat === 'CARBIDE' ? 2 : 1), fpr: toNum(tool.pitch, 0) };
  }

  /* ---------- 추천 조건 (계산식 기반, AI 미사용) ---------- */
  // 회전수 = Vc·1000/(π·D) → 10 단위 반올림 → 장비 한계 제한
  function recommendWith(refFn, opts) {
    return function (tool, matKey, machine) {
      const ref = refFn(tool, matKey);
      let rpm = Math.max(10, Math.round(ref.vc * 1000 / (Math.PI * tool.dia) / 10) * 10);
      let limited = false;
      const maxR = opts.rigid ? Math.min(machine.maxRpm, machine.maxTapRpm || machine.maxRpm) : machine.maxRpm;
      if (rpm > maxR) { rpm = Math.floor(maxR / 10) * 10; limited = true; }
      let feed = opts.tap ? r3(rpm * toNum(tool.pitch, 0)) : Math.max(1, Math.round(rpm * ref.fpr));
      if (!opts.tap && feed > machine.maxFeed) { feed = machine.maxFeed; limited = true; }
      return { rpm, feed, limited };
    };
  }
  // 실제 사용 조건: 자동이면 추천값, 아니면 입력값. 탭은 항상 F = S × P (G94)
  function conditionsWith(opts) {
    return function (op, tool, matKey, machine) {
      let rpm, feed;
      if (op.auto && tool) { const r = P.recommend(op.type, tool, matKey, machine); rpm = r.rpm; feed = r.feed; }
      else { rpm = Math.round(toNum(op.rpm, 0)); feed = toNum(op.feed, 0); }
      if (opts.tap) feed = tool ? r3(rpm * toNum(tool.pitch, 0)) : 0;
      return { rpm, feed: r3(feed) };
    };
  }

  /* ---------- 공통 검증 (모든 홀 모듈) ----------
   * ctx: { op, oi, ops, tool, tm, d(깊이), c(조건), st(소재), set(설정), machine, under, on(이름), add(level, cat, msg) } */
  function validateConditions(ctx) {
    const { op, tool, c, machine, st, on, add } = ctx;
    if (!(c.rpm > 0)) add('error', 6, on + ': 주축 회전수(S)가 0 이하입니다.');
    else if (c.rpm > machine.maxRpm) add('error', 6, on + ': S' + c.rpm + ' 이(가) 장비 최대 회전수 ' + machine.maxRpm + ' 을 초과합니다.');
    if (!(c.feed > 0)) add('error', 6, on + ': 이송속도(F)가 0 이하입니다.');
    else if (c.feed > machine.maxFeed) add('error', 6, on + ': F' + c.feed + ' 이(가) 장비 최대 절삭 이송 ' + machine.maxFeed + ' 을 초과합니다.');
    if (op.auto === false && !Number.isInteger(toNum(op.rpm, 0))) add('warn', 6, on + ': 회전수는 정수로 출력됩니다 (S' + c.rpm + ').');
    const ref0 = P.refConditions(op.type, tool, st.material);
    if (c.rpm > 0 && ref0 && ref0.vc > 0) {
      const vc = Math.PI * tool.dia * c.rpm / 1000, ratio = vc / ref0.vc;
      if (ratio > 3) add('error', 6, on + ': 절삭속도 Vc ' + r3(vc) + ' m/min 이 참고값(' + r3(ref0.vc) + ')의 3배를 넘습니다 (비정상 조건).');
      else if (ratio > 1.5) add('warn', 6, on + ': 절삭속도 Vc ' + r3(vc) + ' m/min 이 참고값(' + r3(ref0.vc) + ')보다 높습니다.');
      else if (ratio < 0.2) add('warn', 6, on + ': 절삭속도 Vc ' + r3(vc) + ' m/min 이 매우 낮습니다.');
      if (!P.isTapOp(op.type) && c.feed > 0) {
        const fpr = c.feed / c.rpm, fr = fpr / ref0.fpr;
        if (fr > 3) add('error', 6, on + ': 회전당 이송 ' + r3(fpr) + ' mm/rev 가 참고값(' + r3(ref0.fpr) + ')의 3배를 넘습니다 (공구 파손 위험).');
        else if (fr > 1.6) add('warn', 6, on + ': 회전당 이송 ' + r3(fpr) + ' mm/rev 가 참고값(' + r3(ref0.fpr) + ')보다 큽니다.');
      }
    }
  }
  function validateDepth(ctx) {
    const { op, tool, d, st, under, on, add } = ctx;
    if (!(d.depth > 0)) add('error', 8, on + ': 가공 깊이가 0 이하입니다.');
    if (op.thru && !(toNum(op.brk, NaN) >= 0.5)) add('error', 8, on + ': 관통 여유는 0.5mm 이상이어야 합니다 (현재 ' + op.brk + ').');
    if (tool.flute > 0 && d.depth > tool.flute + EPS) add('error', 8, on + ': 깊이 ' + d.depth + ' 가 공구 유효 날 길이 ' + tool.flute + ' 을 초과합니다.');
    if (d.z < -(st.sz + under) - EPS) add('error', 8, on + ': 공구 끝 Z' + fmt(d.z) + ' 이(가) 소재 바닥 아래 허용 범위(하부 여유 ' + under + 'mm)를 넘습니다. 테이블/지그 충돌 위험 → ' + (op.thru ? '관통이면 하부 여유(패럴렐 틈)를 늘리거나 관통 여유를 줄이세요.' : '깊이를 줄이거나, 관통 구멍이면 [관통]을 체크하고 하부 여유(패럴렐 틈)를 입력하세요.'));
    else if (!op.thru && d.depth > st.sz + EPS) add('warn', 8, on + ': 깊이가 소재 두께를 넘습니다. 관통이면 "관통" 옵션을 사용하세요.');
  }
  function validateRPlane(ctx) {
    const { op, set, on, add } = ctx;
    const R = toNum(op.r, NaN);
    if (!(R >= 0.5)) add('error', 10, on + ': R점은 소재 상면 위 0.5mm 이상이어야 합니다.');
    else if (R < 1) add('warn', 10, on + ': R점 ' + R + 'mm 는 낮습니다 (1mm 이상 권장).');
    if (R >= set.initialZ) add('error', 10, on + ': R점(' + R + ')이 초기점 Z(' + set.initialZ + ') 이상입니다.');
  }
  function validateDwell(ctx) {
    const dw = toNum(ctx.op.dwell, 0);
    if (!(dw >= 0 && dw <= 5000)) ctx.add('error', 9, ctx.on + ': 드웰은 0~5000ms 범위여야 합니다.');
  }
  function validatePeck(ctx) {
    const { op, d, tool, on, add } = ctx;
    const q = toNum(op.q, 0);
    if (!(q >= 0.1)) add('error', 9, on + ': 펙 깊이 Q는 0.1mm 이상이어야 합니다.');
    else if (q >= d.depth) add('warn', 9, on + ': Q(' + q + ')가 전체 깊이 이상이라 펙 없이 한 번에 가공됩니다.');
    else if (q > tool.dia * 1.5) add('warn', 9, on + ': Q(' + q + ')가 공구 직경의 1.5배를 넘습니다.');
  }
  // 드릴 계열 공통: 직경부 형성, 센터 드릴 유무
  function validateDrillBody(ctx) {
    const { op, oi, ops, tool, d, on, add } = ctx;
    if (!op.thru && op.depthMode !== 'full' && d.full <= 0) add('error', 8, on + ': 깊이가 드릴 끝 원뿔 길이(' + d.tip + ')보다 작아 직경부가 형성되지 않습니다.');
    if (!ops.slice(0, oi).some(o => P.OPS.get(o.type) && P.OPS.get(o.type).role === 'spot') && tool.dia < 12) add('info', 5, on + ': 센터 드릴 공정 없이 드릴 가공합니다 (위치 정밀도 확인).');
  }

  // 홀 모듈 정의 도우미: 공통 검증 순서를 고정하고 모듈 전용 검증(extra)을 끼워 넣는다
  //  순서: 절삭 조건(6) → 모듈 전용(5·7·8·9) → 공통 깊이(8) → R점(10)
  function defineHoleOp(spec) {
    const role = spec.role;
    const ref = role === 'tap' ? tapRef : role === 'spot' ? spotRef : role === 'ream' ? reamRef : role === 'bore' ? boreRef : drillRef;
    const depth = role === 'tap' ? tapDepth : role === 'spot' || role === 'bore' ? plainDepth : drillDepth;
    const tap = role === 'tap';
    return Object.assign({
      family: 'hole', depth, ref,
      recommend: recommendWith(ref, { tap, rigid: !!spec.rigid }),
      conditions: conditionsWith({ tap }),
      validate(ctx) {
        validateConditions(ctx);
        if (spec.validateBefore) spec.validateBefore(ctx);
        validateDepth(ctx);
        if (spec.validateAfter) spec.validateAfter(ctx);
        validateRPlane(ctx);
      }
    }, spec);
  }

  P.HOLE = Object.freeze({ drillDepth, tapDepth, plainDepth, drillRef, spotRef, tapRef, reamRef, boreRef, recommendWith, conditionsWith,
    validateConditions, validateDepth, validateRPlane, validateDwell, validatePeck, validateDrillBody, defineHoleOp });
})(typeof globalThis !== 'undefined' ? globalThis : this);
