/* if 節點圖的版面計算:不依賴 DOM。 */
(function (root) {
  'use strict';

  /* nodes:analyzeIfs 的結果(可為其中一部分)。
     x = 巢狀層級;else if 與前一個 if 同一欄,排在它下面。y = 列(可為小數,有子節點時置中)。 */
  function layout(nodes) {
    var inScope = new Map(); nodes.forEach(function (n) { inScope.set(n.id, n); });
    var nested = new Map(), next = new Map(), roots = [];
    nodes.forEach(function (n) {
      if (n.prevId >= 0 && inScope.has(n.prevId)) { next.set(n.prevId, n); return; }
      if (n.parent >= 0 && inScope.has(n.parent)) {
        var l = nested.get(n.parent); if (!l) nested.set(n.parent, l = []); l.push(n);
      } else roots.push(n);
    });
    var row = 0, lastY = 0, pos = new Map(), edges = [], maxX = 0;

    function place(n, depth) {                       // 放一個節點(含它巢狀的子節點),回傳它的 y
      var kids = nested.get(n.id) || [], firstKid = null, lastKid = 0;
      kids.forEach(function (c) {
        var y = placeChain(c, depth + 1);
        if (firstKid === null) firstKid = y;
        lastKid = lastY;
        edges.push({ from: n.id, to: c.id, label: c.parentBranch, kind: 'nest' });
      });
      var y = kids.length ? (firstKid + lastKid) / 2 : row++;
      pos.set(n.id, { x: depth, y: y });
      if (depth > maxX) maxX = depth;
      lastY = y;
      return y;
    }
    function placeChain(head, depth) {               // 放 else if 鏈:同一欄由上往下,回傳頭的 y
      var headY = null;
      for (var cur = head; cur; cur = next.get(cur.id)) {
        var y = place(cur, depth);
        if (headY === null) headY = y;
        var nx = next.get(cur.id);
        if (nx) edges.push({ from: cur.id, to: nx.id, label: '假', kind: 'chain' });
      }
      return headY;
    }
    roots.forEach(function (r) { placeChain(r, 0); });
    return { pos: pos, edges: edges, cols: maxX + 1, rows: Math.max(row, 1) };
  }

  var api = { layout: layout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GraphCore = api;
})(typeof window !== 'undefined' ? window : this);
