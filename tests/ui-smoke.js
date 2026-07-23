/* tests/ui-smoke.js — 画面が実際に描画できるかの動作確認
   最小限の擬似DOMを用意して ui.js を読み込み、全タブの描画と主要操作を実行する。
   実行: node tests/ui-smoke.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ---------- 最小限の擬似DOM ---------- */
function makeNode(tag) {
  return {
    tagName: (tag || '').toUpperCase(), children: [], attrs: {}, style: {}, dataset: {},
    _text: '', _html: '', _listeners: {}, className: '', value: '', checked: false, disabled: false,
    title: '', selected: false, files: [],
    set textContent(v) { this._text = String(v); }, get textContent() { return this._text; },
    set innerHTML(v) { this._html = String(v); this.children = []; }, get innerHTML() { return this._html; },
    appendChild(c) {
      if (c === null || c === undefined) throw new Error('appendChild(null) : ' + this.tagName);
      this.children.push(c); return c;
    },
    setAttribute(k, v) { this.attrs[k] = v; if (k.indexOf('data-') === 0) this.dataset[k.slice(5)] = v; },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(k, fn) { (this._listeners[k] = this._listeners[k] || []).push(fn); },
    removeEventListener() { },
    classList: {
      _o: null,
      add() { }, remove() { }, toggle() { },
      contains(c) { return false; }
    },
    click() { (this._listeners.click || []).forEach(f => f({ target: this })); },
    fire(ev, arg) { (this._listeners[ev] || []).forEach(f => f(arg || { target: this })); },
    /** 子孫を平坦化して集める */
    all() {
      let out = [];
      this.children.forEach(c => { out.push(c); if (c.all) out = out.concat(c.all()); });
      return out;
    }
  };
}

const byId = {};
['modal', 'modalTitle', 'modalBody', 'modalFoot', 'modalClose', 'toast', 'tabs', 'modes',
  'btnMenu', 'fileImport', 'fileRequests', 'panel-input',
  'panel-setup', 'panel-staff', 'panel-request', 'panel-shift', 'panel-summary']
  .forEach(id => { byId[id] = makeNode('div'); byId[id].id = id; });

const tabButtons = ['setup', 'staff', 'request', 'shift', 'summary'].map(name => {
  const b = makeNode('button'); b.className = 'tab'; b.dataset.tab = name; return b;
});
const allPanels = ['input', 'setup', 'staff', 'request', 'shift', 'summary'].map(n => byId['panel-' + n]);

const modeButtons = ['input', 'manage'].map(m => {
  const b = makeNode('button'); b.className = 'mode'; b.dataset.mode = m; return b;
});
const document = {
  createElement: makeNode,
  createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
  getElementById: id => byId[id] || makeNode('div'),
  querySelector: () => makeNode('div'),
  querySelectorAll: sel => sel === '.tab' ? tabButtons : sel === '.mode' ? modeButtons
    : sel === '.panel' ? allPanels : [],
  addEventListener() { }
};

const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
function makeSession() {
  const m = {};
  return {
    getItem: k => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: k => { delete m[k]; }
  };
}
const sessionStorage = makeSession();

let alerted = [];
const sandbox = {
  console, JSON, Math, Date, Object, Array, String, Number, Boolean, parseInt, parseFloat, isNaN,
  setTimeout: (fn) => 0, clearTimeout: () => { }, performance: { now: () => 0 },
  document, localStorage, sessionStorage, window: {},
  alert: m => alerted.push(String(m)),
  confirm: () => true,
  Blob: function () { }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
  FileReader: function () { this.readAsText = () => { }; },
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  escape: global.escape, unescape: global.unescape,
  encodeURIComponent, decodeURIComponent,
  navigator: { clipboard: { writeText: () => { } } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '\n       → ' + detail : '')); }
}
function tryRun(label, fn) {
  try { fn(); ok(true, label); }
  catch (e) { ok(false, label, e.message + '\n' + String(e.stack).split('\n').slice(1, 4).join('\n')); }
}

