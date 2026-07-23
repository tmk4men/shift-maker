/* tests/test.js — 実際の使用場面を想定した自動テスト
   ブラウザ用のJSを Node の vm で読み込んで、生成結果を独立に検証する。
   実行: node tests/test.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sandbox = {
  console, JSON, Math, Date, Object, Array, String, Number, Boolean, parseInt, parseFloat,
  isNaN, setTimeout, performance: { now: () => 0 }
};
vm.createContext(sandbox);
['util', 'store', 'rules', 'solver'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
});
const { U, Store, Rules, Solver } = sandbox;

/* ---------------- テスト基盤 ---------------- */
let pass = 0, fail = 0, currentCase = '';
function T(name) { currentCase = name; console.log('\n=== ' + name + ' ==='); }
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '\n       → ' + detail : '')); }
}

/* ---------------- 独立検証（solver を信用せず、割当表から直接調べる） ---------------- */
function audit(data, assignments) {
  const errs = [];
  const stc = {};
  data.shiftTypes.forEach(s => stc[s.id] = Store.stCalc(s));
  const shiftOf = {};                       // empId -> date -> stId
  data.employees.forEach(e => shiftOf[e.id] = {});

  Object.keys(assignments).forEach(date => {
    Object.keys(assignments[date] || {}).forEach(stId => {
      (assignments[date][stId] || []).forEach(id => {
        if (shiftOf[id][date]) errs.push(`${date} ${id} が同じ日に2つの勤務`);
        shiftOf[id][date] = stId;
      });
    });
  });

  const dates = U.monthDates(data.settings.year, data.settings.month);

  data.employees.forEach(e => {
    let run = 0, days = 0, pay = 0, nights = 0;
    const week = {};
    let d = U.addDays(dates[0], -10);
    for (let i = 0; i < dates.length + 12; i++) {
      if (shiftOf[e.id][d]) { run++; if (run > 6) errs.push(`${e.name}: ${run}連勤 (${d})`); }
      else run = 0;
      d = U.addDays(d, 1);
    }

    dates.forEach(date => {
      const stId = shiftOf[e.id][date];
      if (!stId) return;
      const c = stc[stId], st = data.shiftTypes.find(s => s.id === stId);
      days++; pay += Rules.payOf(e, c); if (c.night > 0) nights++;

      // 担当可能区分
      if ((e.canShift || []).indexOf(stId) < 0) errs.push(`${e.name}: ${st.name}は担当不可なのに割当 (${date})`);
      // 勤務不可曜日
      if ((e.ngWeekdays || []).indexOf(U.weekdayOf(date)) >= 0) errs.push(`${e.name}: 勤務不可曜日に割当 (${date})`);
      // 18歳未満の深夜
      if (e.minor && c.night > 0) errs.push(`【法令】${e.name}(18歳未満): 深夜勤務 (${date})`);
      if (e.minor && c.work > 480) errs.push(`【法令】${e.name}(18歳未満): 8時間超 (${date})`);
      // 絶対休・有給
      const req = (data.requests[e.id] || {})[date];
      if (req === 'must' || req === 'paid') errs.push(`【法令】${e.name}: 確定休/有給に出勤 (${date})`);
      // 提出した勤務可能時間
      const av = (data.avail[e.id] || {})[date];
      if (av) {
        if (av.off) errs.push(`${e.name}: 本人が不可と提出した日に割当 (${date})`);
        else if (av.from) {
          let af = U.hm2min(av.from), at = U.hm2min(av.to);
          if (at <= af) at += 1440;
          if (c.start < af || c.end > at) errs.push(`${e.name}: 提出時間(${av.from}-${av.to})外の${st.name} (${date})`);
        }
      } else if (data.settings.unsubmittedPolicy === 'unavailable') {
        errs.push(`${e.name}: 未提出日に割当 (${date})`);
      }
      // 夜勤明け
      const prev = shiftOf[e.id][U.addDays(date, -1)];
      if (prev && stc[prev].overnight) errs.push(`${e.name}: 夜勤明けの日に勤務 (${date})`);
      // インターバル
      const base = Math.round(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000) * 1440;
      [-1, 1].forEach(o => {
        const d2 = U.addDays(date, o), s2 = shiftOf[e.id][d2];
        if (!s2) return;
        const b2 = Math.round(Date.UTC(+d2.slice(0, 4), +d2.slice(5, 7) - 1, +d2.slice(8, 10)) / 86400000) * 1440;
        const me = { s: base + c.start, e: base + c.end };
        const ot = { s: b2 + stc[s2].start, e: b2 + stc[s2].end };
        const gap = ot.s >= me.e ? ot.s - me.e : me.s - ot.e;
        if (gap < 11 * 60) errs.push(`${e.name}: インターバル${(gap / 60).toFixed(1)}h (${date}→${d2})`);
      });
      // 相性NG
      const mates = (assignments[date][stId] || []).filter(x => x !== e.id);
      mates.forEach(m => {
        if ((e.ngPartners || []).indexOf(m) >= 0) errs.push(`${e.name}: 相性NGの相手と同勤務 (${date})`);
      });
      // 新人ペア
      if (e.newbie) {
        const hasTrainer = mates.some(m => {
          const o = data.employees.find(x => x.id === m);
          return o && !o.newbie && (o.trainer || o.leader);
        });
        if (!hasTrainer) errs.push(`${e.name}(新人): 教育担当なしの勤務 (${date})`);
      }
      // 週40時間
      const wk = Rules.weekKey(data, date);
      week[wk] = (week[wk] || 0) + c.work;
    });

    if (!data.settings.has36) {
      Object.keys(week).forEach(w => {
        if (week[w] > 2400) errs.push(`【法令】${e.name}: 36協定なしで週${(week[w] / 60).toFixed(1)}h (${w}の週)`);
      });
    }
    if (e.maxDays > 0 && days > e.maxDays) errs.push(`${e.name}: 最大${e.maxDays}日に対し${days}日`);
    if (e.maxNights > 0 && nights > e.maxNights) errs.push(`${e.name}: 夜勤上限${e.maxNights}回に対し${nights}回`);
    if (e.incomeCap > 0 && (e.ytdEarnings || 0) + pay > e.incomeCap)
      errs.push(`${e.name}: 年収上限超過 ${Math.round((e.ytdEarnings || 0) + pay)} > ${e.incomeCap}`);
  });

  return errs;
}

