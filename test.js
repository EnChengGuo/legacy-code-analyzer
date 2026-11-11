// 執行:node test.js
const assert = require('assert');
const core = require('./core.js');
const sample = require('./sample.js');

const opt = { minLines: 10, gap: 3, minSim: 0.6, ignoreNames: true };

// 1. 範例:命名不同、else 多一行,應被視為同一組的兩處
let r = core.analyze(sample, opt);
assert.strictEqual(r.groups.length, 1, '應找到 1 組');
assert.strictEqual(r.groups[0].members.length, 2, '應有 2 處');
assert.ok(r.groups[0].matched >= 20, '配對行數應 >= 20,實際 ' + r.groups[0].matched);

// 2. diff 應標出 else 多的那一行
const g = r.groups[0], [m1, m2] = g.members;
const ops = core.diffLines(r.lines.slice(m1.from, m1.to + 1), r.lines.slice(m2.from, m2.to + 1));
const added = ops.filter(o => o.t === 'add').map(o => o.b.raw.trim());
assert.ok(added.includes('o.IsVip = true;'), '多出的一行應被標為新增:' + JSON.stringify(added));
assert.ok(ops.some(o => o.t === 'ren'), '命名不同的行應標為 ren');

// 3. 關閉「忽略命名」後,命名不同的複本不再相同,應比較難找到
r = core.analyze(sample, { ...opt, ignoreNames: false, minLines: 15 });
assert.strictEqual(r.groups.length, 0, '嚴格比對下不應找到 15 行以上的組');

// 4. 門檻:minLines 太高找不到
r = core.analyze(sample, { ...opt, minLines: 60 });
assert.strictEqual(r.groups.length, 0);

// 5. 三份複本應合成一組、3 處
const three = [sample, sample, sample].join('\n\n');
r = core.analyze(three, { ...opt, minLines: 20 });
assert.ok(r.groups.some(x => x.members.length >= 3), '三份複本應有 >= 3 處的組');

console.log('all passed');
