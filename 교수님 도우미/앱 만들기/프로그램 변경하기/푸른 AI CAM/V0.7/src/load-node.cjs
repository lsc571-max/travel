// Node.js(테스트)에서 브라우저와 같은 순서로 모듈을 불러와 PCAM 객체를 돌려준다.
'use strict';
const path = require('path');
const list = require('./modules.json').core;
const prev = globalThis.PCAM;
delete globalThis.PCAM;
list.forEach(f => { const p = path.join(__dirname, f); delete require.cache[require.resolve(p)]; require(p); });
module.exports = globalThis.PCAM;
if (prev) globalThis.PCAM = prev;