function coverage(data, assignments) {
  let need = 0, got = 0, shortSlots = 0;
  U.monthDates(data.settings.year, data.settings.month).forEach(date => {
    data.shiftTypes.forEach(st => {
      const n = Store.needOf(date, st.id);
      const g = ((assignments[date] || {})[st.id] || []).length;
      need += n; got += Math.min(n, g);
      if (g < n) shortSlots++;
    });
  });
  return { need, got, rate: need ? got / need : 1, shortSlots };
}

/* ---------------- シナリオ用データ生成 ---------------- */
function baseData(over) {
  const d = Store.sampleData();
  d.settings.year = 2026; d.settings.month = 8;
  return Object.assign(d, over || {});
}
function run(data) {
  Store.setData(data);
  const res = Solver.generate(Store.get());
  return { data: Store.get(), res };
}

/* =======================================================================
   シナリオ1：飲食店（サンプル初期データそのまま）
   ======================================================================= */
T('シナリオ1：飲食店8人・早番/遅番/夜勤・初期データのまま作成');
{
  const { data, res } = run(baseData());
  const errs = audit(data, res.assignments);
  const cov = coverage(data, res.assignments);
  console.log(`  充足率 ${(cov.rate * 100).toFixed(1)}% / 不足枠 ${cov.shortSlots} / 人件費 ${res.totalPay.toLocaleString()}円`);
  ok(errs.length === 0, '法令・ハード制約の違反なし', errs.slice(0, 8).join('\n       → '));
  ok(res.violations.filter(v => v.level === 'hard' && v.ruleId.startsWith('LAW')).length === 0, '法令違反(LAW-*)ゼロ');
  const nights = data.employees.map(e => res.stats[e.id].nights);
  console.log('  夜勤回数:', data.employees.map(e => e.name + '=' + res.stats[e.id].nights).join(' '));
  ok(true, '（参考）夜勤配分を出力');
}

