// 執行:node test-graph.js
const assert = require('assert');
const { analyzeIfs } = require('./ifs.js');
const { layout } = require('./graph.js');

// 1. 巢狀:內層在右一欄,外層置中於子節點
let n = analyzeIfs('if (p) {\n  if (q) { a(); }\n  if (r) { b(); }\n}');
let L = layout(n);
assert.strictEqual(L.cols, 2);
assert.strictEqual(L.pos.get(0).x, 0); assert.strictEqual(L.pos.get(1).x, 1);
assert.strictEqual(L.pos.get(0).y, 0.5, '外層應置中於兩個子節點');
assert.strictEqual(L.edges.filter(e => e.kind === 'nest').length, 2);

// 2. else if 鏈:同一欄,由上往下,邊標「假」
n = analyzeIfs('if (a == 1) { x(); } else if (a == 2) { y(); } else if (a == 3) { z(); }');
L = layout(n);
assert.strictEqual(L.cols, 1);
assert.deepStrictEqual([0, 1, 2].map(i => L.pos.get(i).y), [0, 1, 2]);
assert.ok(L.edges.every(e => e.kind === 'chain' && e.label === '假') && L.edges.length === 2);

// 3. 巢狀子節點本身是 else if 鏈的頭:鏈要完整排進去
n = analyzeIfs('if (p) {\n  if (a) { 1; } else if (b) { 2; } else if (c) { 3; }\n}');
L = layout(n);
assert.strictEqual(L.pos.size, 4, '4 個節點都要有位置');
assert.deepStrictEqual([1, 2, 3].map(i => L.pos.get(i).x), [1, 1, 1]);
const ys = [1, 2, 3].map(i => L.pos.get(i).y);
assert.ok(ys[0] < ys[1] && ys[1] < ys[2], JSON.stringify(ys));
assert.ok(L.pos.get(0).y >= ys[0] && L.pos.get(0).y <= ys[2]);

// 4. 只取一部分節點:外層不在範圍內就當成根,不會壞
n = analyzeIfs('if (p) {\n  if (q) { a(); }\n}');
L = layout([n[1]]);
assert.strictEqual(L.pos.size, 1); assert.strictEqual(L.pos.get(1).x, 0);

// 5. 空輸入
assert.strictEqual(layout([]).rows, 1);

console.log('all passed');