/* ---------- 読み込み ---------- */
['util', 'store', 'rules', 'solver'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' }));

// 初期状態は「空」なので、画面テストはサンプル店を入れてから行う
sandbox.Store.loadDemo();

console.log('=== 画面の描画テスト ===');
tryRun('ui.js の読み込みと初期描画', () => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8'), sandbox, { filename: 'ui.js' });
});

/* ---------- 各タブ ---------- */
const tabsEl = byId['tabs'];
function openTab(name) {
  const btn = tabButtons.find(b => b.dataset.tab === name);
  btn.classList.contains = c => c === 'tab';
  (tabsEl._listeners.click || []).forEach(f => f({ target: btn }));
}
['setup', 'staff', 'request', 'shift', 'summary'].forEach(name => {
  tryRun('タブ「' + name + '」を開く', () => openTab(name));
  const panel = byId['panel-' + name];
  ok(panel.children.length > 0, '  → ' + name + ' に中身が描画される');
});

/* ---------- 主要な操作 ---------- */
console.log('\n=== 主要な操作 ===');
function findButton(panel, text) {
  return panel.all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf(text) >= 0);
}

tryRun('［シフトを自動作成］を押す', () => {
  openTab('shift');
  const b = findButton(byId['panel-shift'], 'シフトを自動作成');
  if (!b) throw new Error('作成ボタンが見つからない');
  b.click();
});
const saved = JSON.parse(store['shift-maker-v1'] || '{}');
ok(saved.assignments && Object.keys(saved.assignments).length > 0, '  → 生成結果が保存される');
ok(saved.lastResult && Array.isArray(saved.lastResult.violations), '  → 検証結果が保存される');

tryRun('シフト表のセルをクリック（勤務変更ダイアログ）', () => {
  openTab('shift');
  const cell = byId['panel-shift'].all().find(n => n.tagName === 'TD' && (n.className || '').indexOf('cell-shift') >= 0);
  if (!cell) throw new Error('セルが見つからない');
  cell.click();
});
ok(byId['modalBody'].children.length > 0, '  → ダイアログの中身が描画される');

tryRun('欠員対応ダイアログが開く', () => {
  openTab('shift');
  const cell = byId['panel-shift'].all().find(n =>
    n.tagName === 'TD' && (n.className || '').indexOf('cell-shift') >= 0 && (n.className || '').indexOf('empty') < 0);
  if (!cell) throw new Error('勤務の入ったセルが見つからない');
  cell.click();
  const b = byId['modalBody'].all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('代わりを探す') >= 0);
  if (!b) throw new Error('「代わりを探す」ボタンがない');
  b.click();
  const txt = byId['modalBody'].all().map(n => n._text || '').join(' ');
  if (txt.indexOf('そのまま入れる人') < 0) throw new Error('候補一覧が出ない');
  const foot = byId['modalFoot'].children.map(n => n._text || '').join(' ');
  if (foot.indexOf('人数不足のまま') < 0) throw new Error('「代わりを立てない」選択肢がない');
});

tryRun('従業員の編集ダイアログを開く', () => {
  openTab('staff');
  const b = findButton(byId['panel-staff'], '編集');
  if (!b) throw new Error('編集ボタンが見つからない');
  b.click();
});

tryRun('従業員を追加する', () => {
  openTab('staff');
  const b = findButton(byId['panel-staff'], '従業員を追加');
  b.click();
});

tryRun('希望休セルをクリックして切り替える', () => {
  openTab('request');
  const cell = byId['panel-request'].all().find(n => (n.className || '').indexOf('req-cell') >= 0);
  if (!cell) throw new Error('希望休セルが見つからない');
  cell.click(); cell.click();
});

tryRun('スタッフの希望入力画面を開いて保存する', () => {
  openTab('request');
  const open = findButton(byId['panel-request'], '入力する');
  if (!open) throw new Error('入力ボタンが見つからない');
  open.click();
  const submit = findButton(byId['panel-request'], 'この内容で提出する');
  if (!submit) throw new Error('提出ボタンが見つからない');
  submit.click();
});
{
  const d = JSON.parse(store['shift-maker-v1']);
  const n = Object.keys(d.submissions || {}).filter(k => d.submissions[k].status === 'submitted').length;
  ok(n >= 1, '  → 提出状態が保存される（' + n + '人）');
}

