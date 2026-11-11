/* 重複程式碼偵測核心:不依賴 DOM,瀏覽器與 node 都能載入。 */
(function (root) {
  'use strict';

  var KW = new Set(('abstract as base bool break byte case catch char checked class const continue decimal ' +
    'default delegate do double else enum event explicit extern false finally fixed float for foreach goto if ' +
    'implicit in int interface internal is lock long namespace new null object operator out override params ' +
    'private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct ' +
    'switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while ' +
    'var async await get set value').split(' '));

  var TOKEN = /\/\/.*$|@?"(?:[^"\\]|\\.)*"|'(?:\\.|[^'\\])'|\b\d[\w.]*|[A-Za-z_]\w*|\s+/g;

  function normLine(s, ignoreNames) {
    return s.replace(TOKEN, function (m) {
      if (m.charAt(0) === '/' && m.charAt(1) === '/') return '';
      if (/^\s+$/.test(m)) return '';
      var c = m.charAt(0);
      if (c === '"' || c === '@' || c === "'") return ignoreNames ? 'S' : m;
      if (c >= '0' && c <= '9') return ignoreNames ? 'N' : m;
      if (KW.has(m)) return m;
      return ignoreNames ? 'I' : m;
    });
  }

  /* 逐行解析。keep=false 的行(空行、註解、純括號)不參與比對,但會留在 diff 顯示裡。 */
  function parse(text, ignoreNames) {
    text = text.replace(/\/\*[\s\S]*?\*\//g, function (m) { return m.replace(/[^\n]/g, ''); });
    var raw = text.split(/\r?\n/), lines = [], kept = [];
    for (var i = 0; i < raw.length; i++) {
      var norm = normLine(raw[i], ignoreNames);
      var keep = norm !== '' && !/^[{}();,]*$/.test(norm);
      var l = { no: i + 1, raw: raw[i], norm: norm, keep: keep, idx: i };
      lines.push(l);
      if (keep) kept.push(l);
    }
    return { lines: lines, kept: kept };
  }

  /* 找出近似重複的區塊配對。回傳 {pairs, truncated}。 */
  function findPairs(kept, opt) {
    var K = opt.seed || 5, gap = opt.gap, minLines = opt.minLines, minSim = opt.minSim;
    var n = kept.length, buckets = new Map(), i, j;
    for (i = 0; i + K <= n; i++) {
      var parts = [];
      for (j = 0; j < K; j++) parts.push(kept[i + j].norm);
      var key = parts.join('\u0001');
      var b = buckets.get(key);
      if (b) b.push(i); else buckets.set(key, [i]);
    }
    var diag = new Map(), truncated = false;
    buckets.forEach(function (idx) {
      if (idx.length < 2) return;
      if (idx.length > 200) { truncated = true; return; }
      for (var p = 0; p < idx.length; p++) {
        for (var q = p + 1; q < idx.length; q++) {
          var d = idx[q] - idx[p];
          if (d < K) continue;
          var arr = diag.get(d);
          if (arr) arr.push(idx[p]); else diag.set(d, [idx[p]]);
        }
      }
    });
    var runs = [];
    diag.forEach(function (arr, d) {
      arr.sort(function (x, y) { return x - y; });
      var s = arr[0], e = arr[0] + K;
      for (var t = 1; t < arr.length; t++) {
        if (arr[t] <= e) e = Math.max(e, arr[t] + K);
        else { runs.push({ a: s, b: s + d, len: e - s }); s = arr[t]; e = arr[t] + K; }
      }
      runs.push({ a: s, b: s + d, len: e - s });
    });
    runs.sort(function (x, y) { return x.a - y.a || x.b - y.b; });

    var active = [], chains = [];
    runs.forEach(function (r) {
      active = active.filter(function (c) { return c.aEnd >= r.a - gap; });
      var hit = null;
      for (var c = active.length - 1; c >= 0; c--) {
        var ch = active[c], ga = r.a - ch.aEnd, gb = r.b - ch.bEnd;
        if (ga >= 0 && ga <= gap && gb >= 0 && gb <= gap) { hit = ch; break; }
      }
      if (hit) {
        hit.aEnd = r.a + r.len; hit.bEnd = r.b + r.len; hit.matched += r.len;
      } else {
        var nc = { a0: r.a, aEnd: r.a + r.len, b0: r.b, bEnd: r.b + r.len, matched: r.len };
        chains.push(nc); active.push(nc);
      }
    });

    // 連續出現的複本(甲乙丙相鄰)會落在同一條對角線上,範圍與自己重疊,要切成一份一份。
    var expanded = [];
    chains.forEach(function (c) {
      if (c.aEnd <= c.b0) { expanded.push(c); return; }
      var d = c.b0 - c.a0, total = c.aEnd - c.a0;
      for (var s = 0; s < total; s += d) {
        var len = Math.min(d, total - s);
        expanded.push({ a0: c.a0 + s, aEnd: c.a0 + s + len, b0: c.a0 + s + d, bEnd: c.a0 + s + d + len,
                        matched: Math.round(c.matched * len / total) });
      }
    });
    var cand = expanded.filter(function (c) {
      if (c.matched < minLines) return false;
      c.sim = c.matched / Math.max(c.aEnd - c.a0, c.bEnd - c.b0);
      return c.sim >= minSim;
    }).sort(function (x, y) { return y.matched - x.matched; });

    function inside(s, e, S, E) { return s >= S && e <= E; }
    var pairs = [];
    cand.forEach(function (c) {
      for (var k = 0; k < pairs.length; k++) {
        var q = pairs[k];
        if ((inside(c.a0, c.aEnd, q.a0, q.aEnd) && inside(c.b0, c.bEnd, q.b0, q.bEnd)) ||
            (inside(c.a0, c.aEnd, q.b0, q.bEnd) && inside(c.b0, c.bEnd, q.a0, q.aEnd))) return;
      }
      pairs.push(c);
    });
    return { pairs: pairs, truncated: truncated };
  }

  /* 把配對合併成組:同一段程式出現在多個配對時,視為同一組的多處。 */
  function cluster(pairs) {
    var nodes = [], parent = [];
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(x, y) { x = find(x); y = find(y); if (x !== y) parent[y] = x; }
    function node(s, e) {
      for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i], ov = Math.min(e, nd.e) - Math.max(s, nd.s);
        if (ov > 0 && ov >= 0.6 * Math.min(e - s, nd.e - nd.s)) return i;
      }
      nodes.push({ s: s, e: e }); parent.push(nodes.length - 1);
      return nodes.length - 1;
    }
    var edges = pairs.map(function (p) {
      var x = node(p.a0, p.aEnd), y = node(p.b0, p.bEnd);
      union(x, y);
      return { x: x, y: y, p: p };
    });
    var groups = new Map();
    edges.forEach(function (ed) {
      var r = find(ed.x), g = groups.get(r);
      if (!g) { g = { ids: new Set(), best: ed.p }; groups.set(r, g); }
      g.ids.add(ed.x); g.ids.add(ed.y);
      if (ed.p.matched > g.best.matched) g.best = ed.p;
    });
    var out = [];
    groups.forEach(function (g) {
      var members = Array.from(g.ids).map(function (id) { return nodes[id]; })
        .sort(function (a, b) { return a.s - b.s; });
      out.push({ members: members, lines: members[0].e - members[0].s, matched: g.best.matched, sim: g.best.sim });
    });
    out.sort(function (a, b) { return b.members.length * b.lines - a.members.length * a.lines; });
    return out;
  }

  /* 兩段原始行的並排比對。回傳 ops 或 null(太大)。 */
  function diffLines(A, B) {
    var n = A.length, m = B.length;
    if (n * m > 9e6) return null;
    function key(l) { return l.norm !== '' ? l.norm : '#' + l.raw.trim(); }
    var ka = A.map(key), kb = B.map(key), w = m + 1, t = new Uint16Array((n + 1) * w), i, j;
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        t[i * w + j] = ka[i] === kb[j] ? t[(i + 1) * w + j + 1] + 1
          : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
      }
    }
    var ops = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (ka[i] === kb[j]) {
        ops.push({ t: A[i].raw.trim() === B[j].raw.trim() ? 'eq' : 'ren', a: A[i], b: B[j] }); i++; j++;
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) { ops.push({ t: 'del', a: A[i] }); i++; }
      else { ops.push({ t: 'add', b: B[j] }); j++; }
    }
    while (i < n) ops.push({ t: 'del', a: A[i++] });
    while (j < m) ops.push({ t: 'add', b: B[j++] });
    return ops;
  }

  function analyze(text, opt) {
    var parsed = parse(text, opt.ignoreNames);
    var res = findPairs(parsed.kept, opt);
    var groups = cluster(res.pairs).map(function (g) {
      g.members = g.members.map(function (m) {
        return { s: m.s, e: m.e, from: parsed.kept[m.s].idx, to: parsed.kept[m.e - 1].idx };
      });
      return g;
    });
    return { lines: parsed.lines, keptCount: parsed.kept.length, groups: groups, truncated: res.truncated };
  }

  var api = { normLine: normLine, parse: parse, findPairs: findPairs, cluster: cluster, diffLines: diffLines, analyze: analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DupCore = api;
})(typeof window !== 'undefined' ? window : this);
