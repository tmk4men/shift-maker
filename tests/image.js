/* tests/image.js — シフト表の画像化を検証する
   実際の Canvas は使えないので、呼ばれた描画命令を記録する擬似 context で確認する。
   実行: node tests/image.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const sandbox = {
  console, JSON, Math, Date, Object, Array, String, Number, Boolean, parseInt, parseFloat,
  isNaN, setTimeout, Uint8Array, Blob: function () { }, performance: { now: () => 0 }
};
vm.createContext(sandbox);
['util', 'store', 'rules', 'solver', 'image'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' }));
const { U, Store, Solver, ShiftImage } = sandbox;

let pass = 0, fail = 0;
function ok(c, label, detail) {
  if (c) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '\n       → ' + detail : '')); }
}

/* テキスト描画を記録する擬似 canvas */
function fakeCanvas() {
  const texts = [];
  const ctx = {
    _w: 0, _h: 0, fillStyle: '', strokeStyle: '', font: '', lineWidth: 1,
    textBaseline: '', textAlign: '',
    scale() { }, fillRect() { }, strokeRect() { }, beginPath() { }, closePath() { },
    moveTo() { }, lineTo() { }, arcTo() { }, stroke() { }, fill() { },
    fillText(t, x, y) { texts.push(String(t)); },
    measureText(t) { return { width: String(t).length * 8 }; }
  };
  return {
    width: 0, height: 0,
    getContext() { return ctx; },
    _texts: texts
  };
}

/* ---- サンプルでシフトを作る ---- */
Store.setData(Store.sampleData());
const gen = Solver.generate(Store.get());
Store.get().assignments = gen.assignments;
const data = Store.get();

console.log('=== シフト表の画像化 ===');

const model = ShiftImage.buildModel(data);
ok(model.rows.length === data.employees.length, '全従業員が行になる', model.rows.length + '行');
ok(model.dates.length === U.monthDates(data.settings.year, data.settings.month).length, '日数分の列がある');

// 集計が実データと一致するか（画像に出す数字が正しいこと）
let mismatch = [];
data.employees.forEach((e, i) => {
  let days = 0;
  model.dates.forEach(d => {
    const a = data.assignments[d] || {};
    if (Object.keys(a).some(k => (a[k] || []).indexOf(e.id) >= 0)) days++;
  });
  if (model.rows[i].days !== days) mismatch.push(e.name + ':' + model.rows[i].days + '≠' + days);
});
ok(mismatch.length === 0, '各行の出勤日数が実データと一致', mismatch.join(','));

// タイトルに年月が入る
ok(model.title.indexOf(data.settings.year + '年' + data.settings.month + '月') >= 0, 'タイトルに対象年月が入る', model.title);

// 実際に描いてみて、氏名と数字が描画命令に現れるか
const canvas = fakeCanvas();
ShiftImage.draw(canvas, model, { scale: 2, stamp: '2026/8/1' });
ok(canvas.width > 0 && canvas.height > 0, 'canvasサイズが設定される', canvas.width + 'x' + canvas.height);

const drawn = canvas._texts.join(' ');
ok(data.employees.every(e => drawn.indexOf(e.name.slice(0, 3)) >= 0 || drawn.indexOf(e.name) >= 0),
  '全員の氏名が描画される');
ok(model.shiftTypes.every(st => drawn.indexOf(st.name.slice(0, 1)) >= 0 || drawn.indexOf(st.short) >= 0),
  '勤務区分の記号が描画される');
ok(drawn.indexOf('日 / ') >= 0, '日数・時間の集計が描画される');
ok(drawn.indexOf('KINMATE で作成') >= 0, '作成元の記載がある');

// 空シフト・0人でも落ちない
const empty = Store.emptyData();
empty.settings.year = 2026; empty.settings.month = 8;
let noCrash = true;
try {
  const m2 = ShiftImage.buildModel(empty);
  ShiftImage.draw(fakeCanvas(), m2, {});
} catch (e) { noCrash = false; }
ok(noCrash, '従業員0人でも例外にならない');

// 大人数でも描ける（サイズが人数に比例して増える）
const big = Store.sampleData();
big.settings.year = 2026; big.settings.month = 8;
const emps = [];
for (let i = 1; i <= 30; i++) emps.push(Object.assign({}, big.employees[0], { id: 'b' + i, name: 'スタッフ' + i }));
big.employees = emps;
big.avail = {};
U.monthDates(2026, 8).forEach(d => emps.forEach(e => { big.avail[e.id] = big.avail[e.id] || {}; big.avail[e.id][d] = { allday: true }; }));
Store.setData(big);
const r3 = Solver.generate(Store.get());
Store.get().assignments = r3.assignments;
const c3 = fakeCanvas();
ShiftImage.draw(c3, ShiftImage.buildModel(Store.get()), { scale: 2 });
ok(c3.height > canvas.height, '人数が多いほど画像が縦に伸びる', c3.height + ' > ' + canvas.height);

console.log('\n============================');
console.log(`  成功 ${pass} / 失敗 ${fail}`);
console.log('============================');
process.exit(fail ? 1 : 0);
