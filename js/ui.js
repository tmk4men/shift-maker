/* ui.js — 画面。データは Store、判定は Rules、生成は Solver に任せる */
(function () {
  var D = Store.load();
  var el = U.el;
  var currentTab = 'setup';
  var staffView = '';     // 提出画面を開いている従業員ID
  var scrollTo = '';      // 描画のあと、この要素まで画面を動かす（開いた先が画面外だと無反応に見えるため）

  /* 使う人のモード（URLではなく画面で切り替える）
     input  … スタッフが自分の希望を入力する画面
     manage … 責任者がシフトを作る画面 */
  var mode = 'manage';
  try {
    if (typeof localStorage !== 'undefined') {
      var m0 = localStorage.getItem('shift-maker-mode');
      if (m0 === 'input' || m0 === 'manage') mode = m0;
    }
  } catch (err) { mode = 'manage'; }

  function setMode(next) {
    mode = next;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem('shift-maker-mode', next); } catch (e) { }
    render();
  }



  /* ================= 共通 ================= */
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }
  function saveAndRender() { Store.save(); render(); }
  Store.onSaveError(function (msg) { toast(msg); });

  /* ---------- 作り直しても、見ている場所を保つ ----------
     画面は操作のたびに丸ごと作り直している。そのままだと開いた説明が閉じ、
     入力中の欄からカーソルが外れ、スクロールが先頭に戻る。
     利用者にはこれが「押しても反応しない」に見えるので、前後で状態を写し取って戻す。 */
  function qsa(sel) {
    try { return Array.prototype.slice.call(document.querySelectorAll(sel)); } catch (e) { return []; }
  }
  /** 作り直しの前後で同じ欄を指すための目印（同じ種類の中で何番目か） */
  function nodeKey(node) {
    if (!node || !node.tagName) return '';
    var same = qsa('.panel ' + node.tagName.toLowerCase());
    var i = same.indexOf(node);
    return i < 0 ? '' : node.tagName + '#' + i;
  }
  function snapshotUI() {
    var s = { where: mode + '/' + currentTab, details: {}, scroll: [], focus: '', sel: null, y: 0 };
    try {
      s.y = (typeof window !== 'undefined' && window.pageYOffset) || 0;
      qsa('details[data-dk]').forEach(function (d) { s.details[d.getAttribute('data-dk')] = !!d.open; });
      qsa('.panel .scroll').forEach(function (n) { s.scroll.push([n.scrollTop || 0, n.scrollLeft || 0]); });
      var a = document.activeElement;
      if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName || '')) {
        s.focus = nodeKey(a);
        try { s.sel = [a.selectionStart, a.selectionEnd]; } catch (e) { s.sel = null; }
      }
    } catch (e) { /* 状態を保てなくても描画は続ける */ }
    return s;
  }
  function restoreUI(s) {
    if (!s) return;
    try {
      // 開いていた説明は、タブが変わっても覚えておく
      qsa('details[data-dk]').forEach(function (d) {
        var v = s.details[d.getAttribute('data-dk')];
        if (v !== undefined) d.open = v;
      });
      // 位置とカーソルは、同じ画面を作り直したときだけ戻す
      if (s.where !== mode + '/' + currentTab) return;
      var boxes = qsa('.panel .scroll');
      if (boxes.length === s.scroll.length) boxes.forEach(function (n, i) {
        n.scrollTop = s.scroll[i][0]; n.scrollLeft = s.scroll[i][1];
      });
      if (s.focus) {
        var parts = s.focus.split('#');
        var target = qsa('.panel ' + parts[0].toLowerCase())[+parts[1]];
        if (target && target.focus) {
          target.focus();
          if (s.sel && target.setSelectionRange) {
            try { target.setSelectionRange(s.sel[0], s.sel[1]); } catch (e) { /* 数値欄などは対象外 */ }
          }
        }
      }
      if (s.y && typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, s.y);
    } catch (e) { /* 同上 */ }
  }

  /** クリップボードは環境によって使えない。使えないときは黙って失敗せず、手で選べる形にする */
  function copyText(text, node) {
    function fallback() {
      var done = false;
      try {
        if (node && node.select) { node.focus(); node.select(); }
        done = !!(document.execCommand && document.execCommand('copy'));
      } catch (err) { done = false; }
      toast(done ? 'コピーしました' : 'コピーできませんでした。枠の中を選んでコピーしてください');
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        var pr = navigator.clipboard.writeText(text);
        if (pr && pr.then) { pr.then(function () { toast('コピーしました'); }, fallback); return; }
      }
    } catch (e) { /* 下の手動コピーに任せる */ }
    fallback();
  }

  /** 表のセルを、マウスがなくても操作できるようにする（td はそのままでは押せない） */
  function makeActivatable(node, labelText, onActivate) {
    node.setAttribute('tabindex', '0');
    node.setAttribute('role', 'button');
    if (labelText) node.setAttribute('aria-label', labelText);
    node.addEventListener('click', onActivate);
    node.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      e.preventDefault();           // 空白キーで画面が飛ぶのを防ぐ
      onActivate(e);
    });
    return node;
  }

  /* 表のセルは 300 個を超える。全部を Tab の止まり場にすると表を抜けるだけで大仕事になるので、
     表全体で止まり場は1つにして、中は矢印キーで移動する（表計算ソフトと同じ感覚）。 */
  var ARROWS = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };

  function isCell(n) { return !!(n && n.getAttribute && n.getAttribute('role') === 'button' && n.tagName === 'TD'); }

  function gridKeys(e) {
    var d = ARROWS[e.key];
    if (!d || !isCell(e.target)) return;
    var td = e.target, tr = td.parentNode;
    var col = Array.prototype.indexOf.call(tr.children, td);
    var next = null;
    if (d[1]) {
      next = d[1] < 0 ? td.previousElementSibling : td.nextElementSibling;
      while (next && !isCell(next)) next = d[1] < 0 ? next.previousElementSibling : next.nextElementSibling;
    } else {
      var row = tr;
      do {
        row = d[0] < 0 ? row.previousElementSibling : row.nextElementSibling;
        next = row ? row.children[col] : null;
      } while (row && !isCell(next));
    }
    if (!isCell(next) || !next.focus) return;
    e.preventDefault();
    next.focus();
  }

  function rovingGrid(root) {
    if (!root.querySelectorAll || !root.addEventListener) return root;   // 擬似DOM では何もしない
    var cells = Array.prototype.slice.call(root.querySelectorAll('td[role="button"]'));
    cells.forEach(function (c, i) { c.setAttribute('tabindex', i === 0 ? '0' : '-1'); });
    root.addEventListener('keydown', gridKeys);
    root.addEventListener('focusin', function (e) {
      if (!isCell(e.target)) return;
      cells.forEach(function (c) { c.setAttribute('tabindex', c === e.target ? '0' : '-1'); });
    });
    return root;
  }

  var modalOpener = null;   // ダイアログを開く前にどこにいたか

  function modal(title, bodyNode, footNodes) {
    var box = document.getElementById('modal');
    var wasOpen = box.classList && !box.classList.contains('hidden');
    if (!wasOpen) {
      var a = document.activeElement;
      modalOpener = (a && a.focus && a.tagName !== 'BODY') ? a : null;
    }
    document.getElementById('modalTitle').textContent = title;
    var body = document.getElementById('modalBody'); body.innerHTML = '';
    body.appendChild(bodyNode);
    var foot = document.getElementById('modalFoot'); foot.innerHTML = '';
    (footNodes || []).forEach(function (n) { foot.appendChild(n); });
    box.classList.remove('hidden');
    // 開いたらダイアログの中にカーソルを移す（背後の画面を操作させない）
    try {
      var first = box.querySelector('.modal-body button, .modal-body input, .modal-body select, .modal-body textarea')
        || box.querySelector('.modal-foot button')
        || box.querySelector('.modal-box');
      if (first && first.focus) first.focus();
    } catch (e) { /* 位置を移せなくても操作はできる */ }
  }

  function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    try { if (modalOpener && document.contains(modalOpener)) modalOpener.focus(); } catch (e) { }
    modalOpener = null;
  }

  /** ダイアログを開いている間、Tab が背後の画面へ抜けないようにする */
  function trapTab(e) {
    if (e.key !== 'Tab') return;
    var box = document.getElementById('modal');
    if (!box || !box.classList || box.classList.contains('hidden')) return;
    var f = Array.prototype.filter.call(
      box.querySelectorAll('button, input, select, textarea'),
      function (n) { return !n.disabled; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- アイコン ----------
     文字記号（✕ ＋ ◀ ▶）は環境で形が変わり、読み上げでも意味が出ない。
     同じ太さ・同じ丸みの線画にそろえ、意味は aria-label 側で伝える。 */
  var ICON_PATH = {
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
    prev: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    check: 'M4 12.5l5.5 5.5L20 7',
    download: 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M4 19h16',
    share: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 14v4a2 2 0 002 2h12a2 2 0 002-2v-4',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    print: 'M7 9V4h10v5M7 18H5v-6h14v6h-2M7 15h10v5H7z',
    image: 'M4 5h16v14H4zM4 16l4.5-4.5 3 3L15 11l5 5',
    trash: 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12',
    edit: 'M4 20h4L19 9l-4-4L4 16z',
    calendar: 'M4 6h16v14H4zM4 10h16M8 4v4M16 4v4',
    people: 'M8 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M17 20c0-2.6-1-4.4-2.5-5.4M16 5.2a3.2 3.2 0 010 6'
  };

  /** 線画アイコン。文字と並べるときは装飾なので読み上げ対象から外す */
  function icon(name, opt) {
    opt = opt || {};
    var svg = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      : document.createElement('svg');
    function set(k, v) { if (svg.setAttribute) svg.setAttribute(k, v); }
    set('viewBox', '0 0 24 24');
    set('width', opt.size || 18);
    set('height', opt.size || 18);
    set('fill', 'none');
    set('stroke', 'currentColor');
    set('stroke-width', '2');
    set('stroke-linecap', 'round');
    set('stroke-linejoin', 'round');
    set('aria-hidden', 'true');
    set('focusable', 'false');
    set('class', 'ico');
    var path = document.createElementNS
      ? document.createElementNS('http://www.w3.org/2000/svg', 'path')
      : document.createElement('path');
    if (path.setAttribute) path.setAttribute('d', ICON_PATH[name] || '');
    if (svg.appendChild) svg.appendChild(path);
    return svg;
  }

  /** アイコン＋文字のボタン。文字は残す（アイコンだけだと意味が伝わらないため） */
  function iconBtn(name, label, attrs) {
    var a = Object.assign({ class: 'btn' }, attrs || {});
    var b = el('button', a, [icon(name), el('span', { text: label })]);
    return b;
  }

  /** アイコンだけの小さなボタン。必ず名前を付ける */
  function iconOnly(name, ariaLabel, attrs) {
    var a = Object.assign({ class: 'btn ghost sm icon-only', 'aria-label': ariaLabel, title: ariaLabel }, attrs || {});
    return el('button', a, [icon(name, { size: 16 })]);
  }

  function field(label, input) { return el('div', { class: 'field' }, [el('label', { text: label }), input]); }
  function input(type, value, oninput, attrs) {
    var a = Object.assign({ type: type, value: value === undefined ? '' : value, oninput: oninput }, attrs || {});
    return el('input', a);
  }
  /** 打っている間は保存だけ。画面を作り直すのは入力が確定してから。
      1文字ごとに作り直すと入力欄そのものが消えて、打てない＝反応しないように見えるため。 */
  function liveInput(type, value, apply, attrs) {
    var a = Object.assign({ onchange: function () { render(); } }, attrs || {});
    return input(type, value, function (e) { apply(e.target.value); Store.save(); }, a);
  }
  function checkbox(label, checked, onchange) {
    var c = el('input', { type: 'checkbox', onchange: onchange });
    c.checked = !!checked;
    return el('label', { class: 'switch' }, [c, label]);
  }
  function select(options, value, onchange) {
    var s = el('select', { onchange: onchange });
    options.forEach(function (o) {
      var op = el('option', { value: o.v, text: o.t });
      if (String(o.v) === String(value)) op.selected = true;
      s.appendChild(op);
    });
    return s;
  }
  /* ================= メニュー（使い方・データ） ================= */
  function menuSection(title, rows) {
    return el('div', { style: 'margin-bottom:24px' }, [el('h4', { text: title })].concat(rows));
  }
  function menuItem(label, desc, onclick, cls) {
    return el('div', { style: 'padding:8px 0;border-bottom:1px solid var(--line)' }, [
      el('button', { class: 'btn ' + (cls || 'ghost'), text: label, onclick: onclick, style: 'width:100%;justify-content:center' }),
      desc ? el('div', { class: 'vd', style: 'margin-top:4px', text: desc }) : null
    ]);
  }

  function openMenu() {
    var b = el('div', {}, [
      menuSection('使い方', [
        menuItem('はじめての方へ', '準備からシフト作成までの流れ', showHowToUse),
        menuItem('スタッフへの渡し方', '希望を集める手順', showHowToCollect),
        menuItem('このアプリの決まり', '変更できない動きの説明', showFixedRules)
      ]),
      menuSection('データ', [
        menuItem('バックアップを保存', 'ファイルに書き出します', function () { closeModal(); Store.exportJson(); }),
        menuItem('読み込み', '書き出したファイルを戻します', function () {
          closeModal(); document.getElementById('fileImport').click();
        }),
        menuItem('サンプルの店を読み込む', '今の内容は消えます', function () {
          if (!confirm('サンプルの店（10名・1か月分の希望入り）を読み込みます。\n今の内容は上書きされます。よろしいですか？')) return;
          D = Store.loadDemo(); closeModal(); render();
          toast('サンプルを読み込みました');
        }),
        menuItem('全部消して最初から', '', function () {
          if (!confirm('すべてのデータを消して最初からにします。よろしいですか？')) return;
          D = Store.reset(); closeModal(); render(); toast('初期化しました');
        }, 'ghost danger')
      ])
    ]);
    modal('メニュー', b, [el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })]);
  }

  function showHowToUse() {
    modal('はじめての方へ', el('div', {}, [
      el('p', {}, [el('strong', { text: '責任者がやること' })]),
      el('p', { class: 'hint', text: '1. 準備 … 対象月・勤務区分・曜日ごとの必要人数・お店の休みを決める' }),
      el('p', { class: 'hint', text: '2. スタッフ … 名前と時給を登録。該当する人だけ属性にチェック' }),
      el('p', { class: 'hint', text: '3. 希望を集める … スタッフから受け取った希望を取り込む' }),
      el('p', { class: 'hint', text: '4. シフト表 … ［シフトを作成する］。セルを押せば手直しできます' }),
      el('p', { class: 'hint', text: '5. 集計 … 労働時間・夜勤回数・人件費・年収の壁を確認' }),
      el('p', { style: 'margin-top:16px' }, [el('strong', { text: 'スタッフがやること' })]),
      el('p', { class: 'hint', text: '画面上の［シフト希望を出す］を押して、名前と行ける日時を入力するだけです。' }),
      el('p', { style: 'margin-top:16px' }, [el('strong', { text: '画面の上の案内' })]),
      el('p', { class: 'hint', text: '「次にやること」が常に出ます。迷ったらそれに従ってください。' })
    ]), [el('button', { class: 'btn ghost', text: '戻る', onclick: openMenu })]);
  }

  function showFixedRules() {
    modal('このアプリの決まり', el('div', {}, [
      el('p', { class: 'hint', text: '手間を減らすため、次の動きは設定にせず固定しています。' }),
      el('div', { class: 'violation' }, [
        el('div', { class: 'vt', text: '希望が未入力の日は出勤させません' }),
        el('div', { class: 'vd', text: '入れていいか分からない人を勝手に入れないためです。全く入力のない人はシフトに入りません。' })
      ]),
      el('div', { class: 'violation' }, [
        el('div', { class: 'vt', text: '必要人数を超える人は入れません' }),
        el('div', { class: 'vd', text: '人件費が無駄に増えるのを防ぎます。' })
      ]),
      el('div', { class: 'violation' }, [
        el('div', { class: 'vt', text: '祝日は自動で判定します' }),
        el('div', { class: 'vd', text: '振替休日・国民の休日・春分秋分まで計算します。お店の休みは「1. 準備」で別に設定できます。' })
      ]),
      el('div', { class: 'violation hard' }, [
        el('div', { class: 'vt', text: '法令は必ず守ります' }),
        el('div', { class: 'vd', text: '18歳未満の深夜勤務、週40時間、休憩、週1日の休日、時間外の月45時間。これらは設定で外せません。' })
      ]),
      el('div', { class: 'violation hard' }, [
        el('div', { class: 'vt', text: 'データはこの端末にだけ保存されます' }),
        el('div', { class: 'vd', text: '別の端末とは共有されません。大事な月はメニューの［書き出し］でファイルに残してください。' })
      ])
    ]), [el('button', { class: 'btn ghost', text: '戻る', onclick: openMenu })]);
  }

  function card(title, hint, children) {
    return el('div', { class: 'card' }, [el('h2', { text: title }), hint ? el('p', { class: 'hint', text: hint }) : null].concat(children));
  }

  /* ================= ① 基本設定 ================= */
  function renderSetup() {
    var p = document.getElementById('panel-setup'); p.innerHTML = '';
    var s = D.settings;

    p.appendChild(card('店舗・対象月', null, [
      el('div', { class: 'row' }, [
        field('店舗名', input('text', s.storeName, function (e) { s.storeName = e.target.value; Store.save(); })),
        field('年', liveInput('number', s.year, function (v) { s.year = U.num(v, 2000, 2100, s.year); }, { min: 2000, max: 2100 })),
        field('月', select([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return { v: m, t: m + '月' }; }), s.month,
          function (e) { s.month = +e.target.value; saveAndRender(); })),
        field('週の始まり', select([{ v: 0, t: '日曜' }, { v: 1, t: '月曜' }], s.weekStartsOn, function (e) { s.weekStartsOn = +e.target.value; saveAndRender(); }))
      ]),
    ]));

    /* お店の休み */
    var closedCard = card('お店の休み', 'ここで決めた日は、誰も出勤しません。', [
      el('div', { class: 'field' }, [el('label', { text: '定休日（毎週この曜日は休み）' }),
      el('div', { class: 'row' }, U.WD.map(function (w, i) {
        return checkbox(w + '曜', (s.closedWeekdays || []).indexOf(i) >= 0, function (e) {
          if (e.target.checked) { if (s.closedWeekdays.indexOf(i) < 0) s.closedWeekdays.push(i); }
          else s.closedWeekdays = s.closedWeekdays.filter(function (x) { return x !== i; });
          saveAndRender();
        });
      }))]),
      el('div', { class: 'field', style: 'margin-top:16px' }, [el('label', { text: '臨時休業日（年末年始・棚卸しなど）' }),
      el('div', { class: 'row' }, [
        (function () {
          var di = input('date', '');
          return el('div', { class: 'row' }, [di, el('button', {
            class: 'btn sm', text: '追加', onclick: function () {
              var v = di.value;
              if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return toast('日付を選んでください');
              if (s.closedDates.indexOf(v) < 0) s.closedDates.push(v);
              s.closedDates.sort();
              saveAndRender();
            }
          })]);
        })()
      ])]),
      el('div', { class: 'row', style: 'margin-top:12px' },
        (s.closedDates || []).length
          ? s.closedDates.map(function (d) {
            return el('span', { class: 'chip' }, [
              d + '（' + U.WD[U.weekdayOf(d)] + '）',
              iconOnly('close', d + ' の臨時休業をやめる', {
                style: 'margin-left:6px;min-height:24px;padding:0 6px',
                onclick: function () {
                  s.closedDates = s.closedDates.filter(function (x) { return x !== d; });
                  saveAndRender();
                }
              })
            ]);
          })
          : [el('span', { class: 'muted', text: '登録なし' })])
    ]);
    p.appendChild(closedCard);

    /* 勤務区分 */
    var stRows = D.shiftTypes.map(function (st, i) {
      var c = Store.stCalc(st);
      var warn = '';
      if (c.work > 480 && st.breakMin < 60) warn = '休憩60分以上が必要';
      else if (c.work > 360 && st.breakMin < 45) warn = '休憩45分以上が必要';
      return el('tr', {}, [
        el('td', {}, [input('text', st.name, function (e) { st.name = e.target.value; Store.save(); }, { style: 'width:80px' })]),
        el('td', {}, [input('text', st.short, function (e) { st.short = e.target.value; Store.save(); }, { style: 'width:44px' })]),
        el('td', {}, [liveInput('time', st.start, function (v) { if (U.isTime(v)) st.start = v; })]),
        el('td', {}, [liveInput('time', st.end, function (v) { if (U.isTime(v)) st.end = v; })]),
        el('td', {}, [liveInput('number', st.breakMin, function (v) { st.breakMin = U.num(v, 0, 600, 0); }, { style: 'width:70px', step: 5, min: 0, max: 600 })]),
        el('td', {}, [input('color', st.color, function (e) { st.color = e.target.value; Store.save(); }, { style: 'width:44px;padding:0' })]),
        el('td', { class: 'nowrap', text: U.min2h(c.work) + 'h' }),
        el('td', { class: 'nowrap', text: c.night > 0 ? U.min2h(c.night) + 'h' : '—' }),
        el('td', {}, [warn ? el('span', { class: 'badge ng', text: warn }) : el('span', { class: 'badge ok', text: 'OK' })]),
        el('td', {}, [iconBtn('trash', '削除', {
          class: 'btn ghost sm danger', onclick: function () {
            if (D.shiftTypes.length <= 1) return toast('最低1つは必要です');
            if (!confirm(st.name + ' を削除します。\n作成済みシフトのこの勤務、必要人数の設定、各人の「担当できる勤務区分」からも削除されます。よろしいですか？')) return;
            Store.removeShiftType(st.id); D = Store.get(); render();
          }
        })])
      ]);
    });

    p.appendChild(card('勤務区分（早番・遅番など）', '終了が開始より前の時刻なら、日をまたぐ夜勤として計算します。', [
      el('div', { class: 'scroll' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['名称', '略', '開始', '終了', '休憩(分)', '色', '実働', '深夜', '休憩チェック', ''].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, stRows)
      ])]),
      el('div', { style: 'margin-top:10px' }, [iconBtn('plus', '勤務区分を追加', {
        class: 'btn sm', onclick: function () {
          var id = 'S' + (D.shiftTypes.length + 1) + Math.floor(Math.random() * 90 + 10);
          D.shiftTypes.push({ id: id, name: '新しい勤務', short: '新', start: '09:00', end: '18:00', breakMin: 60, color: '#b0bec5' });
          D.demand.byWeekday[id] = [0, 0, 0, 0, 0, 0, 0];
          D.demand.roleReq[id] = { leader: false, certified: false };
          D.employees.forEach(function (e) { e.canShift.push(id); });
          saveAndRender();
        }
      })])
    ]));

    /* 必要人数 */
    var head = el('tr', {}, [el('th', { text: '勤務区分' })].concat(U.WD.map(function (w, i) {
      return el('th', { class: i === 0 ? 'sun' : i === 6 ? 'sat' : '', text: w });
    })));

    var rows = D.shiftTypes.map(function (st) {
      var arr = D.demand.byWeekday[st.id] || (D.demand.byWeekday[st.id] = [0, 0, 0, 0, 0, 0, 0]);
      return el('tr', {}, [el('td', { text: st.name })].concat(arr.map(function (v, i) {
        return el('td', {}, [input('number', v, function (e) { arr[i] = U.num(e.target.value, 0, 99, 0); Store.save(); }, { style: 'width:56px', min: 0, max: 99 })]);
      })));
    });

    p.appendChild(card('必要人数（曜日別）', null, [
      el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, rows)])])
    ]));

    /* 特定日の調整 */
    var det = el('details', { class: 'rule', 'data-dk': 'overrides' }, [el('summary', { text: '特定日の調整（イベント・繁忙日）' })]);
    var ovTable = el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: '日付' })].concat(D.shiftTypes.map(function (st) { return el('th', { text: st.name }); })))]),
      el('tbody', {}, Store.monthDates().map(function (date) {
        var w = U.weekdayOf(date);
        return el('tr', {}, [el('td', { class: w === 0 ? 'sun' : w === 6 ? 'sat' : '', text: date.slice(5) + '(' + U.WD[w] + ')' })]
          .concat(D.shiftTypes.map(function (st) {
            var ov = D.demand.overrides[date] || {};
            return el('td', {}, [input('number', ov[st.id] === undefined ? '' : ov[st.id], function (e) {
              if (!D.demand.overrides[date]) D.demand.overrides[date] = {};
              if (e.target.value === '') delete D.demand.overrides[date][st.id];
              else D.demand.overrides[date][st.id] = U.num(e.target.value, 0, 99, 0);
              Store.save();
            }, { style: 'width:56px', min: 0, placeholder: Store.needOf(date, st.id) })]);
          })));
      }))
    ]);
    det.appendChild(el('div', { class: 'scroll', style: 'max-height:340px;margin-top:8px' }, [ovTable]));
    p.appendChild(el('div', { class: 'card' }, [det]));   // 見出しは開閉の見出しだけで足りる

    renderRules();   // 詳しいルール設定は、このタブの末尾に畳んで置く
  }

  /* ================= ② 従業員 ================= */
  function renderStaff() {
    var p = document.getElementById('panel-staff'); p.innerHTML = '';

    var rows = D.employees.map(function (e) {
      var chips = [];
      if (e.newbie) chips.push(el('span', { class: 'chip newbie', text: '新人' }));
      if (e.minor) chips.push(el('span', { class: 'chip minor', text: '18歳未満' }));
      return el('tr', {}, [
        el('td', {}, [el('strong', { text: e.name })].concat(el('div', {}, chips))),
        el('td', { text: e.canShift.map(function (id) { var s = Store.stById(id); return s ? s.short || s.name : ''; }).join('/') }),
        el('td', { class: 'right', text: e.minDays + '〜' + e.maxDays + '日' }),
        el('td', { class: 'right', text: e.maxConsecutive + '連勤' }),
        el('td', { class: 'right', text: priorityLabel(e.priority) }),
        el('td', {}, [
          iconBtn('edit', '編集', { class: 'btn ghost sm', onclick: function () { editEmp(e); } }),
          iconBtn('trash', '削除', {
            class: 'btn ghost sm danger', onclick: function () {
              if (!confirm(e.name + ' さんを削除します。\n作成済みシフト・希望・提出内容・相性設定からも削除されます。よろしいですか？')) return;
              Store.removeEmployee(e.id); D = Store.get(); render();
            }
          })
        ])
      ]);
    });

    p.appendChild(card('従業員', '時給と扶養の設定は、本人がシフト希望と一緒に送ってきます。', [
      el('div', { class: 'scroll' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['氏名 / 属性', '担当可能', '出勤日数', '連勤上限', '優先度', ''].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])]),
      el('div', { style: 'margin-top:12px' }, [iconBtn('plus', '従業員を追加', {
        class: 'btn', onclick: function () {
          var e = Store.addEmployee('');   // 初期値の決め方は Store に一本化する
          D = Store.get(); editEmp(e, true);
        }
      })])
    ]));
  }

  /** 優先度は 未入力 / 0 / 1 の3つだけ */
  function priorityLabel(v) {
    if (v === '' || v === null || v === undefined) return '未入力';
    return +v > 0 ? '優先' : 'ふつう';
  }

  /** isNew … 追加ボタンから開いた場合。キャンセルされたら登録ごと取り消す */
  function editEmp(e, isNew) {
    var b = el('div', {}, []);
    b.appendChild(el('div', { class: 'row' }, [
      field('氏名', input('text', e.name, function (ev) { e.name = ev.target.value; }))
    ]));

    b.appendChild(el('h4', { text: '属性', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, [
      checkbox('新人', e.newbie, function (ev) { e.newbie = ev.target.checked; }),
      checkbox('18歳未満', e.minor, function (ev) { e.minor = ev.target.checked; })
    ]));
    b.appendChild(el('p', { class: 'hint', text:
      '新人は、新人でない人と必ず同じ勤務にします。18歳未満は、深夜勤務と時間外を法律どおり禁止します。' }));

    b.appendChild(el('h4', { text: '担当できる勤務区分', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, D.shiftTypes.map(function (st) {
      return checkbox(st.name, e.canShift.indexOf(st.id) >= 0, function (ev) {
        if (ev.target.checked) { if (e.canShift.indexOf(st.id) < 0) e.canShift.push(st.id); }
        else e.canShift = e.canShift.filter(function (x) { return x !== st.id; });
      });
    })));

    b.appendChild(el('h4', { text: '勤務できない曜日', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, U.WD.map(function (w, i) {
      return checkbox(w, e.ngWeekdays.indexOf(i) >= 0, function (ev) {
        if (ev.target.checked) { if (e.ngWeekdays.indexOf(i) < 0) e.ngWeekdays.push(i); }
        else e.ngWeekdays = e.ngWeekdays.filter(function (x) { return x !== i; });
      });
    })));

    b.appendChild(el('h4', { text: '勤務量', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, [
      field('最低出勤日数', input('number', e.minDays, function (ev) { e.minDays = U.num(ev.target.value, 0, 31, 0); }, { min: 0 })),
      field('最大出勤日数', input('number', e.maxDays, function (ev) { e.maxDays = U.num(ev.target.value, 0, 31, 0); }, { min: 0 })),
      field('連勤上限', input('number', e.maxConsecutive, function (ev) { e.maxConsecutive = U.num(ev.target.value, 0, 31, 0); }, { min: 0 })),
      field('月の最低時間（0＝なし）', input('number', e.minHoursMonth, function (ev) { e.minHoursMonth = U.num(ev.target.value, 0, 744, 0); }, { min: 0 })),
      field('月の上限時間（0＝なし）', input('number', e.maxHoursMonth, function (ev) { e.maxHoursMonth = U.num(ev.target.value, 0, 744, 0); }, { min: 0 })),
      field('月の夜勤上限（0＝なし）', input('number', e.maxNights, function (ev) { e.maxNights = U.num(ev.target.value, 0, 31, 0); }, { min: 0 })),
      field('週の上限時間（0＝なし）', input('number', e.weeklyHoursCap, function (ev) { e.weeklyHoursCap = U.num(ev.target.value, 0, 80, 0); }, { min: 0, max: 80 })),
      field('優先度', select([
        { v: '', t: '未入力' }, { v: 0, t: '0（ふつう）' }, { v: 1, t: '1（優先する）' }
      ], e.priority === '' || e.priority === null || e.priority === undefined ? '' : e.priority,
        function (ev) { e.priority = ev.target.value === '' ? '' : +ev.target.value; }))
    ]));
    b.appendChild(el('p', { class: 'hint', text:
      '優先度は、希望が重なったときに誰を先に入れるかの目安です。1にした人が先に入ります。' }));

    var others = D.employees.filter(function (x) { return x.id !== e.id; });

    /** 相手をプルダウンで選んで足す。選んだ人は下に並び、✕ で外せる */
    function partnerPicker(label, hint, list) {
      var box = el('div', { class: 'field grow' }, [el('label', { text: label })]);
      var chosen = el('div', { class: 'row', style: 'margin-top:6px' }, []);

      function paint() {
        chosen.innerHTML = '';
        if (!list.length) { chosen.appendChild(el('span', { class: 'muted', text: 'なし' })); return; }
        list.forEach(function (id) {
          var o = Store.empById(id);
          chosen.appendChild(el('span', { class: 'chip' }, [
            (o ? o.name : id),
            iconOnly('close', (o ? o.name : id) + ' を外す', {
              style: 'margin-left:6px;min-height:24px;padding:0 6px',
              onclick: function () { list.splice(list.indexOf(id), 1); paint(); refill(); }
            })
          ]));
        });
      }

      var sel = select([], '', null);
      function refill() {
        sel.innerHTML = '';
        var rest = others.filter(function (o) { return list.indexOf(o.id) < 0; });
        sel.appendChild(el('option', { value: '', text: rest.length ? '選んでください' : '選べる人がいません' }));
        rest.forEach(function (o) { sel.appendChild(el('option', { value: o.id, text: o.name })); });
        sel.disabled = !rest.length;
      }
      refill();

      box.appendChild(el('div', { class: 'row' }, [
        sel,
        el('button', {
          class: 'btn ghost sm', text: '追加', onclick: function () {
            if (!sel.value) return;
            if (list.indexOf(sel.value) < 0) list.push(sel.value);
            paint(); refill();
          }
        })
      ]));
      box.appendChild(chosen);
      if (hint) box.appendChild(el('p', { class: 'hint', style: 'margin-top:4px', text: hint }));
      paint();
      return box;
    }

    b.appendChild(el('h4', { text: '組み合わせ', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [
      partnerPicker('同じ勤務にできない人', '選んだ人とは同じ勤務にしません。', e.ngPartners)
    ]));
    b.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [
      partnerPicker('できれば同じ勤務にしたい人', '可能なときは同じ勤務にします。', e.goodPartners)
    ]));

    b.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('div', { class: 'field grow' }, [el('label', { text: 'メモ（非公開）' }), input('text', e.note, function (ev) { e.note = ev.target.value; })])
    ]));

    modal('従業員の編集', b, [
      el('button', {
        class: 'btn ghost', text: 'キャンセル', onclick: function () {
          if (isNew) Store.removeEmployee(e.id);
          D = Store.load(); closeModal(); render();
        }
      }),
      el('button', { class: 'btn', text: '保存', onclick: function () { Store.save(); closeModal(); render(); toast('保存しました'); } })
    ]);
  }

  /* ================= ③ 希望・提出 ================= */
  function renderRequest() {
    var p = document.getElementById('panel-request'); p.innerHTML = '';
    var dates = Store.monthDates();
    var total = D.employees.length, done = Store.submittedCount();

    /* 入力状況 */
    var statusRows = D.employees.map(function (e) {
      var filled = dates.filter(function (d) { return D.avail[e.id] && D.avail[e.id][d]; }).length;
      var cls = filled === 0 ? 'ng' : filled < dates.length ? 'warn' : 'ok';
      var label = filled === 0 ? '未入力（シフトに入りません）' : filled + ' / ' + dates.length + ' 日';
      return el('tr', {}, [
        el('td', { text: e.name }),
        el('td', {}, [el('span', { class: 'badge ' + cls, text: label })]),
        el('td', {}, [
          el('button', { class: 'btn ghost sm', text: '入力する', onclick: function () { staffView = e.id; scrollTo = 'staffSubmit'; render(); } }),
          el('button', {
            class: 'btn ghost sm', text: '全日OKにする', onclick: function () {
              if (!D.avail[e.id]) D.avail[e.id] = {};
              dates.forEach(function (d) {
                if ((e.ngWeekdays || []).indexOf(U.weekdayOf(d)) >= 0) D.avail[e.id][d] = { off: true };
                else D.avail[e.id][d] = { allday: true };
              });
              saveAndRender(); toast(e.name + 'さんを全日OKにしました');
            }
          })
        ])
      ]);
    });

    var noInput = D.employees.filter(function (e) {
      return !dates.some(function (d) { return D.avail[e.id] && D.avail[e.id][d]; });
    });

    p.appendChild(card('希望の入力状況　' + (D.employees.length - noInput.length) + ' / ' + D.employees.length + ' 人',
      '入力がない日は出勤させません。全く入力のない人はシフトに入りません。', [
      el('div', { class: 'row', style: 'margin-bottom:12px' }, [
        el('button', {
          class: 'btn', text: 'シフトを作成する', onclick: function () {
            if (noInput.length && !confirm(noInput.map(function (e) { return e.name; }).join('、')
              + ' さんの希望が未入力です。\nこのままだとシフトに入りません。作成しますか？')) return;
            switchTab('shift'); doGenerate();
          }
        }),
        el('button', { class: 'btn ghost', text: '希望ファイルを読み込む', onclick: function () { document.getElementById('fileRequests').click(); } }),
        el('button', { class: 'btn ghost', text: 'コードを貼り付けて取り込む', onclick: importCodeDialog }),
        el('button', { class: 'btn ghost', text: 'スタッフへの渡し方', onclick: showHowToCollect })
      ]),
      el('div', { class: 'scroll' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['氏名', '入力状況', ''].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, statusRows)
      ])])
    ]));

    /* スタッフ提出画面 */
    if (staffView && Store.empById(staffView)) p.appendChild(staffSubmitCard(Store.empById(staffView), dates));

    /* 全員一覧グリッド */
    var head = el('tr', {}, [el('th', { class: 'namecol', text: '氏名' })].concat(dates.map(function (d) {
      var w = U.weekdayOf(d);
      return el('th', { class: w === 0 ? 'sun' : w === 6 ? 'sat' : '', text: d.slice(8) });
    })));
    var body = D.employees.map(function (e) {
      return el('tr', {}, [el('td', { class: 'namecol', text: e.name })].concat(dates.map(function (d) {
        return reqCell(e, d);
      })));
    });

    p.appendChild(card('希望一覧', 'マスを押すと切り替わります。矢印キーでも動けます。', [
      el('div', { class: 'legend' }, [
        el('span', { class: 'req-off', text: '△ 休みたい' }),
        el('span', { class: 'req-must', text: '× 絶対に休みたい' }),
        el('span', { class: 'req-paid', text: '有 有給' }),
        el('span', { class: 'req-want', text: '◎ 出勤希望' })
      ]),
      rovingGrid(el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])]))
    ]));
  }

  /** スタッフにどう入力してもらうかの案内 */
  function showHowToCollect() {
    modal('スタッフへの渡し方', el('div', {}, [
      el('p', {}, [el('strong', { text: 'スタッフにやってもらうこと' })]),
      el('p', { class: 'hint', text: '1. このアプリを開く' }),
      el('p', { class: 'hint', text: '2. 上の［シフト希望を出す］を押す' }),
      el('p', { class: 'hint', text: '3. 名前と、行ける日・時間を入れる' }),
      el('p', { class: 'hint', text: '4. ［LINEなどで送る］を押して、責任者に送る' }),
      el('p', { style: 'margin-top:16px' }, [el('strong', { text: '責任者がやること' })]),
      el('p', { class: 'hint', text: '送られてきた文をコピーして、［コードを貼り付けて取り込む］に貼るだけです。名前や日時ごと貼っても大丈夫です。何人分でも一度に取り込めます。' })
    ]), [el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })]);
  }

  /** 希望ファイルをまとめて読み、誰のものかを確認してから取り込む */
  function importRequestFiles(files) {
    var items = [], ngList = [], pending = files.length;
    if (!pending) return;
    Array.prototype.forEach.call(files, function (f) {
      var r = new FileReader();
      r.onload = function () {
        try { items.push({ src: f.name, obj: decodeCode(r.result) }); }
        catch (err) { ngList.push(f.name + '：' + err.message); }
        if (--pending === 0) showAssignDialog(items, ngList);
      };
      r.onerror = function () { ngList.push(f.name + '：読めませんでした'); if (--pending === 0) showAssignDialog(items, ngList); };
      r.readAsText(f);
    });
  }

  /** 「これは誰の希望か」をプルダウンで確認してから取り込む画面 */
  function showAssignDialog(items, ngList) {
    ngList = ngList || [];
    if (!items.length) {
      modal('読み込み結果', el('div', {}, ngList.map(function (m) {
        return el('div', { class: 'vd', text: '・' + m });
      })), [el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })]);
      return;
    }

    var ym = D.settings.year + '-' + U.pad(D.settings.month);

    /* 登録済みの氏名と一致していて、対象月も合っていれば、確認を挟まずそのまま入れる。
       毎回プルダウンで「これは誰か」を選ばせる必要はない。 */
    if (!ngList.length) {
      var auto = items.filter(function (it) {
        return (!it.obj.ym || it.obj.ym === ym) && !!Store.guessEmployee(it.obj);
      });
      if (auto.length === items.length) {
        var names = [], ng2 = [];
        auto.forEach(function (it) {
          try { names.push(Store.importSubmission(it.obj, Store.guessEmployee(it.obj).id).name); }
          catch (err) { ng2.push((it.obj.name || it.src) + '：' + err.message); }
        });
        D = Store.get(); render();
        if (!ng2.length) { toast(names.join('、') + ' さんの希望を取り込みました'); return; }
      }
    }
    var rows = items.map(function (it, i) {
      var guess = Store.guessEmployee(it.obj);
      it.targetId = guess ? guess.id : '__new__';

      var opts = [{ v: '__new__', t: '＋ 新しく登録する（' + (it.obj.name || '名前なし') + '）' }]
        .concat(D.employees.map(function (e) { return { v: e.id, t: e.name }; }));
      var sel = select(opts, it.targetId, function (ev) { it.targetId = ev.target.value; });

      var days = Object.keys(it.obj.avail || {}).length;
      var monthNg = it.obj.ym && it.obj.ym !== ym;
      it.skip = monthNg;

      return el('tr', {}, [
        el('td', {}, [
          el('strong', { text: it.obj.name || '（名前なし）' }),
          el('div', { class: 'vd', text: it.src })
        ]),
        el('td', { class: 'nowrap', text: (it.obj.ym || '?') + '　' + days + '日分' }),
        el('td', {}, monthNg
          ? [el('span', { class: 'badge ng', text: '対象月が違うため取り込みません' })]
          : [sel])
      ]);
    });

    var body = el('div', {}, [
      el('p', { class: 'hint', text: 'これは誰の希望か確認してください。名前が一致した人は最初から選ばれています。' }),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, ['データ', '対象月・件数', '誰の希望か'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])
    ].concat(ngList.length ? [el('h4', { text: '読めなかったもの', style: 'margin-top:12px' })]
      .concat(ngList.map(function (m) { return el('div', { class: 'vd', text: '・' + m }); })) : []));

    modal('希望の取り込み', body, [
      el('button', { class: 'btn ghost', text: 'やめる', onclick: closeModal }),
      el('button', {
        class: 'btn', text: '取り込む', onclick: function () {
          var done = [], failed = [];
          items.forEach(function (it) {
            if (it.skip) { failed.push((it.obj.name || it.src) + '：対象月が違います'); return; }
            try {
              var id = it.targetId;
              if (id === '__new__') id = Store.addEmployee(it.obj.name || '新しい従業員').id;
              var emp = Store.importSubmission(it.obj, id);
              done.push(emp.name);
            } catch (err) { failed.push((it.obj.name || it.src) + '：' + err.message); }
          });
          closeModal(); D = Store.get(); render();
          if (failed.length) {
            modal('取り込み結果', el('div', {}, [
              done.length ? el('p', { text: '取り込めた人：' + done.join('、') }) : null,
              el('h4', { text: '取り込めなかったもの', style: 'margin-top:10px' })
            ].concat(failed.map(function (m) { return el('div', { class: 'vd', text: '・' + m }); }))),
              [el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })]);
          } else {
            toast(done.length + '人分の希望を取り込みました（' + done.join('、') + '）');
          }
        }
      })
    ]);
  }

  function importCodeDialog() {
    var ta = el('textarea', { placeholder: 'ここにコードを貼り付け（複数人分を続けて貼ってもOK）', style: 'width:100%;height:140px;font-family:monospace;font-size:11px' });
    var msg = el('p', { class: 'hint', text: 'スタッフから受け取ったコードを貼り付けて［確認へ進む］を押してください。' });
    modal('コードの取り込み', el('div', {}, [msg, ta]), [
      el('button', {
        class: 'btn', text: '確認へ進む', onclick: function () {
          // LINE から名前や日時ごと貼り付けられても、コードの部分だけ拾う
          var raw = String(ta.value || '');
          var tokens = raw.match(/SHIFT1:[A-Za-z0-9+/=]+/g) || [];
          var chunks = tokens.length ? tokens
            : raw.split(/\s*\n\s*\n\s*|\s*\n(?=SHIFT[01]:)/)
              .map(function (x) { return x.trim(); }).filter(Boolean);
          if (!chunks.length) { msg.textContent = 'コードが入力されていません'; return; }
          var items = [], ng = [];
          chunks.forEach(function (c, i) {
            try { items.push({ src: 'コード' + (i + 1), obj: decodeCode(c) }); }
            catch (err) { ng.push('コード' + (i + 1) + '：読み取れませんでした'); }
          });
          if (!items.length) { msg.textContent = '取り込めるコードがありませんでした'; return; }
          closeModal();
          showAssignDialog(items, ng);
        }
      }),
      el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })
    ]);
  }

  var REQ_CYCLE = ['', 'off', 'must', 'paid', 'want'];
  var REQ_LABEL = { '': '', off: '△', must: '×', paid: '有', want: '◎' };
  var REQ_CLASS = { '': '', off: 'req-off', must: 'req-must', paid: 'req-paid', want: 'req-want' };

  var REQ_NAME = { '': '希望なし', off: 'できれば休みたい', must: '絶対に休みたい', paid: '有給を使いたい', want: 'ぜひ入りたい' };

  function reqCell(e, date) {
    var td = el('td', {});
    var cur = Store.requestOf(e.id, date);

    /* 押されたセルだけ書き換える。全体を作り直すと人数が増えたときに重くなるため */
    function paint() {
      td.className = 'req-cell ' + REQ_CLASS[cur];
      td.textContent = REQ_LABEL[cur];
      td.setAttribute('aria-label',
        e.name + ' ' + date.slice(5) + ' ' + REQ_NAME[cur] + '（押すと切り替わります）');
    }
    paint();

    return makeActivatable(td, '', function () {
      cur = REQ_CYCLE[(REQ_CYCLE.indexOf(cur) + 1) % REQ_CYCLE.length];
      if (!D.requests[e.id]) D.requests[e.id] = {};
      if (cur === '') delete D.requests[e.id][date]; else D.requests[e.id][date] = cur;
      Store.save();
      paint();
    });
  }

  /* ================= 希望入力のカレンダー =================
     31行の表は埋めるのが苦痛なので、カレンダーで見て、日を押して入力する。
     cfg: { year, month, getAvail(date), setAvail(date,obj), getReq(date), setReq(date,v), after() } */

  var AVAIL_LABEL = { '': '未入力', allday: '終日OK', time: '時間', off: '行けない' };
  var REQ_MARK = { '': '', off: '△', must: '×', paid: '有', want: '◎' };

  function availMode(av) { return !av ? '' : av.off ? 'off' : av.allday ? 'allday' : 'time'; }

  function requestCalendar(cfg) {
    var dates = U.monthDates(cfg.year, cfg.month);
    var start = (D.settings && D.settings.weekStartsOn) || 0;
    var order = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return (start + i) % 7; });

    var head = el('div', { class: 'cal-head' }, order.map(function (w) {
      return el('div', { class: w === 0 ? 'sun' : w === 6 ? 'sat' : '', text: U.WD[w] });
    }));

    var cells = [];
    var lead = (U.weekdayOf(dates[0]) - start + 7) % 7;
    for (var i = 0; i < lead; i++) cells.push(el('div', { class: 'cal-day blank' }));

    dates.forEach(function (d) {
      var w = U.weekdayOf(d);
      var hol = Store.holidayName(d);
      var av = cfg.getAvail(d);
      var m = availMode(av);
      var req = cfg.getReq(d);

      var state = m === '' ? 'none' : m === 'off' ? 'no' : 'yes';
      var slots = m === 'time' ? Store.availSlots(av) : null;
      var sub = m !== 'time' ? AVAIL_LABEL[m]
        : slots.length === 1 ? slots[0].from + '〜' : '時間' + slots.length + 'つ';

      var b = el('button', {
        class: 'cal-day ' + state + (w === 0 || hol ? ' sun' : w === 6 ? ' sat' : ''),
        title: d + (hol ? '（' + hol + '）' : ''),
        onclick: function () { dayBox(cfg, d); }
      }, [
        el('span', { class: 'd', text: String(+d.slice(8)) }),
        el('span', { class: 's', text: sub }),
        req ? el('span', { class: 'm ' + REQ_CLASS[req], text: REQ_MARK[req] }) : null
      ]);
      b.setAttribute('aria-label',
        (+d.slice(5, 7)) + '月' + (+d.slice(8)) + '日 ' + AVAIL_LABEL[m]
        + (req ? ' ' + REQ_NAME[req] : '') + '（押すと入力できます）');
      cells.push(b);
    });

    return el('div', {}, [head, el('div', { class: 'cal' }, cells)]);
  }

  /** 日を押したときに開く入力ボックス */
  function dayBox(cfg, date) {
    var w = U.WD[U.weekdayOf(date)];
    var hol = Store.holidayName(date);
    var title = (+date.slice(5, 7)) + '月' + (+date.slice(8)) + '日（' + w + '）' + (hol ? ' ' + hol : '');

    function redraw() { cfg.after(); dayBox(cfg, date); }

    var av = cfg.getAvail(date);
    var m = availMode(av);
    // 「午前だけ」「夜だけ」のように、1日にいくつでも時間帯を持てる
    var slots = m === 'time' ? Store.availSlots(av).map(function (s) { return { from: s.from, to: s.to }; }) : [];
    function saveSlots() { cfg.setAvail(date, slots.length ? { slots: slots } : null); }

    var b = el('div', {}, []);

    b.appendChild(el('h4', { text: 'この日は出勤できますか？' }));
    b.appendChild(el('div', { class: 'pick' }, [
      { v: 'allday', t: '終日OK' }, { v: 'time', t: '時間を指定' },
      { v: 'off', t: '行けない' }, { v: '', t: '未入力' }
    ].map(function (o) {
      return el('button', {
        class: 'btn ' + (m === o.v ? '' : 'ghost'), text: o.t,
        onclick: function () {
          if (o.v === '') cfg.setAvail(date, null);
          else if (o.v === 'allday') cfg.setAvail(date, { allday: true });
          else if (o.v === 'off') cfg.setAvail(date, { off: true });
          else cfg.setAvail(date, { slots: slots.length ? slots : [{ from: '09:00', to: '18:00' }] });
          redraw();
        }
      });
    })));

    if (m === 'time') {
      slots.forEach(function (s, i) {
        var fromI = input('time', s.from, null, { onchange: function (ev) {
          if (!U.isTime(ev.target.value)) return;
          s.from = ev.target.value; saveSlots(); redraw();
        } });
        var toI = input('time', s.to, null, { onchange: function (ev) {
          if (!U.isTime(ev.target.value)) return;
          s.to = ev.target.value; saveSlots(); redraw();
        } });
        b.appendChild(el('div', { class: 'row', style: 'margin-top:8px;align-items:flex-end' }, [
          field(i === 0 ? '何時から' : '（' + (i + 1) + 'つめ）何時から', fromI),
          field('何時まで', toI),
          slots.length > 1 ? el('button', {
            class: 'btn ghost sm danger', text: 'この時間帯を消す',
            onclick: function () { slots.splice(i, 1); saveSlots(); redraw(); }
          }) : null
        ].filter(Boolean)));
      });

      b.appendChild(el('div', { style: 'margin-top:10px' }, [
        iconBtn('plus', '時間帯を増やす', {
          class: 'btn ghost sm',
          onclick: function () {
            var last = slots[slots.length - 1];
            slots.push({ from: last ? last.to : '09:00', to: '22:00' });
            saveSlots(); redraw();
          }
        })
      ]));
      b.appendChild(el('p', { class: 'hint', style: 'margin-top:6px', text:
        '午前と夜だけ行ける、のように分かれるときは時間帯を増やしてください。' }));
    }

    var req = cfg.getReq(date);
    b.appendChild(el('h4', { text: '希望はありますか？', style: 'margin-top:20px' }));
    b.appendChild(el('div', { class: 'pick' }, [
      { v: '', t: 'とくになし' }, { v: 'off', t: '休みたい' }, { v: 'must', t: '絶対に休みたい' },
      { v: 'paid', t: '有給を使いたい' }, { v: 'want', t: 'ぜひ入りたい' }
    ].map(function (o) {
      return el('button', {
        class: 'btn ' + (req === o.v ? '' : 'ghost'), text: o.t,
        onclick: function () { cfg.setReq(date, o.v); redraw(); }
      });
    })));

    var idx = U.monthDates(cfg.year, cfg.month).indexOf(date);
    var all = U.monthDates(cfg.year, cfg.month);
    var foot = [];
    if (idx > 0) foot.push(iconBtn('prev', '前の日', { class: 'btn ghost', onclick: function () { cfg.after(); dayBox(cfg, all[idx - 1]); } }));
    if (idx < all.length - 1) foot.push(iconBtn('next', '次の日', { class: 'btn ghost', onclick: function () { cfg.after(); dayBox(cfg, all[idx + 1]); } }));
    foot.push(el('button', { class: 'btn', text: '閉じる', onclick: function () { cfg.after(); closeModal(); } }));

    modal(title, b, foot);
  }

  function staffSubmitCard(e, dates) {
    var locked = false;

    var cal = requestCalendar({
      year: D.settings.year, month: D.settings.month,
      getAvail: function (d) { return (D.avail[e.id] && D.avail[e.id][d]) || null; },
      setAvail: function (d, v) {
        if (!D.avail[e.id]) D.avail[e.id] = {};
        if (v === null) delete D.avail[e.id][d]; else D.avail[e.id][d] = v;
      },
      getReq: function (d) { return Store.requestOf(e.id, d); },
      setReq: function (d, v) {
        if (!D.requests[e.id]) D.requests[e.id] = {};
        if (v === '') delete D.requests[e.id][d]; else D.requests[e.id][d] = v;
      },
      after: function () { Store.save(); render(); }
    });

    var bulk = el('div', { class: 'row', style: 'margin-bottom:10px' }, locked ? [] : [
      el('button', {
        class: 'btn ghost sm', text: '全部「終日OK」', onclick: function () {
          if (!D.avail[e.id]) D.avail[e.id] = {};
          dates.forEach(function (d) { D.avail[e.id][d] = { allday: true }; });
          Store.save(); render();
        }
      }),
      el('button', {
        class: 'btn ghost sm', text: '平日だけ終日OK', onclick: function () {
          if (!D.avail[e.id]) D.avail[e.id] = {};
          dates.forEach(function (d) {
            var w = U.weekdayOf(d);
            D.avail[e.id][d] = (w === 0 || w === 6) ? { off: true } : { allday: true };
          });
          Store.save(); render();
        }
      }),
      el('button', {
        class: 'btn ghost sm', text: '全部「時間指定」にする', onclick: function () {
          if (!D.avail[e.id]) D.avail[e.id] = {};
          dates.forEach(function (d) {
            var cur = D.avail[e.id][d];
            if (cur && cur.off) return;
            var keep = Store.availSlots(cur);
            D.avail[e.id][d] = { slots: (keep && keep !== 'any' && keep !== false) ? keep : [{ from: '09:00', to: '18:00' }] };
          });
          Store.save(); render();
        }
      }),
      el('button', {
        class: 'btn ghost sm danger', text: '入力をクリア', onclick: function () {
          if (!confirm('入力した内容をすべて消します。よろしいですか？')) return;
          delete D.avail[e.id]; delete D.requests[e.id];
          D.submissions[e.id] = { status: 'open', at: '' };
          Store.save(); render();
        }
      })
    ]);

    var doneCount = dates.filter(function (d) { return D.avail[e.id] && D.avail[e.id][d]; }).length;

    var foot = [
      el('button', {
        class: 'btn big', text: 'この内容で提出する', onclick: function () {
          if (doneCount === 0 && !confirm('まだ1日も入力されていません。このまま提出しますか？')) return;
          var now = new Date();
          D.submissions[e.id] = {
            status: 'submitted',
            at: now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate() + ' ' + U.pad(now.getHours()) + ':' + U.pad(now.getMinutes())
          };
          Store.save();
          toast(e.name + 'さんの希望を保存しました');
          staffView = ''; render();
        }
      }),
      el('button', {
        class: 'btn ghost', text: '提出コードをコピー', title: '別の端末で入力した場合、このコードを責任者に送ってください',
        onclick: function () { showSubmissionCode(e); }
      }),
      el('button', { class: 'btn ghost', text: '閉じる', onclick: function () { staffView = ''; render(); } })
    ];

    var sub = Store.submissionOf(e.id);
    var box = card(e.name + ' さんの希望提出（' + D.settings.year + '年' + D.settings.month + '月）',
      '行ける日と時間を選んでください。', [
      el('div', { class: 'row', style: 'margin-bottom:8px' }, [
        el('span', { class: 'badge ' + (sub.status === 'submitted' ? 'ok' : 'warn'), text: sub.status === 'submitted' ? '提出済み（' + sub.at + '）' : '未提出' }),
        el('span', { class: 'badge ' + (doneCount === dates.length ? 'ok' : 'warn'), text: '入力 ' + doneCount + ' / ' + dates.length + ' 日' })
      ]),
      bulk,
      cal,
      el('div', { class: 'row', style: 'margin-top:12px' }, foot)
    ]);
    box.id = 'staffSubmit';
    return box;
  }

  /* 提出内容をテキストコード化（別端末で入力 → 責任者に送って取り込む用） */
  function showSubmissionCode(e) {
    var code = encodeCode(Store.exportSubmission(e.id));
    var ta = el('textarea', { readonly: 'readonly', style: 'width:100%;height:140px;font-family:monospace;font-size:11px' });
    ta.value = code;
    var b = el('div', {}, [
      el('p', { class: 'hint', text: 'このコードをコピーして、LINEなどで責任者に送ってください。責任者は［③ 希望を入れる］の［コードを貼り付けて取り込む］に貼り付けます。' }),
      ta
    ]);
    modal(e.name + ' さんの提出コード', b, [
      el('button', { class: 'btn', text: 'コピーする', onclick: function () { copyText(code, ta); } }),
      el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })
    ]);
  }

  function encodeCode(obj) {
    var json = JSON.stringify(obj);
    try { return 'SHIFT1:' + btoa(unescape(encodeURIComponent(json))); }
    catch (err) { return 'SHIFT0:' + json; }
  }
  function decodeCode(text) {
    text = String(text || '').trim();
    if (text.indexOf('SHIFT1:') === 0) return JSON.parse(decodeURIComponent(escape(atob(text.slice(7)))));
    if (text.indexOf('SHIFT0:') === 0) return JSON.parse(text.slice(7));
    return JSON.parse(text);   // 生のJSONも受け付ける
  }

  /* ================= ④ シフト表 ================= */
  function renderShift() {
    var p = document.getElementById('panel-shift'); p.innerHTML = '';
    var dates = Store.monthDates();
    var res = D.lastResult;

    var head = el('div', { class: 'row', style: 'margin-bottom:8px;align-items:center' }, [
      iconBtn('prev', '前月', { class: 'btn ghost sm', onclick: function () { moveMonth(-1); } }),
      el('strong', { style: 'font-size:16px', text: D.settings.year + '年 ' + D.settings.month + '月' }),
      iconBtn('next', '翌月', { class: 'btn ghost sm', onclick: function () { moveMonth(1); } }),
      el('span', { style: 'width:12px' }),
      el('button', { class: 'btn big', text: 'シフトを自動作成', onclick: doGenerate }),
      el('button', {
        class: 'btn ghost', text: 'この月を空にする', onclick: function () {
          if (!confirm(D.settings.month + '月のシフトを消します。よろしいですか？（他の月は残ります）')) return;
          var prefix = D.settings.year + '-' + U.pad(D.settings.month);
          Object.keys(D.assignments).forEach(function (dt) { if (dt.indexOf(prefix) === 0) delete D.assignments[dt]; });
          D.lastResult = null; saveAndRender();
        }
      }),
      iconBtn('image', '画像で保存', { onclick: exportImage }),
      iconBtn('download', 'CSV出力', { class: 'btn ghost', onclick: exportCsv }),
      iconBtn('print', '印刷', {
        class: 'btn ghost', onclick: function () {
          if (typeof window !== 'undefined' && window.print) window.print();
        }
      })
    ]);
    p.appendChild(head);


    /* 作成前チェック：作る前に分かる問題を先に出す */
    var pre = preflight();
    if (pre.length) {
      p.appendChild(card('作成前チェック', null,
        pre.map(function (x) {
          return el('div', { class: 'violation ' + (x.level === 'ng' ? 'hard' : '') }, [
            el('div', { class: 'vt', text: x.msg }),
            x.hint ? el('div', { class: 'vd', text: x.hint }) : null
          ]);
        })));
    }

    if (res) {
      var hardN = res.violations.filter(function (v) { return v.level === 'hard'; }).length;
      var softN = res.violations.length - hardN;
      p.appendChild(card('作成結果', '', [
        el('div', { class: 'grid2' }, [
          stat('法令・必須違反', hardN + ' 件', hardN ? 'ng' : 'ok'),
          stat('要調整（希望など）', softN + ' 件', softN ? 'warn' : 'ok'),
          stat('人員不足の枠', res.unfilled.length + ' 件', res.unfilled.length ? 'warn' : 'ok'),
          stat('概算人件費', U.yen(res.totalPay))
        ]),
        res.violations.length ? el('div', { style: 'margin-top:12px' }, res.violations.slice(0, 60).map(function (v) {
          return el('div', { class: 'violation ' + (v.level === 'hard' ? 'hard' : '') }, [
            el('div', { class: 'vt', text: v.msg }),
            el('div', { class: 'vd', text: Rules.DEF_MAP[v.ruleId] ? Rules.DEF_MAP[v.ruleId].name : '' })
          ]);
        })) : el('p', { class: 'muted', text: 'ルール違反はありません。' }),
        res.log && res.log.length ? el('div', { style: 'margin-top:8px' }, res.log.map(function (l) { return el('div', { class: 'vd', text: '・' + l }); })) : null
      ]));
    }

    var zc = zeroDayCard();
    if (zc) p.appendChild(zc);

    /* シフト表（人 × 日） */
    var thead = el('tr', {}, [el('th', { class: 'namecol', text: '氏名' })].concat(dates.map(function (d) {
      var w = U.weekdayOf(d);
      return el('th', { class: w === 0 || Store.isHoliday(d) ? 'sun' : w === 6 ? 'sat' : '', text: d.slice(8) + '\n' + U.WD[w], style: 'white-space:pre;text-align:center' });
    })).concat([el('th', { text: '日数' }), el('th', { text: '時間' })]));

    var rows = D.employees.map(function (e) {
      var days = 0, mins = 0;
      var tds = dates.map(function (d) {
        var stId = shiftOfEmp(e.id, d);
        var td, what;
        if (stId) {
          var st = Store.stById(stId);
          days++; mins += Store.stCalc(st).work;
          what = st.name;
          td = el('td', { class: 'cell-shift', text: st.short || st.name, style: 'background:' + st.color + '4d;color:inherit' });
        } else {
          var req = Store.requestOf(e.id, d);
          what = req ? REQ_NAME[req] : '休み';
          td = el('td', { class: 'cell-shift empty ' + (REQ_CLASS[req] || ''), text: req ? REQ_LABEL[req] : '・' });
        }
        return makeActivatable(td, e.name + ' ' + d.slice(5) + ' ' + what + '（押すと変更できます）',
          function () { openCell(e, d); });
      });
      return el('tr', {}, [el('td', { class: 'namecol', text: e.name })].concat(tds)
        .concat([el('td', { class: 'right', text: String(days) }), el('td', { class: 'right', text: U.min2h(mins) })]));
    });

    /* 日別の人数。足りない枠は押すと理由が見られる */
    var needRows = D.shiftTypes.map(function (st) {
      return el('tr', {}, [el('td', { class: 'namecol', text: st.name + ' の人数' })].concat(dates.map(function (d) {
        var need = Store.needOf(d, st.id), got = Store.assignedOf(d, st.id).length;
        if (need === 0 && got === 0) return el('td', { class: 'cell-shift empty', text: '' });
        var okc = got >= need;
        var td = el('td', {
          class: 'cell-shift', text: got + '/' + need,
          style: okc ? 'color:var(--ok)' : 'color:#fff;background:var(--ng)'
        });
        return makeActivatable(td,
          st.name + ' ' + d.slice(5) + ' ' + got + '人 / 必要' + need + '人'
            + (okc ? '' : '（押すと足りない理由が見られます）'),
          function () { shortageDialog(d, st.id); });
      })).concat([el('td', {}), el('td', {})]));
    });

    p.appendChild(card('シフト表', '人が足りない日（赤いマス）を押すと、誰が休み希望を出していて、誰がまだ希望を出していないかが分かります。', [
      rovingGrid(el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [thead]), el('tbody', {}, rows.concat(needRows))])]))
    ]));
  }

  /** 作成前に分かる問題を洗い出す */
  function preflight() {
    var out = [];
    var dates = Store.monthDates();

    if (!D.employees.length) { out.push({ level: 'ng', msg: '従業員が1人も登録されていません', hint: '「② 従業員」で追加してください' }); return out; }

    var totalNeed = 0;
    dates.forEach(function (d) { D.shiftTypes.forEach(function (st) { totalNeed += Store.needOf(d, st.id); }); });
    if (totalNeed === 0) out.push({ level: 'ng', msg: '必要人数が全部0人です', hint: '「① 基本設定」の必要人数（曜日別）を入れてください' });

    // 供給と需要のざっくり比較
    var capacity = D.employees.reduce(function (a, e) { return a + (e.maxDays || 0); }, 0);
    if (totalNeed > capacity)
      out.push({
        level: 'warn', msg: '必要な延べ人数（' + totalNeed + '人日）が、全員の最大出勤日数の合計（' + capacity + '人日）を超えています',
        hint: '人手が足りません。必要人数を下げるか、最大出勤日数を見直すか、増員が必要です'
      });

    // 勤務区分ごとに担当できる人がいるか
    D.shiftTypes.forEach(function (st) {
      var need = dates.some(function (d) { return Store.needOf(d, st.id) > 0; });
      if (!need) return;
      var n = D.employees.filter(function (e) { return (e.canShift || []).indexOf(st.id) >= 0; }).length;
      if (n === 0) out.push({ level: 'ng', msg: st.name + 'を担当できる人が1人もいません', hint: '「② 従業員」の「担当できる勤務区分」を確認してください' });

    });

    // 新人に対する教育担当
    var newbies = D.employees.filter(function (e) { return e.newbie; });
    if (newbies.length && !D.employees.some(function (e) { return !e.newbie; }))
      out.push({ level: 'ng', msg: '登録されているのが新人だけです', hint: '新人は新人以外と組ませるため、このままでは勤務が入りません' });

    // 休憩不足
    D.shiftTypes.forEach(function (st) {
      var c = Store.stCalc(st);
      if ((c.work > 480 && st.breakMin < 60) || (c.work > 360 && st.breakMin < 45))
        out.push({ level: 'ng', msg: st.name + 'の休憩時間が法定を下回っています（実働' + U.min2h(c.work) + 'h / 休憩' + st.breakMin + '分）' });
    });

    // 希望の入力状況（入力がない日は出勤させない仕様なので、ここが一番効く）
    var noInput = D.employees.filter(function (e) {
      return !dates.some(function (d) { return D.avail[e.id] && D.avail[e.id][d]; });
    });
    if (noInput.length)
      out.push({
        level: 'ng', msg: noInput.map(function (e) { return e.name; }).join('、') + ' さんの希望が未入力です',
        hint: '入力がない日は出勤させないため、この人たちはシフトに入りません。「③ 希望を入れる」で入力してください'
      });
    var partial = D.employees.filter(function (e) {
      if (noInput.indexOf(e) >= 0) return false;
      return dates.filter(function (d) { return D.avail[e.id] && D.avail[e.id][d]; }).length < dates.length;
    });
    if (partial.length)
      out.push({
        level: 'warn', msg: partial.map(function (e) { return e.name; }).join('、') + ' さんは一部の日が未入力です',
        hint: '未入力の日は出勤しない扱いになります'
      });

    return out;
  }

  /** 今月まだ1日も入っていない人（希望の取り込み漏れに気づくため） */
  function zeroDayStaff() {
    var dates = Store.monthDates();
    return D.employees.map(function (e) {
      var days = dates.filter(function (d) { return shiftOfEmp(e.id, d); }).length;
      if (days > 0) return null;
      var inputDays = dates.filter(function (d) { return D.avail[e.id] && D.avail[e.id][d]; }).length;
      var okDays = dates.filter(function (d) {
        var av = Store.availOf(e.id, d);
        return av && av !== false;
      }).length;
      var reason = inputDays === 0 ? '希望が未入力（取り込まれていません）'
        : okDays === 0 ? '本人が全日「行けない」と入力'
          : '希望はあるが、条件が合わず入りませんでした';
      return { emp: e, reason: reason, inputDays: inputDays };
    }).filter(Boolean);
  }

  function zeroDayCard() {
    // まだ一度も作っていない月で「0日の人」を並べても、作り忘れているだけ。
    // 「条件が合わず入りませんでした」は事実と違ううえ、失敗したように見える。
    var made = Store.monthDates().some(function (d) {
      return D.shiftTypes.some(function (st) { return Store.assignedOf(d, st.id).length > 0; });
    });
    if (!made) return null;

    var zs = zeroDayStaff();
    if (!zs.length) return null;
    return card('今月シフトが0日の人（' + zs.length + '名）',
      '希望の取り込み漏れがないか確認してください。', zs.map(function (z) {
        return el('div', { class: 'violation ' + (z.inputDays === 0 ? 'hard' : '') }, [
          el('div', { class: 'vt', text: z.emp.name }),
          el('div', { class: 'vd', text: z.reason }),
          z.inputDays === 0 ? el('button', {
            class: 'btn ghost sm', style: 'margin-top:4px',
            text: 'この人の希望を入力する', onclick: function () { staffView = z.emp.id; scrollTo = 'staffSubmit'; switchTab('request'); }
          }) : null
        ]);
      }));
  }

  function stat(k, v, cls) {
    var color = cls === 'ng' ? 'color:var(--ng)' : cls === 'warn' ? 'color:var(--warn)' : cls === 'ok' ? 'color:var(--ok)' : '';
    return el('div', { class: 'stat' }, [
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v', style: color, text: v })
    ]);
  }

  function shiftOfEmp(empId, date) {
    var a = D.assignments[date] || {};
    var found = '';
    Object.keys(a).forEach(function (stId) { if ((a[stId] || []).indexOf(empId) >= 0) found = stId; });
    return found;
  }

  function openCell(e, date) {
    var cur = shiftOfEmp(e.id, date);
    var b = el('div', {}, []);
    b.appendChild(el('p', { class: 'muted', text: date + '（' + U.WD[U.weekdayOf(date)] + '）　' + e.name + ' さん' }));

    // 提出内容
    var av = Store.availOf(e.id, date);
    var avText = av === null ? '未提出' : av === false ? '本人「行けない」' : Store.availText(av);
    var req = Store.requestOf(e.id, date);
    b.appendChild(el('p', {}, [
      el('span', { class: 'chip', text: '提出：' + avText }),
      req ? el('span', { class: 'chip', text: '希望：' + { off: '休み希望', must: '絶対休', paid: '有給', want: '出勤希望' }[req] }) : null
    ]));

    // 急な欠勤への対応（いちばん使う操作なので最上部に出す）
    if (cur) {
      b.appendChild(el('div', { class: 'row', style: 'margin:16px 0' }, [
        el('button', {
          class: 'btn', text: 'この人が休む → 代わりを探す',
          onclick: function () { absenceDialog(e, date, cur); }
        })
      ]));
    }

    // 変更ボタン
    var btns = el('div', { class: 'row', style: 'margin:12px 0' }, D.shiftTypes.map(function (st) {
      var ngs = cur === st.id ? [] : Solver.checkManual(D, assignmentsWithout(e.id, date), e.id, date, st.id);
      var btn = el('button', {
        class: 'btn ' + (cur === st.id ? '' : 'ghost'),
        text: st.name + (ngs.length ? '（NG）' : ''),
        onclick: function () {
          if (ngs.length && !confirm('この割当は次のルールに反します：\n' + ngs.map(function (n) { return '・' + n.msg; }).join('\n') + '\nそれでも入れますか？')) return;
          setCell(e.id, date, st.id); closeModal();
        }
      });
      if (ngs.length) btn.title = ngs.map(function (n) { return n.msg; }).join(' / ');
      return btn;
    }).concat([el('button', { class: 'btn ghost danger', text: '休み（外す）', onclick: function () { setCell(e.id, date, ''); closeModal(); } })]));
    b.appendChild(btns);

    // NG理由
    var ngList = [];
    D.shiftTypes.forEach(function (st) {
      if (cur === st.id) return;
      var ngs = Solver.checkManual(D, assignmentsWithout(e.id, date), e.id, date, st.id);
      ngs.forEach(function (n) { ngList.push(st.name + '：' + n.msg); });
    });
    if (ngList.length) {
      b.appendChild(el('h4', { text: '入れられない理由' }));
      ngList.forEach(function (t) { b.appendChild(el('div', { class: 'vd', text: '・' + t })); });
    }

    // 生成時の根拠
    var tr = D.lastResult && D.lastResult.trace[date] && D.lastResult.trace[date][cur] && D.lastResult.trace[date][cur][e.id];
    if (tr) {
      b.appendChild(el('h4', { text: 'この人が選ばれた理由', style: 'margin-top:14px' }));
      (tr.why || []).filter(function (w) { return w.label; }).forEach(function (w) {
        b.appendChild(el('div', { class: 'vd', text: (w.v > 0 ? '△ ' : w.v < 0 ? '◎ ' : '・') + w.label + '（' + (w.v > 0 ? '+' : '') + w.v + '点）' }));
      });
      if (tr.alternatives && tr.alternatives.length) {
        b.appendChild(el('div', { class: 'vd', style: 'margin-top:6px', text: '次点：' + tr.alternatives.map(function (a) { return a.name + '(' + a.score + ')'; }).join('、') }));
      }
      if (tr.blocked && tr.blocked.length) {
        b.appendChild(el('h4', { text: '他の人が入れなかった理由', style: 'margin-top:10px' }));
        tr.blocked.slice(0, 6).forEach(function (x) {
          b.appendChild(el('div', { class: 'vd', text: '・' + x.name + '：' + x.reason }));
        });
      }
    }

    // その枠に入れる他の候補
    if (cur) {
      var cands = Solver.candidatesFor(Rules.buildContext(D, U.clone(assignmentsWithout(e.id, date))), { date: date, stId: cur, need: Store.needOf(date, cur) });
      if (cands.length) {
        b.appendChild(el('h4', { text: '交代できる人', style: 'margin-top:14px' }));
        b.appendChild(el('div', { class: 'row' }, cands.slice(0, 8).map(function (c) {
          return el('button', {
            class: 'btn ghost sm', text: Store.empById(c.empId).name, onclick: function () {
              setCell(e.id, date, '');
              setCell(c.empId, date, cur);
              closeModal();
            }
          });
        })));
      }
    }

    modal('勤務の変更', b, [el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })]);
  }

  /** 足りない枠を押したとき：なぜ埋まらないのかを、人の名前で見せる */
  function shortageDialog(date, stId) {
    var st = Store.stById(stId);
    var need = Store.needOf(date, stId);
    var inShift = Store.assignedOf(date, stId).map(function (id) { return Store.empById(id); }).filter(Boolean);
    var w = U.WD[U.weekdayOf(date)];
    var head = (+date.slice(5, 7)) + '月' + (+date.slice(8)) + '日（' + w + '）' + st.name;

    var wantOff = [], noAnswer = [], cantGo = [], other = [], already = [];
    D.employees.forEach(function (e) {
      if (inShift.indexOf(e) >= 0) return;
      var req = Store.requestOf(e.id, date);
      if (req === 'off' || req === 'must' || req === 'paid') {
        wantOff.push({ e: e, why: { off: 'できれば休みたい', must: '絶対に休みたい', paid: '有給を使いたい' }[req] });
        return;
      }
      var av = Store.availOf(e.id, date);
      if (av === null) { noAnswer.push({ e: e }); return; }
      if (av === false) { cantGo.push({ e: e }); return; }
      if (shiftOfEmp(e.id, date)) { already.push({ e: e, why: Store.stById(shiftOfEmp(e.id, date)).name + 'に入っています' }); return; }
      var ng = Solver.checkManual(D, assignmentsWithout(e.id, date), e.id, date, stId);
      other.push({ e: e, why: ng.length ? ng[0].msg : '条件は合いますが、他の枠に回っています' });
    });

    function group(title, list, cls, note) {
      if (!list.length) return null;
      var box = el('div', { style: 'margin-top:16px' }, [
        el('h4', { text: title + '（' + list.length + '名）' })
      ]);
      if (note) box.appendChild(el('p', { class: 'hint', text: note }));
      list.forEach(function (x) {
        box.appendChild(el('div', { class: 'violation ' + (cls || ''), style: 'margin-bottom:6px' }, [
          el('div', { class: 'vt', text: x.e.name }),
          x.why ? el('div', { class: 'vd', text: x.why }) : null
        ]));
      });
      return box;
    }

    var b = el('div', {}, [
      el('p', {}, [el('strong', { text: head })]),
      el('p', { class: 'hint', text: '必要 ' + need + '人 に対して ' + inShift.length + '人です。' }),
      inShift.length ? el('p', {}, inShift.map(function (e) {
        return el('span', { class: 'chip', text: e.name });
      })) : null,
      group('休みの希望を出している人', wantOff, '',
        '休みたいと出した日には入れません。どうしても必要なときは本人に確認してください。'),
      group('まだ希望を出していない人', noAnswer, 'hard',
        '希望が未入力の日は出勤させません。ここが埋まると人が足りることがあります。'),
      group('本人が「行けない」と答えた人', cantGo, ''),
      group('同じ日に別の勤務が入っている人', already, ''),
      group('その他の理由で入れない人', other, '')
    ]);

    var foot = [];
    if (noAnswer.length) foot.push(el('button', {
      class: 'btn', text: '希望を入れる画面へ', onclick: function () {
        staffView = noAnswer[0].e.id; scrollTo = 'staffSubmit';
        closeModal(); switchTab('request');
      }
    }));
    foot.push(el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal }));
    modal('人が足りない理由', b, foot);
  }

  /* ================= 欠員対応 ================= */
  /** 「この人が急に休む」→ 代わりを4段階で提示する */
  function absenceDialog(emp, date, stId) {
    var st = Store.stById(stId);
    var o = Solver.coverageOptions(D, D.assignments, date, stId, emp.id);
    var w = U.WD[U.weekdayOf(date)];
    var head = (+date.slice(5, 7)) + '月' + (+date.slice(8)) + '日（' + w + '）' + st.name;

    function pickBtn(id, name, cls, confirmMsg) {
      return el('button', {
        class: 'btn ' + (cls || ''), text: name, onclick: function () {
          if (confirmMsg && !confirm(confirmMsg)) return;
          setCell(emp.id, date, '');      // 休む人を外す
          setCell(id, date, stId);        // 代わりを入れる
          closeModal();
          toast(name + 'さんに交代しました');
        }
      });
    }

    var b = el('div', {}, []);
    b.appendChild(el('p', { class: 'hint', text: head + '　' + emp.name + 'さんの代わりを探します。' }));

    /* ① すぐ入れる */
    b.appendChild(el('h4', { text: 'そのまま入れる人（' + o.ready.length + '名）' }));
    if (o.ready.length) {
      b.appendChild(el('div', { class: 'row', style: 'margin-bottom:4px' },
        o.ready.slice(0, 8).map(function (c) { return pickBtn(c.empId, c.name); })));
      o.ready.slice(0, 3).forEach(function (c) {
        var r = c.why.map(function (x) { return x.label; }).filter(Boolean).join(' / ');
        if (r) b.appendChild(el('div', { class: 'vd', text: '・' + c.name + '：' + r }));
      });
    } else {
      b.appendChild(el('p', { class: 'vd', text: 'ルールを守ったまま入れる人はいません。下の候補から選んでください。' }));
    }

    /* ② 本人に確認すれば入れる */
    if (o.askPerson.length) {
      b.appendChild(el('h4', { text: '本人に聞けば入れるかもしれない人（' + o.askPerson.length + '名）' }));
      b.appendChild(el('p', { class: 'vd', text: '本人の都合の問題だけです。電話して都合がつけば入れられます。' }));
      o.askPerson.forEach(function (c) {
        b.appendChild(el('div', { class: 'violation', style: 'margin-bottom:6px' }, [
          el('div', { class: 'vt', text: c.name }),
          el('div', { class: 'vd', text: c.reason }),
          el('div', { style: 'margin-top:6px' }, [
            pickBtn(c.empId, c.name, 'ghost sm', c.name + 'さんに確認は取れましたか？\n（' + c.reason + '）')
          ])
        ]));
      });
    }

    /* ③ 無理をさせれば入れる */
    if (o.stretch.length) {
      b.appendChild(el('h4', { text: '無理をさせれば入れる人（' + o.stretch.length + '名）' }));
      b.appendChild(el('p', { class: 'vd', text: '法令には触れませんが、店のルールを破ることになります。' }));
      o.stretch.slice(0, 6).forEach(function (c) {
        var msgs = c.breaks.map(function (x) { return x.msg; });
        b.appendChild(el('div', { class: 'violation', style: 'margin-bottom:6px' }, [
          el('div', { class: 'vt', text: c.name })
        ].concat(msgs.map(function (m) { return el('div', { class: 'vd', text: '・' + m }); }))
          .concat([el('div', { style: 'margin-top:6px' }, [
            pickBtn(c.empId, c.name, 'ghost sm', c.name + 'さんを入れると次のようになります。\n\n'
              + msgs.map(function (m) { return '・' + m; }).join('\n') + '\n\nそれでも入れますか？')
          ])])));
      });
    }

    /* ④ 入れられない */
    if (o.blocked.length) {
      var det = el('details', { class: 'rule', style: 'margin-top:12px' }, [
        el('summary', { text: '入れられない人（' + o.blocked.length + '名）' })
      ]);
      o.blocked.forEach(function (c) {
        det.appendChild(el('div', { class: 'vd', text: (c.isLaw ? '【法令】' : '') + c.name + '：' + c.reason }));
      });
      b.appendChild(det);
    }

    modal('欠員の代わりを探す', b, [
      el('button', {
        class: 'btn ghost danger', text: '代わりを立てず人数不足のままにする', onclick: function () {
          setCell(emp.id, date, '');
          closeModal();
          toast(head + ' は1人不足のままです');
        }
      }),
      el('button', { class: 'btn ghost', text: 'やめる', onclick: closeModal })
    ]);
  }

  function assignmentsWithout(empId, date) {
    var a = U.clone(D.assignments);
    if (a[date]) Object.keys(a[date]).forEach(function (stId) {
      a[date][stId] = (a[date][stId] || []).filter(function (x) { return x !== empId; });
    });
    return a;
  }

  function setCell(empId, date, stId) {
    if (!D.assignments[date]) D.assignments[date] = {};
    Object.keys(D.assignments[date]).forEach(function (s) {
      D.assignments[date][s] = (D.assignments[date][s] || []).filter(function (x) { return x !== empId; });
    });
    if (stId) {
      if (!D.assignments[date][stId]) D.assignments[date][stId] = [];
      D.assignments[date][stId].push(empId);
    }
    var rv = Solver.revalidate(D, D.assignments);
    if (D.lastResult) { D.lastResult.violations = rv.violations; D.lastResult.stats = rv.stats; D.lastResult.totalPay = rv.totalPay; }
    saveAndRender();
  }

  function moveMonth(delta) {
    var m = D.settings.month + delta, y = D.settings.year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    D.settings.year = y; D.settings.month = m;
    D.lastResult = null;
    saveAndRender();
  }

  function doGenerate() {
    var res = Solver.generate(D);
    D.assignments = res.assignments;
    D.lastResult = res;
    Store.save(); render();
    var hard = res.violations.filter(function (v) { return v.level === 'hard'; }).length;
    toast(hard === 0 ? 'シフトを作成しました（ルール違反なし）' : 'シフトを作成しました（要確認 ' + hard + ' 件）');
  }

  function exportImage() {
    var hasShift = Store.monthDates().some(function (d) {
      return D.shiftTypes.some(function (st) { return Store.assignedOf(d, st.id).length > 0; });
    });
    if (!hasShift) { toast('先にシフトを作成してください'); return; }
    try { ShiftImage.download(D); toast('画像を保存しました'); }
    catch (e) { toast('画像を作れませんでした'); }
  }

  function exportCsv() {
    var dates = Store.monthDates();
    var lines = [];
    lines.push(['氏名'].concat(dates.map(function (d) { return d.slice(5) + '(' + U.WD[U.weekdayOf(d)] + ')'; })).concat(['日数', '時間']).map(U.csv).join(','));
    D.employees.forEach(function (e) {
      var days = 0, mins = 0;
      var row = [e.name].concat(dates.map(function (d) {
        var stId = shiftOfEmp(e.id, d);
        if (!stId) return '';
        var st = Store.stById(stId); days++; mins += Store.stCalc(st).work;
        return st.name;
      }));
      lines.push(row.concat([days, U.min2h(mins)]).map(U.csv).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    U.download(blob, 'shift_' + D.settings.year + U.pad(D.settings.month) + '.csv');
    toast('CSVを保存しました');
  }

  /* ================= ⑤ 集計 ================= */
  function renderSummary() {
    var p = document.getElementById('panel-summary'); p.innerHTML = '';
    var rv = Solver.revalidate(D, D.assignments);
    var st = rv.stats;

    var rows = D.employees.map(function (e) {
      var s = st[e.id];
      var ytd = (e.ytdEarnings || 0) + s.pay;
      var capCls = e.incomeCap > 0 ? (ytd > e.incomeCap ? 'ng' : ytd > e.incomeCap * 0.9 ? 'warn' : 'ok') : '';
      return el('tr', {}, [
        el('td', { text: e.name }),
        el('td', { class: 'right', text: s.days + ' 日' + (e.minDays > s.days ? '（不足' + (e.minDays - s.days) + '）' : '') }),
        el('td', { class: 'right', text: s.hours + ' h' }),
        el('td', { class: 'right', text: s.nights + ' 回' }),
        el('td', { class: 'right', text: s.weekends + ' 回' }),
        el('td', { class: 'right', text: s.nightHours + ' h' }),
        el('td', { class: 'right', text: (s.otHours || 0) + ' h' }),
        el('td', { class: 'right', text: U.yen(s.pay) }),
        el('td', { class: 'right' }, [e.incomeCap > 0 ? el('span', { class: 'badge ' + capCls, text: U.yen(ytd) + ' / ' + U.yen(e.incomeCap) }) : el('span', { class: 'muted', text: '—' })])
      ]);
    });

    var totalHours = D.employees.reduce(function (a, e) { return a + st[e.id].hours; }, 0);
    p.appendChild(card('集計', null, [
      el('div', { class: 'grid2' }, [
        stat('総労働時間', totalHours.toFixed(1) + ' h'),
        stat('概算人件費', U.yen(rv.totalPay))
      ]),
      el('div', { class: 'scroll', style: 'margin-top:12px' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['氏名', '出勤日数', '労働時間', '夜勤', '土日祝', '深夜時間', '時間外', '賃金(概算)', '年収の壁'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])])
    ]));

    var zc2 = zeroDayCard();
    if (zc2) p.appendChild(zc2);

    // 公平性
    var nights = D.employees.map(function (e) { return st[e.id].nights; });
    var hours = D.employees.map(function (e) { return st[e.id].hours; });
    p.appendChild(card('公平性', null, [
      el('div', { class: 'grid2' }, [
        stat('夜勤の最大差', (Math.max.apply(null, nights.concat([0])) - Math.min.apply(null, nights.concat([0]))) + ' 回'),
        stat('労働時間の最大差', (Math.max.apply(null, hours.concat([0])) - Math.min.apply(null, hours.concat([0]))).toFixed(1) + ' h')
      ])
    ]));
  }

  /* ================= ルール設定（「準備」タブの末尾） ================= */
  function renderRules() {
    var p = document.getElementById('panel-setup');
    // 法令ルールは常に有効で変更できない。設定として並べても押せないので出さない。
    // 設定する場所をなくしたルールは、調整欄にも出さない
    var HIDDEN = { 'OPS-110': 1, 'OPS-003': 1, 'OPS-004': 1, 'OPS-A03': 1, 'OPS-A04': 1 };
    var editable = Rules.DEFS.filter(function (d) { return !Rules.cfg(D, d.id).lock && !HIDDEN[d.id]; });


    function ruleRow(d) {
      var c = Rules.cfg(D, d.id);
      var body = el('div', { class: 'row', style: 'margin-top:8px' }, [
        checkbox('このルールを使う', c.enabled, function (e) { setRule(d.id, { enabled: e.target.checked }); }),
        field('守り方', select([{ v: 'hard', t: '必ず守る' }, { v: 'soft', t: 'できるだけ守る' }], c.type,
          function (e) { setRule(d.id, { type: e.target.value }); }))
      ]);
      if (c.type === 'soft')
        body.appendChild(field('優先度', liveInput('number', c.weight, function (v) { setRuleQuiet(d.id, { weight: U.num(v, 0, 1e6, 0) }); }, { step: 100, min: 0 })));
      if (d.id === 'OPS-027')
        body.appendChild(field('勤務と勤務の間隔（時間）', liveInput('number', c.params.hours, function (v) { setRuleQuiet(d.id, { params: { hours: U.num(v, 0, 24, 0) } }); }, { min: 0, max: 24 })));

      return el('details', { class: 'rule', 'data-dk': 'rule-' + d.id }, [
        el('summary', {}, [
          el('span', { text: d.name + '　' }),
          el('span', {
            class: 'badge ' + (c.enabled ? (c.type === 'hard' ? 'ng' : 'warn') : 'ok'),
            text: !c.enabled ? '使わない' : c.type === 'hard' ? '必ず守る' : 'できるだけ守る'
          })
        ]),
        el('p', { class: 'hint', text: d.desc }),
        body
      ]);
    }

    var wrap = el('details', { class: 'rule', 'data-dk': 'rules' }, [
      el('summary', { text: '詳細設定' }),
      el('div', { style: 'margin-top:12px' }, editable.map(ruleRow))
    ]);
    p.appendChild(el('div', { class: 'card' }, [wrap]));
  }

  /** 値だけ書き換える（画面は作り直さない） */
  function setRuleQuiet(id, patch) {
    if (!D.ruleConfig[id]) D.ruleConfig[id] = {};
    Object.keys(patch).forEach(function (k) {
      if (k === 'params') D.ruleConfig[id].params = Object.assign({}, D.ruleConfig[id].params || {}, patch.params);
      else D.ruleConfig[id][k] = patch[k];
    });
  }
  function setRule(id, patch) { setRuleQuiet(id, patch); saveAndRender(); }

  /* ================= スタッフ入力ページ（?input=1） =================
     店の設定が何もなくても単体で動く。名前と行ける日時を入れてファイルに保存し、
     それを責任者が読み込む。手入力の手間をなくすための画面。 */
  var inputDraft = null;

  function loadDraft() {
    if (inputDraft) return inputDraft;
    var saved = null;
    try {
      if (typeof localStorage !== 'undefined') saved = JSON.parse(localStorage.getItem('shift-input-draft') || 'null');
    } catch (e) { saved = null; }
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth() + 2;      // 既定は翌月
    if (m > 12) { m = 1; y++; }
    inputDraft = saved && saved.avail ? saved
      : { name: '', year: y, month: m, wage: '', incomeCap: 0, ytdEarnings: '', avail: {}, requests: {} };
    return inputDraft;
  }
  function saveDraft() {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('shift-input-draft', JSON.stringify(inputDraft));
    } catch (e) { /* 保存できなくても入力は続けられる */ }
  }

  function renderInputPage() {
    var dr = loadDraft();
    var p = document.getElementById('panel-input');
    p.innerHTML = '';

    var dates = U.monthDates(dr.year, dr.month);
    var filled = dates.filter(function (d) { return dr.avail[d]; }).length;

    /* 名前と対象月 */
    p.appendChild(card('シフト希望の入力', '名前を入れて、カレンダーの日を押して答えてください。終わったら、いちばん下の［LINEなどで送る］を押します。', [
      el('div', { class: 'row' }, [
        el('div', { class: 'field grow' }, [el('label', { text: 'あなたの名前' }),
        input('text', dr.name, function (e) { dr.name = e.target.value; saveDraft(); }, { placeholder: '例）山田 太郎' })]),
        field('年', input('number', dr.year, function (e) { dr.year = U.num(e.target.value, 2000, 2100, dr.year); saveDraft(); render(); }, { min: 2000, max: 2100 })),
        field('月', select([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (mm) { return { v: mm, t: mm + '月' }; }), dr.month,
          function (e) { dr.month = +e.target.value; saveDraft(); render(); }))
      ]),
      el('div', { class: 'row', style: 'margin-top:12px' }, [
        field('あなたの時給', liveInput('number', dr.wage === undefined ? '' : dr.wage,
          function (v) { dr.wage = U.num(v, 0, 100000, 0); }, { step: 10, min: 0, placeholder: '例）1100' })),
        field('扶養の範囲で働きたい', select([
          { v: '', t: 'いいえ／わからない' },
          { v: '1030000', t: 'はい（103万円まで）' },
          { v: '1230000', t: 'はい（123万円まで）' },
          { v: '1300000', t: 'はい（130万円まで）' },
          { v: '1500000', t: 'はい（150万円まで）' }
        ], String(dr.incomeCap || ''), function (e) { dr.incomeCap = +e.target.value || 0; saveDraft(); render(); }))
      ]),
      dr.incomeCap > 0 ? el('div', { class: 'row', style: 'margin-top:8px' }, [
        field('今年すでに稼いだ金額', liveInput('number', dr.ytdEarnings === undefined ? '' : dr.ytdEarnings,
          function (v) { dr.ytdEarnings = U.num(v, 0, 1e9, 0); }, { step: 10000, min: 0, placeholder: '例）620000' }))
      ]) : null,
      el('div', { class: 'row', style: 'margin-top:12px' }, [
        el('button', {
          class: 'btn ghost sm', text: '全部「終日OK」', onclick: function () {
            dates.forEach(function (d) { dr.avail[d] = { allday: true }; }); saveDraft(); render();
          }
        }),
        el('button', {
          class: 'btn ghost sm', text: '平日だけ終日OK', onclick: function () {
            dates.forEach(function (d) {
              var w = U.weekdayOf(d);
              dr.avail[d] = (w === 0 || w === 6) ? { off: true } : { allday: true };
            });
            saveDraft(); render();
          }
        }),
        el('button', {
          class: 'btn ghost sm danger', text: '入力を消す', onclick: function () {
            if (!confirm('入力した内容をすべて消します。よろしいですか？')) return;
            dr.avail = {}; dr.requests = {}; saveDraft(); render();
          }
        }),
        el('span', { class: 'badge ' + (filled === dates.length ? 'ok' : 'warn'), text: '入力 ' + filled + ' / ' + dates.length + ' 日' })
      ])
    ]));

    p.appendChild(requestCalendar({
      year: dr.year, month: dr.month,
      getAvail: function (d) { return dr.avail[d] || null; },
      setAvail: function (d, v) { if (v === null) delete dr.avail[d]; else dr.avail[d] = v; },
      getReq: function (d) { return dr.requests[d] || ''; },
      setReq: function (d, v) { if (v === '') delete dr.requests[d]; else dr.requests[d] = v; },
      after: function () { saveDraft(); render(); }
    }));

    p.appendChild(card('できたら責任者に送る', '入力した内容は残るので、途中で閉じても続きからできます。', [
      el('div', { class: 'row' }, [
        iconBtn('share', 'LINEなどで送る', { class: 'btn big', onclick: shareInputCode }),
        iconBtn('copy', 'コードをコピー', { class: 'btn ghost', onclick: copyInputCode }),
        iconBtn('download', 'ファイルに保存', { class: 'btn ghost', onclick: saveInputFile })
      ]),
      el('p', { class: 'hint', style: 'margin-top:8px', text: '責任者は、送られた文をそのまま貼り付けるだけで取り込めます。' })
    ]));
  }

  function inputPayload() {
    var dr = loadDraft();
    if (!dr.name.trim()) { alert('名前を入れてください'); return null; }
    return {
      t: 'shift-submission', v: 1, name: dr.name.trim(), id: '',
      ym: dr.year + '-' + U.pad(dr.month),
      wage: U.num(dr.wage, 0, 100000, 0),
      incomeCap: U.num(dr.incomeCap, 0, 1e9, 0),
      ytdEarnings: U.num(dr.ytdEarnings, 0, 1e9, 0),
      avail: dr.avail, requests: dr.requests
    };
  }

  function saveInputFile() {
    var obj = inputPayload(); if (!obj) return;
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    U.download(blob, 'シフト希望_' + obj.name + '_' + obj.ym + '.json');
    toast('保存しました。責任者に送ってください');
  }

  /** LINE などにそのまま流せる文面にする（名前＋コード） */
  function shareText() {
    var obj = inputPayload(); if (!obj) return null;
    return obj.name + 'さんのシフト希望（' + obj.ym + '）\n' + encodeCode(obj);
  }

  function shareInputCode() {
    var text = shareText(); if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        var pr = navigator.share({ title: 'シフト希望', text: text });
        if (pr && pr['catch']) pr['catch'](function () { /* 送るのをやめただけ */ });
        return;
      }
    } catch (err) { /* 共有に対応していない端末はコピーに切り替える */ }
    copyText(text);
  }

  function copyInputCode() {
    var code = shareText(); if (!code) return;
    var ta = el('textarea', { readonly: 'readonly', style: 'width:100%;height:140px;font-family:monospace;font-size:11px' });
    ta.value = code;
    modal('提出コード', el('div', {}, [
      el('p', { class: 'hint', text: 'このコードをコピーして、LINEなどで責任者に送ってください。' }), ta
    ]), [
      el('button', { class: 'btn', text: 'コピー', onclick: function () { copyText(code, ta); } }),
      el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })
    ]);
  }

  /* ================= モード・タブ・初期化 ================= */

  /** モードに合わせて、タブ列と各パネルの表示を切り替える */
  function syncMode() {
    var isInput = (mode === 'input');
    Array.prototype.forEach.call(document.querySelectorAll('.mode'), function (b) {
      var on = b.dataset.mode === mode;
      b.classList.toggle('active', on);
      if (b.setAttribute) b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var tabs = document.getElementById('tabs');
    if (tabs && tabs.style) tabs.style.display = isInput ? 'none' : '';

    var inputPanel = document.getElementById('panel-input');
    if (inputPanel) inputPanel.classList.toggle('hidden', !isInput);
    ['setup', 'staff', 'request', 'shift', 'summary'].forEach(function (n) {
      var pn = document.getElementById('panel-' + n);
      if (pn) pn.classList.toggle('hidden', isInput || n !== currentTab);
    });
  }

  function switchTab(name) {
    currentTab = name;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      if (t.setAttribute) t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (pn) {
      pn.classList.toggle('hidden', pn.id !== 'panel-' + name);
    });
    render();
  }

  function render() {
    var snap = snapshotUI();
    D = Store.get();
    syncMode();
    if (mode === 'input') { renderInputPage(); restoreUI(snap); return; }

    if (currentTab === 'setup') renderSetup();
    if (currentTab === 'staff') renderStaff();
    if (currentTab === 'request') renderRequest();
    if (currentTab === 'shift') renderShift();
    if (currentTab === 'summary') renderSummary();

    restoreUI(snap);

    if (scrollTo) {
      var target = document.getElementById(scrollTo);
      scrollTo = '';
      if (target && target.scrollIntoView) {
        try { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        catch (e) { target.scrollIntoView(); }
      }
    }
  }

  /** 押された場所から上へたどって、目印のついた要素を探す（枠内の余白を押しても落ちないように） */
  function hitTarget(node, key, stop) {
    var t = node, n = 0;
    while (t && t !== stop && n++ < 20) {
      if (t.dataset && t.dataset[key]) return t.dataset[key];
      t = t.parentNode;
    }
    return '';
  }

  var modesEl = document.getElementById('modes');
  if (modesEl) modesEl.addEventListener('click', function (e) {
    var m = hitTarget(e.target, 'mode', modesEl.parentNode);
    if (m) setMode(m);
  });

  var tabsEl = document.getElementById('tabs');
  tabsEl.addEventListener('click', function (e) {
    var t = hitTarget(e.target, 'tab', tabsEl.parentNode);
    if (t) switchTab(t);
  });
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') { trapTab(e); return; }
    if (e.key !== 'Escape') return;
    var m = document.getElementById('modal');
    if (m && m.classList && !m.classList.contains('hidden')) closeModal();
  });
  var menuBtn = document.getElementById('btnMenu');
  if (menuBtn) menuBtn.addEventListener('click', openMenu);
  document.getElementById('fileImport').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { Store.importJson(r.result); D = Store.get(); render(); toast('読み込みました'); }
      catch (err) { alert('読み込めませんでした：' + err.message); }
    };
    r.readAsText(f);
    e.target.value = '';
  });
  document.getElementById('fileRequests').addEventListener('change', function (e) {
    importRequestFiles(e.target.files);
    e.target.value = '';
  });

  render();
})();
