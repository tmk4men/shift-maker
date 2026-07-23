/* image.js — 確定シフトを1枚の画像（PNG）にする
   外部ライブラリは使わず Canvas に直接描く。
   スタッフに配れるよう、氏名×日付の表と、下部に凡例・集計を入れる。 */
var ShiftImage = (function () {

  /** 画像化に必要なデータを組み立てる（描画とテストで共用） */
  function buildModel(data) {
    var dates = Store.monthDates();
    var sts = data.shiftTypes;
    var stById = {}; sts.forEach(function (s) { stById[s.id] = s; });

    var rows = data.employees.map(function (e) {
      var cells = dates.map(function (d) {
        var stId = '';
        var a = data.assignments[d] || {};
        Object.keys(a).forEach(function (k) { if ((a[k] || []).indexOf(e.id) >= 0) stId = k; });
        return stId ? (stById[stId] || {}) : null;
      });
      var days = cells.filter(Boolean).length;
      var mins = cells.reduce(function (a, st) { return a + (st ? Store.stCalc(st).work : 0); }, 0);
      return { name: e.name, cells: cells, days: days, hours: +(mins / 60).toFixed(1) };
    });

    return {
      title: (data.settings.storeName || '') + '　' + data.settings.year + '年' + data.settings.month + '月 シフト表',
      dates: dates, shiftTypes: sts, rows: rows
    };
  }

  /** モデルを canvas に描く。canvas は呼び出し側が用意する（Node のテストでも差し込めるように） */
  function draw(canvas, model, opt) {
    opt = opt || {};
    var scale = opt.scale || 2;                 // Retina 相当
    var C = {
      nameW: 132, cellW: 40, headH: 56, rowH: 40, sumW: 130,
      padX: 24, padY: 24, titleH: 52, footH: 96, legendH: 40
    };
    var cols = model.dates.length;
    var W = C.padX * 2 + C.nameW + cols * C.cellW + C.sumW;
    var H = C.padY * 2 + C.titleH + C.legendH + C.headH + model.rows.length * C.rowH + C.footH;

    canvas.width = W * scale;
    canvas.height = H * scale;
    var g = canvas.getContext('2d');
    g.scale(scale, scale);

    var col = {
      bg: '#ffffff', paper: '#faf8f5', line: '#e8e2d9', line2: '#d5ccbf',
      text: '#3a3733', muted: '#6f675d', sat: '#425b95', sun: '#a84f48'
    };
    function rgba(hex, a) {
      var h = hex.replace('#', '');
      return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
    }
    var FONT = '"Hiragino Kaku Gothic ProN","Yu Gothic UI","Noto Sans JP",sans-serif';

    g.fillStyle = col.bg; g.fillRect(0, 0, W, H);

    // タイトル
    g.fillStyle = col.text;
    g.font = 'bold 22px ' + FONT;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(model.title, C.padX, C.padY + 26);

    var gridX = C.padX, gridY = C.padY + C.titleH + C.legendH;

    // 凡例（勤務区分の色）
    var lx = C.padX, ly = C.padY + C.titleH + 20;
    g.font = '13px ' + FONT;
    model.shiftTypes.forEach(function (st) {
      g.fillStyle = st.color || '#cccccc';
      roundRect(g, lx, ly - 9, 18, 18, 4); g.fill();
      g.fillStyle = col.muted;
      var label = st.name + '（' + st.start + '-' + st.end + '）';
      g.textAlign = 'left';
      g.fillText(label, lx + 24, ly);
      lx += 24 + g.measureText(label).width + 22;
    });

    // ヘッダー行（日付）
    var x = gridX + C.nameW;
    var wd = ['日', '月', '火', '水', '木', '金', '土'];
    g.fillStyle = col.paper; g.fillRect(gridX, gridY, C.nameW + cols * C.cellW + C.sumW, C.headH);
    g.fillStyle = col.muted; g.font = 'bold 13px ' + FONT; g.textAlign = 'left';
    g.fillText('氏名', gridX + 12, gridY + C.headH / 2);
    model.dates.forEach(function (d) {
      var w = U.weekdayOf(d), hol = Store.isHoliday(d), closed = Store.isClosed(d);
      if (w === 6) { g.fillStyle = rgba('#5573b5', .06); g.fillRect(x, gridY, C.cellW, C.headH); }
      if (w === 0 || hol) { g.fillStyle = rgba('#a84f48', .06); g.fillRect(x, gridY, C.cellW, C.headH); }
      g.textAlign = 'center';
      g.fillStyle = (w === 0 || hol) ? col.sun : (w === 6 ? col.sat : col.text);
      g.font = 'bold 15px ' + FONT;
      g.fillText(String(+d.slice(8)), x + C.cellW / 2, gridY + 20);
      g.font = '11px ' + FONT;
      g.fillText(closed ? '休' : wd[w], x + C.cellW / 2, gridY + 40);
      x += C.cellW;
    });
    g.fillStyle = col.muted; g.font = 'bold 12px ' + FONT; g.textAlign = 'center';
    g.fillText('日数 / 時間', x + C.sumW / 2, gridY + C.headH / 2);

    // データ行
    var y = gridY + C.headH;
    model.rows.forEach(function (r, ri) {
      if (ri % 2 === 1) { g.fillStyle = col.paper; g.fillRect(gridX, y, C.nameW + cols * C.cellW + C.sumW, C.rowH); }
      // 氏名
      g.fillStyle = col.text; g.font = '14px ' + FONT; g.textAlign = 'left';
      g.fillText(clip(g, r.name, C.nameW - 20), gridX + 12, y + C.rowH / 2);
      // セル
      var cx = gridX + C.nameW;
      r.cells.forEach(function (st, ci) {
        var w = U.weekdayOf(model.dates[ci]);
        if (st) {
          g.fillStyle = rgba(st.color || '#cccccc', .55);
          roundRect(g, cx + 3, y + 4, C.cellW - 6, C.rowH - 8, 5); g.fill();
          g.fillStyle = col.text; g.font = 'bold 13px ' + FONT; g.textAlign = 'center';
          g.fillText(st.short || st.name.slice(0, 1), cx + C.cellW / 2, y + C.rowH / 2);
        } else if (w === 0 || w === 6 || Store.isHoliday(model.dates[ci])) {
          g.fillStyle = w === 0 || Store.isHoliday(model.dates[ci]) ? rgba('#a84f48', .04) : rgba('#5573b5', .04);
          g.fillRect(cx, y, C.cellW, C.rowH);
        }
        cx += C.cellW;
      });
      // 集計
      g.fillStyle = col.text; g.font = '13px ' + FONT; g.textAlign = 'center';
      g.fillText(r.days + '日 / ' + r.hours + 'h', cx + C.sumW / 2, y + C.rowH / 2);
      y += C.rowH;
    });

    // 罫線
    g.strokeStyle = col.line; g.lineWidth = 1;
    var totalW = C.nameW + cols * C.cellW + C.sumW;
    for (var ry = 0; ry <= model.rows.length; ry++) {
      line(g, gridX, gridY + C.headH + ry * C.rowH, gridX + totalW, gridY + C.headH + ry * C.rowH);
    }
    g.strokeStyle = col.line2;
    line(g, gridX, gridY + C.headH, gridX + totalW, gridY + C.headH);
    // 縦線（氏名の右、集計の左）
    line(g, gridX + C.nameW, gridY, gridX + C.nameW, y);
    line(g, gridX + C.nameW + cols * C.cellW, gridY, gridX + C.nameW + cols * C.cellW, y);
    // 週の区切り（薄く）
    g.strokeStyle = col.line;
    for (var ci = 0; ci <= cols; ci++) {
      if (U.weekdayOf(model.dates[Math.min(ci, cols - 1)]) === 0 || ci === cols) {
        var vx = gridX + C.nameW + ci * C.cellW;
        line(g, vx, gridY, vx, y);
      }
    }

    // フッター
    g.fillStyle = col.muted; g.font = '12px ' + FONT; g.textAlign = 'left';
    var now = opt.stamp || '';
    g.fillText('シフト自動作成で作成' + (now ? '（' + now + '）' : ''), C.padX, y + 40);

    return canvas;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function line(g, x1, y1, x2, y2) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
  function clip(g, text, maxW) {
    if (g.measureText(text).width <= maxW) return text;
    var t = text;
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }

  /** ブラウザで実行：canvasを作って描き、PNGをダウンロードする */
  function download(data) {
    var model = buildModel(data);
    var canvas = document.createElement('canvas');
    var now = new Date();
    var stamp = now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate();
    draw(canvas, model, { scale: 2, stamp: stamp });
    var name = 'シフト_' + data.settings.year + U.pad(data.settings.month) + '.png';
    canvas.toBlob ? canvas.toBlob(function (blob) { save(blob, name); }, 'image/png')
      : save(dataURLtoBlob(canvas.toDataURL('image/png')), name);
  }
  function save(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function dataURLtoBlob(u) {
    var b = atob(u.split(',')[1]), arr = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
    return new Blob([arr], { type: 'image/png' });
  }

  return { buildModel: buildModel, draw: draw, download: download };
})();
if (typeof module !== 'undefined') module.exports = ShiftImage;
