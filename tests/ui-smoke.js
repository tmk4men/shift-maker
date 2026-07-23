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

tryRun('スタッフ専用モードで自分のシフトが見られる', () => {
  const b = bootStaffMode('?staff=e1', sb => {
    sb.Store.reset();
    const d = sb.Store.get();
    const r = sb.Solver.generate(d);
    d.assignments = r.assignments; d.lastResult = r;
    sb.Store.save();
  });
  const txt = b.ids['panel-request'].all().map(n => n._text || '').join(' ');
  if (txt.indexOf('自分のシフト') < 0) throw new Error('シフト表示への導線がない');
  if (txt.indexOf('出勤日数') < 0) throw new Error('自分のシフトが表示されていない');
  // 勤務区分名が出ているか
  const names = b.sb.Store.get().shiftTypes.map(s => s.name);
  if (!names.some(n => txt.indexOf(n) >= 0)) throw new Error('勤務内容が出ていない');
});

tryRun('シフト未作成なら希望提出画面から始まる', () => {
  const b = bootStaffMode('?staff=e1', sb => { sb.Store.reset(); });
  const txt = b.ids['panel-request'].all().map(n => n._text || '').join(' ');
  if (txt.indexOf('提出する') < 0) throw new Error('提出画面が出ていない');
});

tryRun('サンプルを消して空から始められる', () => {
  const b = bootStaffMode('', sb => { sb.Store.reset(); });
  const S = b.sb.Store;
  if (!S.isSample()) throw new Error('サンプル判定が効かない');
  S.startFresh();
  const d = S.get();
  if (d.employees.length !== 0) throw new Error('従業員が残っている');
  if (Object.keys(d.assignments).length !== 0) throw new Error('シフトが残っている');
  if (!d.shiftTypes.length) throw new Error('勤務区分の雛形まで消えている');
  if (S.isSample()) throw new Error('まだサンプル扱いのまま');
  b.sb.Solver.generate(d);   // 空でも落ちないこと
});

tryRun('存在しないスタッフIDでも落ちない', () => {
  const b = bootStaffMode('?staff=zzz', sb => { sb.Store.reset(); });
  if (b.ids['panel-request'].children.length === 0) throw new Error('案内が出ない');
});

tryRun('スタッフ入力ページ（?input=1）が単体で開ける', () => {
  const b = bootStaffMode('?input=1', sb => { sb.Store.reset(); });
  const panel = b.ids['panel-request'];
  const txt = panel.all().map(n => n._text || '').join(' ');
  if (panel.children.length === 0) throw new Error('描画されない');
  if (txt.indexOf('シフト希望の入力') < 0) throw new Error('入力画面が出ていない');
  if (txt.indexOf('ファイルに保存') < 0) throw new Error('保存ボタンがない');
  // 管理用の画面が出ていないこと
  ['panel-setup', 'panel-staff', 'panel-shift', 'panel-summary', 'panel-rules'].forEach(id => {
    if (b.ids[id].children.length) throw new Error(id + ' が表示されている');
  });
});

tryRun('入力ページ → ファイル相当のデータ → 店長が取り込む', () => {
  // スタッフ側：名前と希望を入れてコードを作る
  const a = bootStaffMode('?input=1', sb => { sb.Store.reset(); });
  const panel = a.ids['panel-request'];
  const nameInput = panel.all().find(n => n.tagName === 'INPUT' && n.attrs.type === 'text');
  if (!nameInput) throw new Error('名前欄がない');
  nameInput.value = '田中 店長';
  nameInput.fire('input', { target: nameInput });
  const allOk = panel.all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('全部「終日OK」') >= 0);
  allOk.click();
  const codeBtn = a.ids['panel-request'].all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('コードでコピー') >= 0);
  codeBtn.click();
  const ta = a.ids['modalBody'].all().find(n => n.tagName === 'TEXTAREA');
  if (!ta || !ta.value) throw new Error('コードが作られない');

  // 店長側：取り込む
  const b = bootStaffMode('', sb => {
    sb.Store.reset();
    const d = sb.Store.get();
    d.settings.year = a.sb.Store.get().settings.year;
    d.avail = {};                        // いったん空にしてから取り込む
    sb.Store.save();
  });
  const S2 = b.sb.Store;
  // 対象月をコードに合わせる
  const ym = JSON.parse(Buffer.from(ta.value.slice(7), 'base64').toString('binary')).ym;
  S2.get().settings.year = +ym.slice(0, 4);
  S2.get().settings.month = +ym.slice(5, 7);
  const emp = S2.importSubmission(JSON.parse(Buffer.from(ta.value.slice(7), 'base64').toString('utf8')));
  if (emp.name !== '田中 店長') throw new Error('氏名で照合できていない: ' + emp.name);
  const days = S2.monthDates().filter(d => S2.availOf(emp.id, d)).length;
  if (days === 0) throw new Error('希望が取り込まれていない');
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