tryRun('［シフトを作成する］を押す', () => {
  openTab('request');
  const b = findButton(byId['panel-request'], 'シフトを作成する');
  if (!b) throw new Error('作成ボタンが見つからない');
  b.click();
});

tryRun('ルール設定は「準備」タブの中にある', () => {
  openTab('setup');
  const txt = byId['panel-setup'].all().map(n => n._text || '').join(' ');
  if (txt.indexOf('詳しいルール設定') < 0) throw new Error('ルール設定が準備タブにない');
  const inp = byId['panel-setup'].all().find(n => n.tagName === 'INPUT' && n.attrs.type === 'number' && String(n.attrs.step) === '100');
  if (!inp) throw new Error('重みの入力欄が見つからない');
  inp.value = '999';
  inp.fire('input', { target: inp });
});

tryRun('集計タブが再計算される', () => openTab('summary'));

tryRun('CSV出力', () => {
  openTab('shift');
  findButton(byId['panel-shift'], 'CSV出力').click();
});

tryRun('メニューが開く', () => {
  byId['btnMenu'].click();
  const txt = byId['modalBody'].all().map(n => n._text || '').join(' ');
  ['はじめての方へ', 'スタッフへの渡し方', 'このアプリの決まり', '書き出し', '読み込み', 'サンプルの店を読み込む', '全部消して最初から']
    .forEach(t => { if (txt.indexOf(t) < 0) throw new Error('メニューに「' + t + '」がない'); });
});

tryRun('メニューから使い方が開ける', () => {
  byId['btnMenu'].click();
  const b = byId['modalBody'].all().find(n => n.tagName === 'BUTTON' && (n._text || '') === 'はじめての方へ');
  b.click();
  const txt = byId['modalBody'].all().map(n => n._text || '').join(' ');
  if (txt.indexOf('責任者がやること') < 0) throw new Error('使い方が出ない');
  if (txt.indexOf('スタッフがやること') < 0) throw new Error('スタッフ向けの説明がない');
});

tryRun('メニューから決まりが読める', () => {
  byId['btnMenu'].click();
  const b = byId['modalBody'].all().find(n => n.tagName === 'BUTTON' && (n._text || '') === 'このアプリの決まり');
  b.click();
  const txt = byId['modalBody'].all().map(n => n._text || '').join(' ');
  if (txt.indexOf('未入力の日は出勤させません') < 0) throw new Error('固定ルールの説明がない');
  if (txt.indexOf('法令は必ず守ります') < 0) throw new Error('法令の説明がない');
});

tryRun('メニューから初期化できる', () => {
  byId['btnMenu'].click();
  const b = byId['modalBody'].all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('全部消して最初から') >= 0);
  b.click();
});

/* ---------- 使う人の切り替え（スタッフ / 責任者） ---------- */
console.log('\n=== 使う人の切り替え ===');
function setMode(m) {
  const btn = modeButtons.find(b => b.dataset.mode === m);
  (byId['modes']._listeners.click || []).forEach(f => f({ target: btn }));
}
// 直前の「初期化」テストで空になっているので、サンプルを入れ直す
sandbox.Store.loadDemo();

tryRun('［シフト希望を出す］でスタッフの入力画面になる', () => {
  setMode('input');
  const panel = byId['panel-input'];
  if (!panel.children.length) throw new Error('入力画面が描画されない');
  const txt = panel.all().map(n => n._text || '').join(' ');
  if (txt.indexOf('シフト希望の入力') < 0) throw new Error('入力画面の見出しがない');
  if (txt.indexOf('ファイルに保存') < 0) throw new Error('保存ボタンがない');
});

tryRun('スタッフ画面では責任者用のタブが出ない', () => {
  setMode('input');
  ['panel-setup', 'panel-staff', 'panel-shift', 'panel-summary'].forEach(id => {
    if (!byId[id].classList) return;
  });
  const tabsHidden = byId['tabs'].style.display === 'none';
  if (!tabsHidden) throw new Error('タブが隠れていない');
});

