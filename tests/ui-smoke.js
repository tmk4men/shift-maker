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
['modal', 'modalTitle', 'modalBody', 'modalFoot', 'modalClose', 'toast', 'tabs',
  'btnExport', 'btnImport', 'btnReset', 'fileImport',
  'panel-setup', 'panel-staff', 'panel-request', 'panel-shift', 'panel-summary', 'panel-rules']
  .forEach(id => { byId[id] = makeNode('div'); byId[id].id = id; });

const tabButtons = ['setup', 'staff', 'request', 'shift', 'summary', 'rules'].map(name => {
  const b = makeNode('button'); b.className = 'tab'; b.dataset.tab = name; return b;
});
const allPanels = ['setup', 'staff', 'request', 'shift', 'summary', 'rules'].map(n => byId['panel-' + n]);

const document = {
  createElement: makeNode,
  createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
  getElementById: id => byId[id] || makeNode('div'),
  querySelectorAll: sel => sel === '.tab' ? tabButtons : sel === '.panel' ? allPanels : [],
  addEventListener() { }
};

const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};

let alerted = [];
const sandbox = {
  console, JSON, Math, Date, Object, Array, String, Number, Boolean, parseInt, parseFloat, isNaN,
  setTimeout: (fn) => 0, clearTimeout: () => { }, performance: { now: () => 0 },
  document, localStorage, window: {},
  alert: m => alerted.push(String(m)),
  confirm: () => true,
  Blob: function () { }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
  FileReader: function () { this.readAsText = () => { }; }
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
['setup', 'staff', 'request', 'shift', 'summary', 'rules'].forEach(name => {
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

tryRun('スタッフ提出画面を開いて提出する', () => {
  openTab('request');
  const open = findButton(byId['panel-request'], '提出画面を開く');
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

tryRun('［締め切ってシフトを作成］を押す', () => {
  openTab('request');
  const b = findButton(byId['panel-request'], '締め切って');
  if (!b) throw new Error('締切ボタンが見つからない');
  b.click();
});
ok(JSON.parse(store['shift-maker-v1']).settings.collectOpen === false, '  → 受付が締切状態になる');

tryRun('ルール設定の重みを変更する', () => {
  openTab('rules');
  const inp = byId['panel-rules'].all().find(n => n.tagName === 'INPUT' && n.attrs.type === 'number');
  if (!inp) throw new Error('重みの入力欄が見つからない');
  inp.value = '999';
  inp.fire('input', { target: inp });
});

tryRun('集計タブが再計算される', () => openTab('summary'));

tryRun('CSV出力', () => {
  openTab('shift');
  findButton(byId['panel-shift'], 'CSV出力').click();
});

tryRun('初期化ボタン', () => byId['btnReset'].click());

/* ---------- スタッフ専用モード（?staff=ID） ---------- */
console.log('\n=== スタッフ専用モード ===');
function bootStaffMode(query, prepare) {
  const sb = {
    console, JSON, Math, Date, Object, Array, String, Number, Boolean, parseInt, parseFloat, isNaN,
    setTimeout: () => 0, clearTimeout: () => { }, performance: { now: () => 0 },
    localStorage, alert: m => alerted.push(String(m)), confirm: () => true,
    Blob: function () { }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
    FileReader: function () { this.readAsText = () => { }; },
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    escape: global.escape, unescape: global.unescape,
    encodeURIComponent, decodeURIComponent,
    location: { search: query, origin: 'https://example.com', pathname: '/shift/' },
    navigator: { clipboard: { writeText: () => { } } }
  };
  // このモード用に画面要素を作り直す
  const ids = {};
  Object.keys(byId).forEach(k => { ids[k] = makeNode('div'); ids[k].id = k; });
  const tabs = ['setup', 'staff', 'request', 'shift', 'summary', 'rules'].map(n => {
    const b = makeNode('button'); b.className = 'tab'; b.dataset.tab = n; return b;
  });
  sb.document = {
    createElement: makeNode,
    createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
    getElementById: id => ids[id] || makeNode('div'),
    querySelector: () => makeNode('div'),
    querySelectorAll: sel => sel === '.tab' ? tabs : sel === '.panel' ? ['setup', 'staff', 'request', 'shift', 'summary', 'rules'].map(n => ids['panel-' + n]) : [],
    addEventListener() { }, execCommand() { }
  };
  sb.window = sb;
  vm.createContext(sb);
  ['util', 'store', 'rules', 'solver'].forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), sb, { filename: f + '.js' }));
  if (prepare) prepare(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8'), sb, { filename: 'ui.js' });
  return { sb, ids };
}

let staffBoot;
tryRun('?staff=e1 で提出画面だけが開く', () => {
  staffBoot = bootStaffMode('?staff=e1', sb => { sb.Store.reset(); });
});
if (staffBoot) {
  const req = staffBoot.ids['panel-request'];
  ok(req.children.length > 0, '  → 提出画面が描画される');
  ['panel-setup', 'panel-staff', 'panel-shift', 'panel-summary', 'panel-rules'].forEach(id => {
    ok(staffBoot.ids[id].children.length === 0, '  → ' + id + ' は表示されない');
  });
  const btns = req.all().filter(n => n.tagName === 'BUTTON').map(n => n._text);
  ok(btns.some(t => t.indexOf('提出する') >= 0), '  → 提出ボタンがある');
  ok(!btns.some(t => t.indexOf('シフトを自動作成') >= 0), '  → 管理用ボタンは出ない');
}

tryRun('存在しないスタッフIDでも落ちない', () => {
  const b = bootStaffMode('?staff=zzz', sb => { sb.Store.reset(); });
  if (b.ids['panel-request'].children.length === 0) throw new Error('案内が出ない');
});

tryRun('締切後は入力できない（提出ボタンが消える）', () => {
  const b = bootStaffMode('?staff=e1', sb => {
    sb.Store.reset();
    sb.Store.get().settings.collectOpen = false;
    sb.Store.save();
  });
  const btns = b.ids['panel-request'].all().filter(n => n.tagName === 'BUTTON').map(n => n._text);
  if (btns.some(t => t.indexOf('提出する') >= 0)) throw new Error('締切後なのに提出できてしまう');
  const badges = b.ids['panel-request'].all().filter(n => (n.className || '').indexOf('badge') >= 0).map(n => n._text);
  if (!badges.some(t => t.indexOf('締め切') >= 0)) throw new Error('締切の案内が出ていない');
});

tryRun('提出コードの書き出し→取り込みが往復する', () => {
  const b = bootStaffMode('?staff=e1', sb => { sb.Store.reset(); });
  const S = b.sb.Store, U2 = b.sb.U;
  S.setAvail('e1', S.monthDates()[0], { from: '10:00', to: '15:00' });
  S.get().requests.e1 = { [S.monthDates()[1]]: 'must' };
  const code = S.exportSubmission('e1');
  // 別データに取り込む
  S.reset();
  const emp = S.importSubmission(JSON.parse(JSON.stringify(code)));
  if (emp.id !== 'e1') throw new Error('取込先が違う');
  const av = S.availOf('e1', S.monthDates()[0]);
  if (!av || av.from !== '10:00') throw new Error('勤務可能時間が復元されない');
  if (S.requestOf('e1', S.monthDates()[1]) !== 'must') throw new Error('希望が復元されない');
  if (S.submissionOf('e1').status !== 'submitted') throw new Error('提出状態にならない');
});

tryRun('対象月が違う提出コードは拒否される', () => {
  const b = bootStaffMode('?staff=e1', sb => { sb.Store.reset(); });
  const S = b.sb.Store;
  const code = S.exportSubmission('e1');
  code.ym = '2000-01';
  let threw = false;
  try { S.importSubmission(code); } catch (e) { threw = true; }
  if (!threw) throw new Error('違う月のコードを受け入れてしまう');
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