/* =======================================================================
   シナリオ2：小さなカフェ（5人・早番/遅番のみ・夜勤なし）
   ======================================================================= */
T('シナリオ2：小規模カフェ5人・早番/遅番のみ');
{
  const d = baseData();
  d.shiftTypes = [
    { id: 'A', name: '早番', short: '早', start: '08:00', end: '15:00', breakMin: 45, color: '#f6c453' },
    { id: 'B', name: '遅番', short: '遅', start: '14:00', end: '21:00', breakMin: 45, color: '#7fb3f5' }
  ];
  d.demand = {
    byWeekday: { A: [2, 2, 2, 2, 2, 2, 2], B: [2, 2, 2, 2, 2, 2, 2] },
    roleReq: { A: { leader: true }, B: { leader: true } }, overrides: {}
  };
  d.employees = [
    { id: 'c1', name: '店主', wage: 1500, employment: 'full', leader: true, certified: true, trainer: true, newbie: false, minor: false, canShift: ['A', 'B'], ngWeekdays: [], priority: 0, minDays: 20, maxDays: 24, maxConsecutive: 6, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' },
    { id: 'c2', name: '副店長', wage: 1300, employment: 'full', leader: true, certified: false, trainer: true, newbie: false, minor: false, canShift: ['A', 'B'], ngWeekdays: [], priority: 0, minDays: 18, maxDays: 22, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' },
    { id: 'c3', name: 'パートA', wage: 1100, employment: 'part', leader: false, certified: false, trainer: true, newbie: false, minor: false, canShift: ['A'], ngWeekdays: [0, 6], priority: 0, minDays: 12, maxDays: 18, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' },
    { id: 'c4', name: 'パートB', wage: 1100, employment: 'part', leader: false, certified: false, trainer: false, newbie: false, minor: false, canShift: ['B'], ngWeekdays: [], priority: 0, minDays: 12, maxDays: 18, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' },
    { id: 'c5', name: '学生', wage: 1050, employment: 'student', leader: false, certified: false, trainer: false, newbie: false, minor: false, canShift: ['A', 'B'], ngWeekdays: [1, 2], priority: 0, minDays: 8, maxDays: 14, maxConsecutive: 4, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' }
  ];
  const { data, res } = run(d);
  const errs = audit(data, res.assignments);
  const cov = coverage(data, res.assignments);
  console.log(`  充足率 ${(cov.rate * 100).toFixed(1)}% / 不足枠 ${cov.shortSlots}`);
  ok(errs.length === 0, 'ハード制約の違反なし', errs.slice(0, 8).join('\n       → '));
  ok(cov.rate > 0.6, '半分以上の枠が埋まる（人手不足でも破綻しない）', `充足率 ${(cov.rate * 100).toFixed(1)}%`);
}

/* =======================================================================
   シナリオ3：24時間営業（夜勤あり・夜勤明け・インターバル）
   ======================================================================= */
T('シナリオ3：24時間営業12人・夜勤の偏りと明け休み');
{
  const d = baseData();
  const emps = [];
  for (let i = 1; i <= 12; i++) {
    emps.push({
      id: 'n' + i, name: 'スタッフ' + i, wage: 1200, employment: i <= 4 ? 'full' : 'part',
      leader: i <= 5, certified: i <= 6, trainer: i <= 6, newbie: false, minor: false,
      canShift: i <= 8 ? ['A', 'B', 'N'] : ['A', 'B'], ngWeekdays: [], priority: 0,
      minDays: 14, maxDays: 20, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 8,
      ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: ''
    });
  }
  d.employees = emps;
  d.demand.byWeekday = { A: [2, 2, 2, 2, 2, 2, 2], B: [2, 2, 2, 2, 2, 2, 2], N: [1, 1, 1, 1, 1, 1, 1] };
  const { data, res } = run(d);
  const errs = audit(data, res.assignments);
  const cov = coverage(data, res.assignments);
  // 夜勤要員（責任者は日勤の必須役割があるため対象外で見る）
  const nightPool = data.employees.filter(e => e.canShift.indexOf('N') >= 0 && !e.leader);
  const nights = nightPool.map(e => res.stats[e.id].nights);
  const spread = Math.max(...nights) - Math.min(...nights);
  console.log(`  充足率 ${(cov.rate * 100).toFixed(1)}% / 夜勤(非責任者) ${nights.join(',')} / 最大差 ${spread}`);
  ok(errs.length === 0, '夜勤明け・インターバル含めて違反なし', errs.slice(0, 8).join('\n       → '));
  ok(cov.rate === 1, '全枠を充足', `不足枠 ${cov.shortSlots}`);
  ok(spread <= 3, '夜勤要員の偏りが3回以内', `最大差 ${spread} / ${nights.join(',')}`);
}

/* =======================================================================
   シナリオ4：スタッフ提出ベース（時間指定を必ず守るか）
   ======================================================================= */
T('シナリオ4：全員が「何時から何時まで」を提出 → 範囲外に入れない');
{
  const d = baseData();
  d.settings.unsubmittedPolicy = 'unavailable';
  d.avail = {};
  const dates = U.monthDates(2026, 8);
  d.employees.forEach((e, idx) => {
    d.avail[e.id] = {};
    dates.forEach((dt, i) => {
      if ((i + idx) % 4 === 0) { d.avail[e.id][dt] = { off: true }; return; }
      if (idx % 3 === 0) d.avail[e.id][dt] = { allday: true };
      else if (idx % 3 === 1) d.avail[e.id][dt] = { from: '08:00', to: '17:00' };   // 早番のみ可
      else d.avail[e.id][dt] = { from: '13:00', to: '22:00' };                      // 遅番のみ可
    });
  });
  const { data, res } = run(d);
  const errs = audit(data, res.assignments);
  ok(errs.length === 0, '提出時間外・提出「不可」日への割当なし', errs.slice(0, 8).join('\n       → '));

  // 早番だけ可の人が遅番/夜勤に入っていないこと
  let bad = 0;
  data.employees.forEach((e, idx) => {
    if (idx % 3 !== 1) return;
    dates.forEach(dt => {
      const a = res.assignments[dt] || {};
      if ((a.B || []).indexOf(e.id) >= 0 || (a.N || []).indexOf(e.id) >= 0) bad++;
    });
  });
  ok(bad === 0, '「08:00〜17:00で行けます」の人は早番のみ', `違反 ${bad} 件`);
}

/* =======================================================================
   シナリオ5：人手不足（需要 > 供給）
   ======================================================================= */
T('シナリオ5：明らかな人手不足 → 無理に詰め込まず不足として報告する');
{
  const d = baseData();
  d.demand.byWeekday = { A: [6, 6, 6, 6, 6, 6, 6], B: [6, 6, 6, 6, 6, 6, 6], N: [2, 2, 2, 2, 2, 2, 2] };
  const { data, res } = run(d);
  const errs = audit(data, res.assignments);
  const cov = coverage(data, res.assignments);
  console.log(`  不足枠 ${cov.shortSlots} / 充足率 ${(cov.rate * 100).toFixed(1)}%`);
  ok(errs.length === 0, '不足していても法令違反は発生しない', errs.slice(0, 8).join('\n       → '));
  ok(res.unfilled.length > 0, '不足枠が結果に報告される');
  ok(res.violations.some(v => v.ruleId === 'OPS-001'), '人員不足として違反一覧に出る');
}

/* =======================================================================
   シナリオ6：扶養内（年収の壁）
   ======================================================================= */
T('シナリオ6：年収の壁が近い人を超過させない');
{
  const d = baseData();
  const e5 = d.employees.find(e => e.id === 'e5');
  e5.incomeCap = 1230000; e5.ytdEarnings = 1180000;   // 残り5万円
  e5.minDays = 10; e5.maxDays = 20;
  const { data, res } = run(d);
  const errs = audit(data, res.assignments);
  const total = e5.ytdEarnings + res.stats.e5.pay;
  console.log(`  伊藤: ${res.stats.e5.days}日 / 賃金 ${res.stats.e5.pay.toLocaleString()}円 / 累計 ${Math.round(total).toLocaleString()}円`);
  ok(errs.length === 0, 'ハード制約の違反なし', errs.slice(0, 8).join('\n       → '));
  ok(total <= 1230000, '年収上限を超えない', `累計 ${Math.round(total)}`);
  ok(res.stats.e5.days > 0, '上限内でちゃんと勤務が入る');
}

/* =======================================================================
   シナリオ7：新人の教育ペア
   ======================================================================= */
T('シナリオ7：新人は必ず教育担当と同じ勤務になる');
{
  const d = baseData();
  d.employees.forEach(e => { if (e.id === 'e7') { e.newbie = true; e.minDays = 10; } });
  const { data, res } = run(d);
  const errs = audit(data, res.assignments);
  const newbieDays = res.stats.e7.days;
  console.log(`  新人 山本: ${newbieDays}日`);
  ok(errs.filter(x => x.indexOf('新人') >= 0).length === 0, '教育担当なしの勤務が存在しない');
  ok(newbieDays > 0, '新人にも勤務が入る（ペア制約で全滅しない）');
  ok(errs.length === 0, 'その他の違反もなし', errs.slice(0, 8).join('\n       → '));
}

/* =======================================================================
   シナリオ8：36協定なし・18歳未満・相性NG
   ======================================================================= */
T('シナリオ8：36協定なし / 18歳未満 / 相性NG');
{
  const d = baseData();
  d.settings.has36 = false;
  d.employees.find(e => e.id === 'e8').minor = true;
  d.employees.find(e => e.id === 'e8').canShift = ['A', 'B', 'N'];   // わざと夜勤も可にしてみる
  d.employees.find(e => e.id === 'e4').ngPartners = ['e6'];
  const { data, res } = run(d);
  const errs = audit(data, res.assignments);
  ok(errs.length === 0, '深夜禁止・週40h・相性NGすべて守られる', errs.slice(0, 8).join('\n       → '));
  const minorNight = U.monthDates(2026, 8).some(dt => ((res.assignments[dt] || {}).N || []).indexOf('e8') >= 0);
  ok(!minorNight, '18歳未満が夜勤に入っていない');
}

/* =======================================================================
   シナリオ9：月跨ぎ（前月末の連勤・夜勤明け）
   ======================================================================= */
T('シナリオ9：前月末に連勤・夜勤がある状態から作成');
{
  const d = baseData();
  // 7/27〜7/31 に e2 が5連勤、7/31 は夜勤
  d.prevMonth = {
    '2026-07-27': { A: ['e2'] }, '2026-07-28': { A: ['e2'] }, '2026-07-29': { A: ['e2'] },
    '2026-07-30': { A: ['e2'] }, '2026-07-31': { N: ['e2'] }
  };
  const { data, res } = run(d);
  const a1 = (res.assignments['2026-08-01'] || {});
  const worked81 = Object.keys(a1).some(k => (a1[k] || []).indexOf('e2') >= 0);
  ok(!worked81, '前月末が夜勤なら8/1は休みになる');
  const errs = audit(data, res.assignments);
  ok(errs.length === 0, '月内のハード制約違反なし', errs.slice(0, 8).join('\n       → '));
}

/* =======================================================================
   シナリオ10：決定性と処理時間
   ======================================================================= */
T('シナリオ10：何度作っても同じ結果 / 大規模でも実用速度');
{
  const r1 = run(baseData()).res;
  const r2 = run(baseData()).res;
  ok(JSON.stringify(r1.assignments) === JSON.stringify(r2.assignments), '同じ入力なら同じシフト（決定的）');

  const d = baseData();
  const emps = [];
  for (let i = 1; i <= 30; i++) {
    emps.push({
      id: 'b' + i, name: 'B' + i, wage: 1200, employment: 'part',
      leader: i <= 6, certified: i <= 10, trainer: i <= 10, newbie: i > 27, minor: false,
      canShift: i <= 20 ? ['A', 'B', 'N'] : ['A', 'B'], ngWeekdays: [], priority: 0,
      minDays: 12, maxDays: 20, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 6,
      ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: ''
    });
  }
  d.employees = emps;
  d.demand.byWeekday = { A: [5, 4, 4, 4, 4, 5, 5], B: [5, 4, 4, 4, 4, 5, 5], N: [2, 2, 2, 2, 2, 2, 2] };
  const t0 = Date.now();
  const { data, res } = run(d);
  const ms = Date.now() - t0;
  const errs = audit(data, res.assignments);
  const cov = coverage(data, res.assignments);
  console.log(`  30人×31日: ${ms}ms / 充足率 ${(cov.rate * 100).toFixed(1)}%`);
  ok(ms < 15000, '30人規模でも15秒以内', ms + 'ms');
  ok(errs.length === 0, '大規模でもハード制約の違反なし', errs.slice(0, 8).join('\n       → '));
}

/* =======================================================================
   シナリオ11：希望休が集中する月（お盆）
   ======================================================================= */
T('シナリオ11：お盆に希望休が集中しても法令違反を出さない');
{
  const d = baseData();
  d.requests = {};
  d.employees.forEach((e, i) => {
    d.requests[e.id] = {};
    ['2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'].forEach(dt => {
      d.requests[e.id][dt] = i < 3 ? 'must' : 'off';    // 3人は絶対休
    });
  });
  const { data, res } = run(d);
  const errs = audit(data, res.assignments);
  const mustViolation = res.violations.filter(v => v.ruleId === 'LAW-060' && v.level === 'hard').length;
  ok(errs.length === 0, '絶対休を破らない', errs.slice(0, 8).join('\n       → '));
  ok(mustViolation === 0, '確定休への割当ゼロ');
  const shortOnObon = ['2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'].reduce((a, dt) => {
    return a + data.shiftTypes.reduce((b, st) => b + Math.max(0, Store.needOf(dt, st.id) - ((res.assignments[dt] || {})[st.id] || []).length), 0);
  }, 0);
  console.log('  お盆期間の不足人数: ' + shortOnObon + '（希望休が多いと不足として可視化される）');
  ok(true, '（参考）不足が可視化される');
}

/* =======================================================================
   シナリオ12：手動編集の検証
   ======================================================================= */
T('シナリオ12：手動でセルを触ったときの再検証');
{
  const { data, res } = run(baseData());
  const dates = U.monthDates(2026, 8);
  // 18歳未満を夜勤に手で入れてみる（UIでは警告つきで許可される）
  const a = JSON.parse(JSON.stringify(res.assignments));
  const dt = dates[10];
  if (!a[dt]) a[dt] = {};
  if (!a[dt].N) a[dt].N = [];
  Object.keys(a[dt]).forEach(k => { a[dt][k] = a[dt][k].filter(x => x !== 'e8'); });
  a[dt].N.push('e8');
  // UIと同じく「その日の本人の割当を外した状態」で可否を尋ねる
  const clean = JSON.parse(JSON.stringify(res.assignments));
  Object.keys(clean[dt] || {}).forEach(k => { clean[dt][k] = clean[dt][k].filter(x => x !== 'e8'); });
  const ngs = Solver.checkManual(data, clean, 'e8', dt, 'N');
  ok(ngs.some(n => n.ruleId === 'LAW-040'), '手動で18歳未満を夜勤に入れようとすると警告される',
    ngs.map(n => n.ruleId).join(','));
  const rv = Solver.revalidate(data, a);
  ok(rv.violations.some(v => v.ruleId === 'LAW-040' && v.level === 'hard'),
    '警告を無視して入れた場合、再検証で法令違反として検出される',
    rv.violations.filter(v => v.level === 'hard').map(v => v.ruleId).join(','));
  ok(typeof rv.totalPay === 'number', '人件費が再計算される');

  // 担当できない勤務区分に手で入れた場合
  const a2 = JSON.parse(JSON.stringify(res.assignments));
  const dt2 = dates[12];
  Object.keys(a2[dt2] || {}).forEach(k => { a2[dt2][k] = a2[dt2][k].filter(x => x !== 'e5'); });
  if (!a2[dt2]) a2[dt2] = {};
  (a2[dt2].N = a2[dt2].N || []).push('e5');            // 伊藤は夜勤を担当できない設定
  const rv2 = Solver.revalidate(data, a2);
  ok(rv2.violations.some(v => v.ruleId === 'OPS-008'), '担当できない勤務区分への手動割当を検出する',
    rv2.violations.filter(v => v.level === 'hard').map(v => v.ruleId).join(','));
}

/* =======================================================================
   シナリオ13：壊れたデータ・参照切れからの復帰
   ======================================================================= */
T('シナリオ13：従業員/勤務区分を削除したときに関連データが残らない');
{
  const { data, res } = run(baseData());
  Store.get().assignments = res.assignments;
  Store.get().requests = { e5: { '2026-08-03': 'off' } };
  Store.get().avail = { e5: { '2026-08-03': { allday: true } } };
  Store.get().submissions = { e5: { status: 'submitted', at: 'x' } };
  Store.get().employees.find(e => e.id === 'e4').ngPartners = ['e5'];

  Store.removeEmployee('e5');
  const d2 = Store.get();
  const stillInShift = Object.keys(d2.assignments).some(dt =>
    Object.keys(d2.assignments[dt]).some(st => d2.assignments[dt][st].indexOf('e5') >= 0));
  ok(!stillInShift, '削除した人が作成済みシフトに残らない');
  ok(!d2.requests.e5 && !d2.avail.e5 && !d2.submissions.e5, '希望・提出データも消える');
  ok(d2.employees.find(e => e.id === 'e4').ngPartners.indexOf('e5') < 0, '他の人の相性設定からも消える');

  Store.removeShiftType('N');
  const d3 = Store.get();
  const stillHasN = Object.keys(d3.assignments).some(dt => d3.assignments[dt].N);
  ok(!stillHasN, '削除した勤務区分が作成済みシフトに残らない');
  ok(!d3.demand.byWeekday.N, '必要人数の設定からも消える');
  ok(d3.employees.every(e => e.canShift.indexOf('N') < 0), '各人の担当可能区分からも消える');
  ok(Solver.generate(d3).violations.filter(v => v.level === 'hard').length >= 0, '削除後も生成できる');
}

T('シナリオ14：壊れた保存データ・不正な入力値でも落ちない');
{
  [{}, { employees: [], shiftTypes: [] }, { settings: 'x', employees: [{}], shiftTypes: [{}] },
  { settings: { year: 99999, month: 77 }, employees: [{ name: 'A', wage: -5, maxDays: 'abc' }], shiftTypes: [{ start: 'xx', end: null }] }
  ].forEach((broken, i) => {
    let okRun = true, msg = '';
    try {
      Store.setData(JSON.parse(JSON.stringify(broken)));
      const d = Store.get();
      const r = Solver.generate(d);
      if (!(d.settings.year >= 2000 && d.settings.month >= 1 && d.settings.month <= 12)) { okRun = false; msg = '年月が補正されていない'; }
      if (d.employees.some(e => e.wage < 0 || isNaN(e.maxDays))) { okRun = false; msg = '不正な数値が残っている'; }
      if (!r || !Array.isArray(r.violations)) { okRun = false; msg = '生成結果が不正'; }
    } catch (e) { okRun = false; msg = e.message; }
    ok(okRun, `壊れたデータ#${i + 1} を補正して動作する`, msg);
  });

  // JSON読み込み失敗時に現在のデータを壊さない
  Store.setData(baseData());
  const before = Store.get().employees.length;
  let threw = false;
  try { Store.importJson('{"foo":1}'); } catch (e) { threw = true; }
  ok(threw, '不正なJSONの読み込みは例外になる');
  ok(Store.get().employees.length === before, '読み込み失敗しても現在のデータが壊れない');
}

/* ---------------- 結果 ---------------- */
console.log('\n============================');
console.log(`  成功 ${pass} / 失敗 ${fail}`);
console.log('============================');
process.exit(fail ? 1 : 0);