tryRun('画面操作での提出コード往復（SHIFT1: の encode → decode）', () => {
  // ① スタッフ側：入力して［提出コードをコピー］を押す
  const a = bootStaffMode('?staff=e1', sb => { sb.Store.reset(); });
  const S = a.sb.Store;
  const d0 = S.monthDates()[0], d1 = S.monthDates()[1];
  S.setAvail('e1', d0, { from: '10:00', to: '15:00' });
  S.get().requests.e1 = {}; S.get().requests.e1[d1] = 'must';
  S.save();
  const copyBtn = a.ids['panel-request'].all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('提出コード') >= 0);
  if (!copyBtn) throw new Error('提出コードのボタンがない');
  copyBtn.click();
  const ta = a.ids['modalBody'].all().find(n => n.tagName === 'TEXTAREA');
  if (!ta || !ta.value) throw new Error('コードが生成されない');
  if (ta.value.indexOf('SHIFT1:') !== 0) throw new Error('想定した形式でない: ' + ta.value.slice(0, 20));
  const code = ta.value;

  // ② 責任者側：別セッションで［提出コードを取り込む］に貼り付ける
  const b = bootStaffMode('', sb => { sb.Store.reset(); });
  const req = b.ids['panel-request'];
  // 希望・提出タブを開く
  const tabsEl2 = b.ids['tabs'];
  const btn = makeNode('button'); btn.className = 'tab'; btn.dataset.tab = 'request';
  btn.classList.contains = c => c === 'tab';
  (tabsEl2._listeners.click || []).forEach(f => f({ target: btn }));
  const impBtn = req.all().find(n => n.tagName === 'BUTTON' && (n._text || '').indexOf('コードを貼り付けて取り込む') >= 0);
  if (!impBtn) throw new Error('取り込みボタンがない');
  impBtn.click();
  const ta2 = b.ids['modalBody'].all().find(n => n.tagName === 'TEXTAREA');
  ta2.value = code;
  const nextBtn = b.ids['modalFoot'].children.find(n => n.tagName === 'BUTTON' && (n._text || '') === '確認へ進む');
  if (!nextBtn) throw new Error('確認ボタンがない');
  nextBtn.click();

  // 「誰の希望か」を選ぶ画面が出て、名前一致で本人が選ばれていること
  const sel = b.ids['modalBody'].all().find(n => n.tagName === 'SELECT');
  if (!sel) throw new Error('担当者のプルダウンが出ていない');
  const chosen = sel.children.filter(o => o.selected).map(o => o.attrs.value);
  if (chosen[0] !== 'e1') throw new Error('氏名一致で本人が選ばれていない: ' + chosen[0]);

  const runBtn = b.ids['modalFoot'].children.find(n => n.tagName === 'BUTTON' && (n._text || '') === '取り込む');
  if (!runBtn) throw new Error('実行ボタンがない');
  runBtn.click();

  const S2 = b.sb.Store;
  const av = S2.availOf('e1', S2.monthDates()[0]);
  if (!av || av.from !== '10:00' || av.to !== '15:00') throw new Error('勤務可能時間が復元されない: ' + JSON.stringify(av));
  if (S2.requestOf('e1', S2.monthDates()[1]) !== 'must') throw new Error('希望が復元されない');
  if (S2.submissionOf('e1').status !== 'submitted') throw new Error('提出済みにならない');
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

tryRun('希望が取り込まれていない人が「0日の人」として出る', () => {
  const b = bootStaffMode('', sb => {
    sb.Store.reset();
    const d = sb.Store.get();
    delete d.avail['e6'];              // 1人分の希望を消す（取り込み漏れの再現）
    const r = sb.Solver.generate(d);
    d.assignments = r.assignments; d.lastResult = r;
    sb.Store.save();
  });
  // 集計タブを開く
  const tabs = b.sb.document.querySelectorAll('.tab');
  const t = tabs.find(x => x.dataset.tab === 'summary');
  t.classList.contains = c => c === 'tab';
  (b.ids['tabs']._listeners.click || []).forEach(f => f({ target: t }));
  const txt = b.ids['panel-summary'].all().map(n => n._text || '').join(' ');
  if (txt.indexOf('シフトが0日の人') < 0) throw new Error('0日の人が表示されない');
  if (txt.indexOf('渡辺') < 0) throw new Error('該当者の名前が出ていない');
  if (txt.indexOf('未入力') < 0) throw new Error('理由が出ていない');
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