tryRun('［シフトを作る］で責任者の画面に戻る', () => {
  setMode('manage');
  if (byId['tabs'].style.display === 'none') throw new Error('タブが戻らない');
  openTab('shift');
  if (!byId['panel-shift'].children.length) throw new Error('シフト表が描画されない');
});

tryRun('スタッフが入力 → コード化 → 責任者が取り込む', () => {
  // スタッフ側
  setMode('input');
  const panel = byId['panel-input'];
  const nameInput = panel.all().find(n => n.tagName === 'INPUT' && n.attrs.type === 'text');
  if (!nameInput) throw new Error('名前欄がない');
  nameInput.value = '田中 店長';
  nameInput.fire('input', { target: nameInput });
  const allOk = byId['panel-input'].all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('全部「終日OK」') >= 0);
  allOk.click();
  const codeBtn = byId['panel-input'].all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('コードでコピー') >= 0);
  codeBtn.click();
  const ta = byId['modalBody'].all().find(n => n.tagName === 'TEXTAREA');
  if (!ta) throw new Error('コード欄がない。alert=' + JSON.stringify(alerted.slice(-2)));
  if (ta.value.indexOf('SHIFT1:') !== 0) throw new Error('形式が違う: ' + String(ta.value).slice(0, 20));
  const code = ta.value;

  // 責任者側：対象月をスタッフの入力に合わせてから取り込む
  const draft = JSON.parse(store['shift-input-draft'] || '{}');
  sandbox.Store.get().settings.year = draft.year;
  sandbox.Store.get().settings.month = draft.month;
  sandbox.Store.save();
  setMode('manage');
  openTab('request');
  const imp = byId['panel-request'].all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('コードを貼り付けて取り込む') >= 0);
  if (!imp) throw new Error('取り込みボタンがない');
  imp.click();
  const ta2 = byId['modalBody'].all().find(n => n.tagName === 'TEXTAREA');
  ta2.value = code;
  const next = byId['modalFoot'].children.find(n => n.tagName === 'BUTTON' && (n._text || '') === '確認へ進む');
  next.click();

  const sel = byId['modalBody'].all().find(n => n.tagName === 'SELECT');
  if (!sel) throw new Error('担当者のプルダウンが出ない');
  const chosen = sel.children.filter(o => o.selected).map(o => o.attrs.value);
  if (chosen[0] !== 'e1') throw new Error('氏名一致で本人が選ばれない: ' + chosen[0]);
});

tryRun('モードは保存され、開き直しても続く', () => {
  setMode('input');
  if (store['shift-maker-mode'] !== 'input') throw new Error('モードが保存されない');
  setMode('manage');
  if (store['shift-maker-mode'] !== 'manage') throw new Error('モードが保存されない');
});

tryRun('スタッフへの渡し方の案内が出る', () => {
  setMode('manage');
  openTab('request');
  const b = byId['panel-request'].all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('スタッフへの渡し方') >= 0);
  if (!b) throw new Error('案内ボタンがない');
  b.click();
  const txt = byId['modalBody'].all().map(n => n._text || '').join(' ');
  if (txt.indexOf('シフト希望を出す') < 0) throw new Error('手順が出ない');
});

/* ---------- 壊れた保存データからの復帰 ---------- */
console.log('\n=== 異常系 ===');
[['壊れたJSON', '{壊れている'], ['空オブジェクト', '{}'], ['配列', '[]'], ['文字列', '"abc"'], ['null', 'null']].forEach(([label, raw]) => {
  tryRun('localStorage が' + label + 'でも起動できる', () => {
    store['shift-maker-v1'] = raw;
    const sb2 = Object.assign({}, sandbox);
    vm.createContext(sb2);
    ['util', 'store', 'rules', 'solver'].forEach(f =>
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), sb2, { filename: f + '.js' }));
    const d = sb2.Store.load();
    if (!d || !Array.isArray(d.employees) || !d.settings) throw new Error('復帰に失敗');
    sb2.Solver.generate(d);
  });
});

console.log('\n============================');
console.log(`  成功 ${pass} / 失敗 ${fail}`);
console.log('============================');
if (alerted.length) console.log('alert:', alerted);
process.exit(fail ? 1 : 0);
