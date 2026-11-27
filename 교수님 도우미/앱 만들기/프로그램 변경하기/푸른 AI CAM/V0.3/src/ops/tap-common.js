/* =====================================================================
 * 푸른 AI CAM - [가공 모듈] ops/tap-common.js
 * 역할: 일반 탭·리지드 탭 공통 검증 (피치, 기초 드릴, 탭 깊이, R점).
 * 의존: engine/common.js, ops/registry.js, ops/hole-common.js
 * 이 파일만 수정해도 다른 가공 모듈에는 영향이 없다 (공통 계산은 hole-common.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  const P = root.PCAM;
  const { EPS, r3, toNum } = P;
  // 피치·장비 지원 (7)
  function validatePitch(ctx) {
    const { tool, on, add } = ctx;
    if (!(tool.pitch > 0)) add('error', 7, on + ': 탭 피치가 없습니다.');
    else if (!P.standardPitch(tool.dia, tool.pitch)) add('warn', 7, on + ': M' + tool.dia + '×' + tool.pitch + ' 는 표준 미터 나사 피치가 아닙니다.');
  }
  // 기초 드릴 (5) 과 탭 깊이 (8), 탭 R점 (10)
  function validatePilot(ctx) {
    const { op, oi, ops, tool, tm, d, st, on, add } = ctx;
    const prev = ops.slice(0, oi).filter(o => P.isDrillOp(o.type) && tm.get(o.toolNo));
    if (!prev.length) add('error', 5, on + ': 탭 앞에 기초 드릴 공정이 없습니다.');
    else {
      // 직경이 허용 범위인 드릴 중 가장 깊은 것 (단차 드릴 대응). 없으면 마지막 드릴로 판정
      const okDia = o => { const t2 = tm.get(o.toolNo); return t2.dia >= tool.dia - 1.25 * tool.pitch - EPS && t2.dia < tool.dia - 0.5 * tool.pitch - EPS; };
      const cands = prev.filter(okDia);
      const depthOf = o => o.thru ? Infinity : P.opDepth(o, tm.get(o.toolNo), st).full;
      const dop = cands.length ? cands.reduce((a, o) => depthOf(o) >= depthOf(a) ? o : a) : prev[prev.length - 1];
      const dt = tm.get(dop.toolNo), dd = P.opDepth(dop, dt, st);
      const rec = P.tapDrill(tool.dia, tool.pitch);
      if (dt.dia < tool.dia - 1.25 * tool.pitch - EPS) add('error', 5, on + ': 기초 드릴 Ø' + dt.dia + ' 가 너무 작습니다 (탭 파손 위험, 추천 Ø' + (rec ? rec.dia : '-') + ').');
      else if (dt.dia >= tool.dia - 0.5 * tool.pitch - EPS) add('error', 5, on + ': 기초 드릴 Ø' + dt.dia + ' 가 너무 커서 나사산이 형성되지 않습니다 (추천 Ø' + (rec ? rec.dia : '-') + ').');
      else if (rec && Math.abs(dt.dia - rec.dia) > 0.1 + EPS) add('warn', 5, on + ': 기초 드릴 Ø' + dt.dia + ' 가 추천값 Ø' + rec.dia + ' 와 다릅니다.');
      if (op.thru && !dop.thru) add('error', 8, on + ': 탭은 관통인데 기초 드릴은 관통이 아닙니다.');
      else if (!dop.thru && !op.thru) {
        if (dd.full < d.depth - EPS) add('error', 8, on + ': 탭 깊이 ' + d.depth + ' 가 기초 드릴 직경부 깊이 ' + dd.full + ' 보다 깊습니다 (탭 파손 위험).');
        else if (dd.full < d.depth + 2 * tool.pitch - EPS) add('warn', 8, on + ': 기초 드릴 직경부 깊이 ' + dd.full + ' 가 탭 깊이 + 2피치(' + r3(d.depth + 2 * tool.pitch) + ')보다 얕습니다.');
      }
    }
    if (toNum(op.r, 0) < 3 * tool.pitch - EPS) add('warn', 10, on + ': 탭 R점은 3피치(' + r3(3 * tool.pitch) + 'mm) 이상 띄우는 것을 권장합니다.');
  }
  P.TAP = Object.freeze({ validatePitch, validatePilot });
})(typeof globalThis !== 'undefined' ? globalThis : this);
