/* util.js — 日付・時刻・DOMの小道具。外部ライブラリ不使用 */
var U = (function () {

  function pad(n) { return String(n).padStart(2, '0'); }

  /** 'YYYY-MM-DD' を作る */
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  /** 'YYYY-MM-DD' → {y,m,d} */
  function parseYmd(s) {
    var p = s.split('-');
    return { y: +p[0], m: +p[1], d: +p[2] };
  }

  /** その月の日数 */
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

  /** 曜日 0=日 … 6=土 */
  function weekdayOf(dateStr) {
    var p = parseYmd(dateStr);
    return new Date(p.y, p.m - 1, p.d).getDay();
  }

  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  /** 月の全日付配列 */
  function monthDates(y, m) {
    var out = [], n = daysInMonth(y, m);
    for (var d = 1; d <= n; d++) out.push(ymd(y, m, d));
    return out;
  }

  /** dateStr の n 日後（負も可） */
  function addDays(dateStr, n) {
    var p = parseYmd(dateStr);
    var dt = new Date(p.y, p.m - 1, p.d + n);
    return ymd(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
  }

  /** 'HH:MM' → 分 */
  function hm2min(s) {
    var p = String(s).split(':');
    return (+p[0]) * 60 + (+p[1] || 0);
  }

  /** 分 → 'H:MM' */
  function min2hm(v) {
    var sign = v < 0 ? '-' : ''; v = Math.abs(v);
    return sign + Math.floor(v / 60) + ':' + pad(v % 60);
  }

  /** 分 → '7.5h' 表記 */
  function min2h(v) { return (Math.round(v / 6) / 10).toFixed(1); }

  /** 2区間の重なり分数 */
  function overlap(a1, a2, b1, b2) {
    return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  }

  /** 通貨表記 */
  function yen(v) { return '¥' + Math.round(v).toLocaleString('ja-JP'); }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function uid(prefix) {
    UID_SEQ++;
    return (prefix || 'id') + '_' + UID_SEQ.toString(36) + '_' + (UID_BASE++).toString(36);
  }
  var UID_SEQ = 0, UID_BASE = 1000;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /** 数値入力の安全化：空欄・NaN・範囲外を既定値/範囲内に丸める */
  function num(v, min, max, def) {
    var n = parseFloat(v);
    if (isNaN(n)) n = (def === undefined ? min : def);
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    return n;
  }
  /** 'HH:MM' として妥当か */
  function isTime(s) {
    if (!/^\d{1,2}:\d{2}$/.test(String(s || ''))) return false;
    var p = String(s).split(':');
    return +p[0] >= 0 && +p[0] <= 24 && +p[1] >= 0 && +p[1] < 60;
  }
  /** CSVの1セル（カンマ・改行・引用符を安全に） */
  function csv(v) {
    return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
  }

  return {
    pad: pad, ymd: ymd, parseYmd: parseYmd, daysInMonth: daysInMonth, weekdayOf: weekdayOf,
    WD: WD, monthDates: monthDates, addDays: addDays, hm2min: hm2min, min2hm: min2hm,
    min2h: min2h, overlap: overlap, yen: yen, el: el, esc: esc, uid: uid, clone: clone,
    num: num, isTime: isTime, csv: csv
  };
})();

if (typeof module !== 'undefined') module.exports = U;
