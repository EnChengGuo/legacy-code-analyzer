// 執行:node test-ifs.js
const assert = require('assert');
const { analyzeIfs, formatText } = require('./ifs.js');

const run = (code, opt) => analyzeIfs(code, opt || {});

// 1. 基本:行號、條件、else
let r = run('void F(){\n  if (a > 0)\n  {\n    x();\n  }\n  else\n  {\n    y();\n  }\n}');
assert.strictEqual(r.length, 1);
assert.strictEqual(r[0].line, 2);
assert.strictEqual(r[0].cond, 'a > 0');
assert.strictEqual(r[0].hasElse, true);
assert.strictEqual(r[0].tests.vectors.length, 2);
assert.ok(r[0].tests.hints[0].includes('取 0 → 假') && r[0].tests.hints[0].includes('取 1 → 真'), r[0].tests.hints[0]);

// 2. 複合條件:a && (b || c) 的 MC/DC 組合數 = 子條件數 + 1 = 4
r = run('if (a && (b || c)) { x(); }');
assert.deepStrictEqual(r[0].tests.atoms, ['a', 'b', 'c']);
assert.strictEqual(r[0].tests.vectors.length, 4, JSON.stringify(r[0].tests.vectors));
assert.ok(r[0].tests.vectors.some(v => v.result) && r[0].tests.vectors.some(v => !v.result));

// 3. else if 鏈:前置條件包含前面的 if 為假
r = run('if (a == 1) { x(); } else if (a == 2) { y(); } else { z(); }');
assert.strictEqual(r.length, 2);
assert.strictEqual(r[0].hasElseIf, true);
assert.strictEqual(r[1].isElseIf, true);
assert.strictEqual(r[1].hasElse, true);
assert.ok(r[1].requires[0].includes('a == 1') && r[1].requires[0].endsWith('為假'), r[1].requires[0]);

// 4. 巢狀:內層要求外層為真;在 else 內則為假
r = run('if (p) {\n  if (q) { a(); }\n} else {\n  if (s) { b(); }\n}');
assert.strictEqual(r.length, 3);
assert.strictEqual(r[1].depth, 1); assert.ok(r[1].requires[0].endsWith('為真'));
assert.strictEqual(r[2].depth, 1); assert.ok(r[2].requires[0].endsWith('為假'));

// 5. 字串、註解、#if 內的 if 不算
r = run('var s = "if (x) {}";\n// if (y) { }\n/* if (z) {} */\n#if DEBUG\nif (real) { go(); }');
assert.strictEqual(r.length, 1); assert.strictEqual(r[0].cond, 'real');

// 6. 條件跨多行、含括號與字串裡的 &&
r = run('if (Foo(a, b)\n    && s == "x && y")\n{ go(); }');
assert.strictEqual(r.length, 1);
assert.deepStrictEqual(r[0].tests.atoms, ['Foo(a, b)', 's == "x && y"']);

// 7. 沒有大括號的單行 if
r = run('if (a) x(); else y();\nif (b) z();');
assert.strictEqual(r.length, 2);
assert.strictEqual(r[0].hasElse, true); assert.strictEqual(r[1].hasElse, false);

// 8. 相同條件分組:空白不同算同一組;忽略命名時 a>0 與 b>0 同組
r = run('if (a>0) { x(); }\nif ( a > 0 ) { y(); }\nif (b > 0) { z(); }');
assert.strictEqual(r[0].groupSize, 2); assert.deepStrictEqual(r[0].sameLines, [2]);
assert.strictEqual(r[2].groupSize, 1);
r = run('if (a>0) { x(); }\nif (b > 0) { z(); }', { ignoreNames: true });
assert.strictEqual(r[0].groupSize, 2);

// 9. null 與字串檢查的提示
r = run('if (s == null || string.IsNullOrEmpty(t)) { }');
assert.ok(r[0].tests.hints.some(h => h.includes('null、非 null')));
assert.ok(r[0].tests.hints.some(h => h.includes('空字串')));

// 10. 否定與冗餘子條件
r = run('if (!(a && b)) { }');
assert.strictEqual(r[0].tests.vectors.length, 3);
r = run('if (a || !a) { }');
assert.ok(r[0].tests.notes.length >= 1, '恆真條件應提示子條件無法獨立改變結果');

// 10b. 非數字的 == 只提示相等/不相等;大小比較才提示略大略小
assert.ok(run('if (s.Status == Status.Paid) { }')[0].tests.hints[0].includes('「相等」與「不相等」'));
assert.ok(run('if (x > y) { }')[0].tests.hints[0].includes('略大'));

// 11. 輸出文字可讀
assert.ok(formatText(run('if (a && b) { }\n')[0]).includes('測試 1'));

console.log('all passed');
