/* if 清單與測試項目:不依賴 DOM,瀏覽器與 node 都能載入。 */
(function (root) {
  'use strict';
  var core = (typeof require === 'function') ? require('./core.js') : root.DupCore;

  /* 把註解與字串內容換成空白(長度不變),掃描結構時就不會被它們干擾。 */
  function mask(text) {
    var out = [], i = 0, n = text.length, c, d;
    while (i < n) {
      c = text[i]; d = text[i + 1];
      if (c === '/' && d === '/') { while (i < n && text[i] !== '\n') { out.push(' '); i++; } continue; }
      if (c === '/' && d === '*') {
        out.push('  '); i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out.push(text[i] === '\n' ? '\n' : ' '); i++; }
        if (i < n) { out.push('  '); i += 2; }
        continue;
      }
      if (c === '@' && d === '"') {
        out.push('@"'); i += 2;
        while (i < n) {
          if (text[i] === '"') { if (text[i + 1] === '"') { out.push('  '); i += 2; continue; } break; }
          out.push(text[i] === '\n' ? '\n' : ' '); i++;
        }
        if (i < n) { out.push('"'); i++; }
        continue;
      }
      if (c === '"' || c === "'") {
        out.push(c); i++;
        while (i < n && text[i] !== c && text[i] !== '\n') {
          if (text[i] === '\\') { out.push(i + 1 < n ? '  ' : ' '); i += 2; continue; }
          out.push(' '); i++;
        }
        if (i < n && text[i] === c) { out.push(c); i++; }
        continue;
      }
      out.push(c); i++;
    }
    return out.join('');
  }

  function matchClose(m, openPos, o, c) {
    var d = 0;
    for (var i = openPos; i < m.length; i++) {
      if (m[i] === o) d++;
      else if (m[i] === c) { d--; if (d === 0) return i; }
    }
    return -1;
  }

  /* ---- 結構掃描:找出每個 if 的範圍、else、else if ---- */
  function scanIfs(m) {
    var memo = {};
    function skipWs(p) { while (p < m.length && /\s/.test(m[p])) p++; return p; }
    function isIfAt(p) {
      var re = /if\s*\(/y; re.lastIndex = p;
      return re.test(m) && !(p > 0 && /[\w#.]/.test(m[p - 1]));
    }
    function stmtEnd(p) {
      p = skipWs(p);
      if (p >= m.length) return p;
      if (m[p] === '{') { var c = matchClose(m, p, '{', '}'); return c < 0 ? m.length : c + 1; }
      if (isIfAt(p)) return parseIf(p).end;
      var d = 0, sawBrace = false;
      for (var i = p; i < m.length; i++) {
        var ch = m[i];
        if (ch === '(' || ch === '[' || ch === '{') { d++; if (ch === '{') sawBrace = true; }
        else if (ch === ')' || ch === ']' || ch === '}') {
          d--;
          if (d < 0) return i;
          if (d === 0 && ch === '}' && sawBrace) {
            var q = skipWs(i + 1);
            if (!/^(catch|finally|else|while)\b/.test(m.substr(q, 8))) return i + 1;
          }
        } else if (ch === ';' && d === 0) return i + 1;
      }
      return m.length;
    }
    function parseIf(p) {
      if (memo[p]) return memo[p];
      var res = memo[p] = { start: p, hasElse: false, elseIf: -1 };
      var open = m.indexOf('(', p), close = matchClose(m, open, '(', ')');
      res.open = open; res.close = close;
      if (close < 0) { res.bodyEnd = res.end = m.length; return res; }
      res.bodyEnd = res.end = stmtEnd(close + 1);
      var q = skipWs(res.bodyEnd);
      if (/^else(?![\w])/.test(m.substr(q, 5))) {
        res.hasElse = true;
        var r = skipWs(q + 4);
        if (isIfAt(r)) res.elseIf = r;
        res.end = stmtEnd(r);
      }
      return res;
    }
    var list = [], re = /\bif\s*\(/g, x;
    while ((x = re.exec(m)) !== null) {
      if (x.index > 0 && m[x.index - 1] === '#') continue;
      list.push(parseIf(x.index));
    }
    return list;
  }

  /* ---- 條件解析成布林樹(&& || ! 與括號),無法解析就當成單一子條件 ---- */
  function parseExpr(m, o) {
    var pos = 0, count = 0, seen = Object.create(null);
    function ws() { while (pos < m.length && /\s/.test(m[pos])) pos++; }
    function isOp() { return m.substr(pos, 2) === '&&' || m.substr(pos, 2) === '||'; }
    function or() {
      var l = [and()]; ws();
      while (m.substr(pos, 2) === '||') { pos += 2; l.push(and()); ws(); }
      return l.length === 1 ? l[0] : { t: 'or', k: l };
    }
    function and() {
      var l = [not()]; ws();
      while (m.substr(pos, 2) === '&&') { pos += 2; l.push(not()); ws(); }
      return l.length === 1 ? l[0] : { t: 'and', k: l };
    }
    function not() {
      ws();
      if (m[pos] === '!' && m[pos + 1] !== '=') { pos++; return { t: 'not', k: not() }; }
      if (m[pos] === '(') {
        var save = pos, saveCount = count, saveSeen = Object.assign(Object.create(null), seen);
        pos++;
        try {
          var e = or(); ws();
          if (m[pos] === ')') {
            pos++; ws();
            if (pos >= m.length || isOp() || m[pos] === ')') return e;
          }
        } catch (err) { /* 當成一般子條件重來 */ }
        pos = save; count = saveCount; seen = saveSeen;
      }
      return atom();
    }
    function atom() {
      ws();
      var s = pos, d = 0;
      while (pos < m.length) {
        var c = m[pos];
        if (c === '(' || c === '[' || c === '{') d++;
        else if (c === ')' || c === ']' || c === '}') { if (d === 0) break; d--; }
        else if (d === 0 && isOp()) break;
        pos++;
      }
      var text = o.slice(s, pos).trim();
      if (!text) throw new Error('empty');
      if (!(text in seen)) seen[text] = count++;   // 文字相同的子條件視為同一個變數
      return { t: 'atom', text: text, id: seen[text] };
    }
    try {
      var tree = or(); ws();
      if (pos < m.length) throw new Error('trailing');
      return { tree: tree, n: count };
    } catch (err) {
      return { tree: { t: 'atom', text: o.trim(), id: 0 }, n: 1 };
    }
  }

  function ev(t, v) {
    if (t.t === 'atom') return v[t.id];
    if (t.t === 'not') return !ev(t.k, v);
    if (t.t === 'and') return t.k.every(function (x) { return ev(x, v); });
    return t.k.some(function (x) { return ev(x, v); });
  }
  function atomsOf(t, out) {
    if (t.t === 'atom') out[t.id] = t.text; else (t.k.length ? t.k : [t.k]).forEach(function (x) { atomsOf(x, out); });
    return out;
  }

  /* MC/DC:每個子條件都找一對「只有它不同、結果也不同」的組合,盡量共用組合。 */
  function mcdc(tree, n) {
    var N = 1 << n, res = [], mask, i;
    for (mask = 0; mask < N; mask++) {
      var vals = []; for (i = 0; i < n; i++) vals.push(!!((mask >> i) & 1));
      res.push(ev(tree, vals));
    }
    var chosen = new Set(), unused = [];
    for (i = 0; i < n; i++) {
      var best = null, bestScore = -1;
      for (mask = 0; mask < N; mask++) {
        if ((mask >> i) & 1) continue;
        var m2 = mask | (1 << i);
        if (res[mask] === res[m2]) continue;
        var score = (chosen.has(mask) ? 1 : 0) + (chosen.has(m2) ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = [mask, m2]; }
      }
      if (best) { chosen.add(best[0]); chosen.add(best[1]); } else unused.push(i);
    }
    [true, false].forEach(function (want) {
      var has = false; chosen.forEach(function (k) { if (res[k] === want) has = true; });
      if (!has) for (mask = 0; mask < N; mask++) if (res[mask] === want) { chosen.add(mask); break; }
    });
    var vectors = Array.from(chosen).sort(function (a, b) { return a - b; }).map(function (k) {
      var vals = []; for (var j = 0; j < n; j++) vals.push(!!((k >> j) & 1));
      return { vals: vals, result: res[k] };
    });
    return { vectors: vectors, unused: unused };
  }

  /* ---- 邊界值與特殊值提示 ---- */
  var NUM = /^-?\d+(\.\d+)?[mMfFdDlLuU]*$/;
  function hintsFor(atom) {
    var a = atom.trim(), mt;
    if ((mt = /^(.+?)\s*(==|!=)\s*null$/.exec(a)) || (mt = /^null\s*(==|!=)\s*(.+)$/.exec(a))) {
      var who = mt[1] === '==' || mt[1] === '!=' ? mt[2] : mt[1];
      return ['`' + who + '`:null、非 null 各一組'];
    }
    if ((mt = /(IsNullOrEmpty|IsNullOrWhiteSpace)\s*\(\s*([^)]*?)\s*\)/.exec(a))) {
      var extra = mt[1] === 'IsNullOrWhiteSpace' ? '、只有空白' : '';
      return ['`' + mt[2] + '`:null、空字串' + extra + '、有內容'];
    }
    if ((mt = /^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/.exec(a))) {
      var lhs = mt[1], op = mt[2], rhs = mt[3];
      if (NUM.test(rhs)) {
        var c = parseFloat(rhs), dec = /[.mMfFdD]/.test(rhs), lo = dec ? '略小於 ' + c : String(c - 1), hi = dec ? '略大於 ' + c : String(c + 1);
        var pairs = {
          '>': [[c, '假'], [hi, '真']], '>=': [[lo, '假'], [c, '真']], '<': [[lo, '真'], [c, '假']],
          '<=': [[c, '真'], [hi, '假']], '==': [[c, '真'], [lo, '假']], '!=': [[c, '假'], [hi, '真']]
        }[op];
        return ['`' + lhs + '` 的邊界:' + pairs.map(function (p) { return '取 ' + p[0] + ' → ' + p[1]; }).join(';')];
      }
      if (op === '==' || op === '!=') return ['`' + lhs + '` 與 `' + rhs + '`:各測「相等」與「不相等」'];
      return ['`' + lhs + '` 與 `' + rhs + '`:各測「相等、略大、略小」'];
    }
    return [];
  }

  function lineStarts(text) {
    var s = [0];
    for (var i = 0; i < text.length; i++) if (text[i] === '\n') s.push(i + 1);
    return s;
  }
  function lineOf(starts, pos) {
    var lo = 0, hi = starts.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  }

  function buildTests(cond, masked) {
    var parsed = parseExpr(masked, cond);
    var atoms = atomsOf(parsed.tree, []);
    var t = { atoms: atoms, vectors: [], hints: [], notes: [] };
    if (parsed.n > 8) {
      t.notes.push('子條件超過 8 個,不自動產生組合。建議先把條件拆成幾個有名字的布林變數或方法。');
    } else {
      var r = mcdc(parsed.tree, parsed.n);
      t.vectors = r.vectors;
      r.unused.forEach(function (i) { t.notes.push('`' + atoms[i] + '` 無法獨立改變整體結果(可能多餘或被其他條件蓋住),值得檢查。'); });
    }
    atoms.forEach(function (a) { t.hints = t.hints.concat(hintsFor(a)); });
    return t;
  }

  function analyzeIfs(text, opt) {
    opt = opt || {};
    var m = mask(text), found = scanIfs(m), starts = lineStarts(text);
    var byStart = {}, prev = {};
    found.forEach(function (f) { byStart[f.start] = f; if (f.elseIf >= 0) prev[f.elseIf] = f.start; });
    function head(f) { while (prev[f.start] !== undefined) f = byStart[prev[f.start]]; return f; }
    function preds(f) { var l = []; while (prev[f.start] !== undefined) { f = byStart[prev[f.start]]; l.unshift(f); } return l; }

    var infos = found.map(function (f, k) {
      var cond = text.slice(f.open + 1, f.close < 0 ? text.length : f.close).replace(/\s+/g, ' ').trim();
      return { id: k, f: f, line: lineOf(starts, f.start), endLine: lineOf(starts, Math.max(f.start, f.end - 1)),
               cond: cond, isElseIf: prev[f.start] !== undefined, hasElse: f.hasElse && f.elseIf < 0,
               hasElseIf: f.elseIf >= 0 };
    });
    var byF = new Map(); infos.forEach(function (i) { byF.set(i.f, i); });

    function parentOf(info) {
      var h = head(info.f), best = null;
      infos.forEach(function (p) {
        if (p.f === h || !(p.f.start < h.start && h.start < p.f.end)) return;
        if (!best || (p.f.end - p.f.start) < (best.f.end - best.f.start)) best = p;
      });
      return best ? { info: best, branch: h.start < best.f.bodyEnd } : null;
    }
    function reqs(info) {
      var list = [], chain = [], cur = parentOf(info);
      while (cur) { chain.unshift(cur); cur = parentOf(cur.info); }
      chain.forEach(function (c) {
        preds(c.info.f).forEach(function (pi) { list.push('第 ' + byF.get(pi).line + ' 行 `if (' + byF.get(pi).cond + ')` 為假'); });
        list.push('第 ' + c.info.line + ' 行 `if (' + c.info.cond + ')` 為' + (c.branch ? '真' : '假'));
      });
      preds(info.f).forEach(function (pi) { list.push('第 ' + byF.get(pi).line + ' 行 `if (' + byF.get(pi).cond + ')` 為假'); });
      return list;
    }

    var groups = new Map();
    infos.forEach(function (i) {
      var pr = parentOf(i);
      i.parent = pr ? pr.info.id : -1;                       // 巢狀的外層 if(else if 取鏈頭的外層)
      i.parentBranch = pr ? (pr.branch ? '真' : '假') : '';
      i.prevId = prev[i.f.start] !== undefined ? byF.get(byStart[prev[i.f.start]]).id : -1;   // else if 鏈的前一個
      i.requires = reqs(i);
      i.depth = i.requires.length ? parentDepth(i) : 0;
      i.tests = buildTests(text.slice(i.f.open + 1, i.f.close < 0 ? text.length : i.f.close), m.slice(i.f.open + 1, i.f.close < 0 ? text.length : i.f.close));
      i.key = core.normLine(i.cond, !!opt.ignoreNames);
      var g = groups.get(i.key); if (!g) groups.set(i.key, g = []); g.push(i);
    });
    function parentDepth(info) { var d = 0, c = parentOf(info); while (c) { d++; c = parentOf(c.info); } return d; }
    infos.forEach(function (i) {
      var g = groups.get(i.key);
      i.groupSize = g.length;
      i.sameLines = g.filter(function (x) { return x !== i; }).map(function (x) { return x.line; });
      delete i.f;
    });
    return infos;
  }

  function formatText(i) {
    var L = [];
    L.push('第 ' + i.line + ' 行  if (' + i.cond + ')' + (i.hasElse ? '  [有 else]' : '') + (i.hasElseIf ? '  [接 else if]' : '') + (i.isElseIf ? '  [本身是 else if]' : ''));
    if (i.requires.length) L.push('  前置條件:' + i.requires.join(';'));
    if (i.groupSize > 1) L.push('  相同條件共 ' + i.groupSize + ' 處,另在第 ' + i.sameLines.join('、') + ' 行');
    i.tests.vectors.forEach(function (v, k) {
      var parts = v.vals.map(function (b, j) { return (i.tests.atoms.length > 1 ? '[' + i.tests.atoms[j] + ']' : '') + '=' + (b ? '真' : '假'); });
      var go = v.result ? '進入 if 主體' : (i.hasElse ? '進入 else' : (i.hasElseIf ? '往下一個 else if' : '略過 if'));
      L.push('  測試 ' + (k + 1) + ':' + (i.tests.atoms.length > 1 ? parts.join(', ') : '條件' + (v.result ? '為真' : '為假')) + ' → ' + go);
    });
    i.tests.hints.forEach(function (h) { L.push('  邊界:' + h); });
    i.tests.notes.forEach(function (h) { L.push('  注意:' + h); });
    return L.join('\n');
  }

  var api = { analyzeIfs: analyzeIfs, formatText: formatText, mask: mask, parseExpr: parseExpr, hintsFor: hintsFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IfCore = api;
})(typeof window !== 'undefined' ? window : this);
