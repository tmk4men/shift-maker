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
      } else {
        errs.push(`${e.name}: 希望が未入力の日に割当 (${date})`);
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

    if (e.minor) {
      Object.keys(week).forEach(w => {
        if (week[w] > 2400) errs.push(`【法令】${e.name}(18歳未満): 週${(week[w] / 60).toFixed(1)}h`);
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
  fillAvail(d, 2026, 8);
  fillAvail(d, 2026, 9);        // 月をまたぐテスト用
  return Object.assign(d, over || {});
}

/** 希望の入力がない日は出勤させない仕様なので、テストでも埋めておく */
function fillAvail(d, y, m, mode) {
  d.avail = d.avail || {};
  const dates = U.monthDates(y, m);
  d.employees.forEach((e, i) => {
    d.avail[e.id] = d.avail[e.id] || {};
    dates.forEach((dt, j) => {
      const w = U.weekdayOf(dt);
      if ((e.ngWeekdays || []).indexOf(w) >= 0) { d.avail[e.id][dt] = { off: true }; return; }
      if (mode === 'all') { d.avail[e.id][dt] = { allday: true }; return; }
      if ((j + i * 3) % 7 === 0) { d.avail[e.id][dt] = { off: true }; return; }
      d.avail[e.id][dt] = { allday: true };
    });
  });
  return d;
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
  d.employeesPlaceholder = 1;
  d.employees = [
    { id: 'c1', name: '店主', wage: 1500, employment: 'full', leader: true, certified: true, trainer: true, newbie: false, minor: false, canShift: ['A', 'B'], ngWeekdays: [], priority: 0, minDays: 20, maxDays: 24, maxConsecutive: 6, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' },
    { id: 'c2', name: '副店長', wage: 1300, employment: 'full', leader: true, certified: false, trainer: true, newbie: false, minor: false, canShift: ['A', 'B'], ngWeekdays: [], priority: 0, minDays: 18, maxDays: 22, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' },
    { id: 'c3', name: 'パートA', wage: 1100, employment: 'part', leader: false, certified: false, trainer: true, newbie: false, minor: false, canShift: ['A'], ngWeekdays: [0, 6], priority: 0, minDays: 12, maxDays: 18, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' },
    { id: 'c4', name: 'パートB', wage: 1100, employment: 'part', leader: false, certified: false, trainer: false, newbie: false, minor: false, canShift: ['B'], ngWeekdays: [], priority: 0, minDays: 12, maxDays: 18, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' },
    { id: 'c5', name: '学生', wage: 1050, employment: 'student', leader: false, certified: false, trainer: false, newbie: false, minor: false, canShift: ['A', 'B'], ngWeekdays: [1, 2], priority: 0, minDays: 8, maxDays: 14, maxConsecutive: 4, maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: '' }
  ];
  fillAvail(d, 2026, 8, 'all');
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
  fillAvail(d, 2026, 8, 'all');
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
   シナリオ6b：週20時間未満に抑える（2026年10月からの社会保険ライン）
   ======================================================================= */
T('シナリオ6b：社会保険に入りたくない人を週20時間未満に抑える');
{
  const d = baseData();
  const e5 = d.employees.find(e => e.id === 'e5');
  e5.weeklyHoursCap = 19;      // 週20時間以上で 社会保険の対象になるため19時間まで
  e5.incomeCap = 0;
  e5.minDays = 8; e5.maxDays = 20;
  const { data, res } = run(d);
  const errs = audit(data, res.assignments);
  ok(errs.length === 0, 'ハード制約の違反なし', errs.slice(0, 5).join('\n       → '));

  // 各週の労働時間を独立に数える
  const ctx = Rules.buildContext(data, JSON.parse(JSON.stringify(res.assignments)));
  const weeks = ctx.stats.e5.week;
  const over = Object.keys(weeks).filter(w => weeks[w] > 19 * 60);
  console.log('  伊藤の週別労働時間:', Object.keys(weeks).map(w => (weeks[w] / 60).toFixed(1) + 'h').join(' '));
  ok(over.length === 0, 'どの週も19時間を超えない', over.map(w => w + '=' + (weeks[w] / 60).toFixed(1) + 'h').join(','));
  ok(res.stats.e5.days > 0, '上限内でちゃんと勤務が入る');

  // 手で超過させたら検出されるか
  const a = JSON.parse(JSON.stringify(res.assignments));
  const dates = U.monthDates(2026, 8).slice(0, 7);
  dates.forEach(dt => {
    if (!a[dt]) a[dt] = {};
    Object.keys(a[dt]).forEach(k => { a[dt][k] = a[dt][k].filter(x => x !== 'e5'); });
    (a[dt].A = a[dt].A || []).push('e5');
  });
  const rv = Solver.revalidate(data, a);
  ok(rv.violations.some(v => v.ruleId === 'OPS-A07'), '手動で週上限を超えたら検出する',
    rv.violations.filter(v => v.level === 'hard').map(v => v.ruleId).join(','));
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
T('シナリオ8：18歳未満 / 相性NG');
{
  const d = baseData();
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
  fillAvail(d, 2026, 8, 'all');
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

/* =======================================================================
   シナリオ9b：2か月続けて作る（月をまたいだ運用）
   ======================================================================= */
T('シナリオ9b：8月→9月と続けて作成する');
{
  const d = baseData();
  Store.setData(d);
  const r1 = Solver.generate(Store.get());
  Store.get().assignments = r1.assignments;               // UIと同じ代入
  const augDays = Object.keys(Store.get().assignments).filter(k => k.startsWith('2026-08')).length;

  Store.get().settings.month = 9;
  const r2 = Solver.generate(Store.get());
  Store.get().assignments = r2.assignments;
  const data2 = Store.get();

  ok(Object.keys(data2.assignments).filter(k => k.startsWith('2026-08')).length === augDays,
    '9月を作っても8月のシフトが消えない');
  ok(Object.keys(data2.assignments).filter(k => k.startsWith('2026-09')).length > 0, '9月のシフトができる');

  // 集計に前月が混ざっていないか
  const maxDaysInSep = Math.max(...data2.employees.map(e => r2.stats[e.id].days));
  ok(maxDaysInSep <= 30, '9月の集計に8月分が混ざっていない', `最大 ${maxDaysInSep} 日`);

  // 月をまたぐ夜勤明け・連勤
  const n831 = (r2.assignments['2026-08-31'] || {}).N || [];
  const worked91 = n831.filter(id =>
    Object.keys(r2.assignments['2026-09-01'] || {}).some(st => (r2.assignments['2026-09-01'][st] || []).indexOf(id) >= 0));
  ok(worked91.length === 0, '8/31が夜勤だった人は9/1に入らない');

  // 8月分も渡して、月をまたぐ連勤・インターバルまで含めて監査する
  const errs = audit(data2, r2.assignments);
  ok(errs.length === 0, '月をまたいだ連勤・インターバルも含めて違反なし', errs.slice(0, 5).join('\n       → '));

  // 公平性の繰り越し（前月に夜勤が多かった人は今月減る方向に働く）
  const aug = data2.employees.map(e => ({ n: e.name, v: r1.stats[e.id].nights }));
  const sep = data2.employees.map(e => ({ n: e.name, v: r2.stats[e.id].nights }));
  const two = aug.map((a, i) => a.v + sep[i].v).filter((_, i) => aug[i].v + sep[i].v > 0);
  const spread2 = Math.max(...two) - Math.min(...two);
  console.log('  2か月合計の夜勤:', aug.map((a, i) => a.n + '=' + (a.v + sep[i].v)).join(' '));
  ok(spread2 <= 4, '2か月通算でも夜勤の偏りが小さい', `最大差 ${spread2}`);
}

/* =======================================================================
   シナリオ13b：手動編集で入り込む違反を全部検出できるか
   ======================================================================= */
T('シナリオ13b：手で入れた違反シフトを全部検出する');
{
  const { data, res } = run(baseData());
  const dates = U.monthDates(2026, 8);
  function put(a, date, stId, empId) {
    if (!a[date]) a[date] = {};
    Object.keys(a[date]).forEach(k => { a[date][k] = a[date][k].filter(x => x !== empId); });
    (a[date][stId] = a[date][stId] || []).push(empId);
  }
  const base = () => JSON.parse(JSON.stringify(res.assignments));

  // ① 月間夜勤上限の超過
  {
    const d2 = Store.get();
    d2.employees.find(e => e.id === 'e4').maxNights = 1;
    const rv = Solver.revalidate(d2, res.assignments);
    ok(rv.violations.some(v => v.ruleId === 'OPS-064' && v.level === 'hard'), '月間夜勤上限の超過を検出する',
      rv.violations.filter(v => v.level === 'hard').map(v => v.ruleId).join(','));
    d2.employees.find(e => e.id === 'e4').maxNights = 0;
  }
  // ② 月間上限時間の超過
  {
    const d2 = Store.get();
    d2.employees.find(e => e.id === 'e1').maxHoursMonth = 10;
    const rv = Solver.revalidate(d2, res.assignments);
    ok(rv.violations.some(v => v.ruleId === 'OPS-035' && v.msg.indexOf('月間上限') >= 0), '月間上限時間の超過を検出する');
    d2.employees.find(e => e.id === 'e1').maxHoursMonth = 0;
  }
  // ③ 18歳未満を8時間超の勤務へ
  {
    const d2 = Store.get();
    d2.shiftTypes.push({ id: 'L', name: '通し', short: '通', start: '08:00', end: '21:00', breakMin: 60, color: '#ccc' });
    d2.demand.byWeekday.L = [1, 1, 1, 1, 1, 1, 1];
    d2.demand.roleReq.L = { leader: false, certified: false };
    d2.employees.find(e => e.id === 'e8').canShift.push('L');
    const a = base();
    put(a, dates[3], 'L', 'e8');
    const rv = Solver.revalidate(d2, a);
    ok(rv.violations.some(v => v.ruleId === 'LAW-041'), '18歳未満の8時間超勤務を検出する',
      rv.violations.filter(v => v.level === 'hard').map(v => v.ruleId).join(','));
  }
  // ④ 同じ日に2つの勤務
  {
    Store.setData(baseData());
    const r2 = Solver.generate(Store.get());
    const a = JSON.parse(JSON.stringify(r2.assignments));
    const dt = dates[5];
    if (!a[dt]) a[dt] = {};
    (a[dt].A = a[dt].A || []).push('e1');
    (a[dt].B = a[dt].B || []).push('e1');
    const rv = Solver.revalidate(Store.get(), a);
    ok(rv.violations.some(v => v.ruleId === 'OPS-A06'), '同じ日の重複割当を検出する',
      rv.violations.filter(v => v.level === 'hard').map(v => v.ruleId).join(','));
  }
  // ⑤ 勤務不可曜日・相性NG
  {
    Store.setData(baseData());
    const d2 = Store.get();
    d2.employees.find(e => e.id === 'e6').ngWeekdays = [0, 1, 2, 3, 4, 5, 6];
    d2.employees.find(e => e.id === 'e4').ngPartners = ['e3'];
    const r2 = Solver.generate(baseData());
    const a = JSON.parse(JSON.stringify(r2.assignments));
    const dt = dates[7];
    if (!a[dt]) a[dt] = {};
    a[dt].A = ['e4', 'e3', 'e6'];
    const rv = Solver.revalidate(d2, a);
    ok(rv.violations.some(v => v.ruleId === 'OPS-032'), '勤務不可曜日への割当を検出する');
    ok(rv.violations.some(v => v.ruleId === 'OPS-100'), '相性NGの同時勤務を検出する');
  }
}

/* =======================================================================
   シナリオ13c：責任者＋有資格者の両方が必要で兼任者がいない
   ======================================================================= */
T('シナリオ13c：1席に責任者＋有資格者が必要だが兼任者がいない');
{
  const d = baseData();
  d.shiftTypes = [{ id: 'A', name: '日勤', short: '日', start: '09:00', end: '18:00', breakMin: 60, color: '#f6c453' }];
  d.demand = { byWeekday: { A: [1, 1, 1, 1, 1, 1, 1] }, roleReq: { A: { leader: true, certified: true } }, overrides: {} };
  const mk = (id, name, leader, certified) => ({
    id, name, wage: 1200, employment: 'part', leader, certified, trainer: true, newbie: false, minor: false,
    canShift: ['A'], ngWeekdays: [], priority: 0, minDays: 0, maxDays: 20, maxConsecutive: 5,
    maxHoursMonth: 0, maxNights: 0, ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: ''
  });
  d.employees = [mk('x1', 'リーダーのみ', true, false), mk('x2', '有資格のみ', false, true), mk('x3', 'どちらでもない', false, false)];
  fillAvail(d, 2026, 8, 'all');
  const { data, res } = run(d);
  const cov = coverage(data, res.assignments);
  console.log(`  充足率 ${(cov.rate * 100).toFixed(1)}% / 役割違反 ${res.violations.filter(v => v.ruleId === 'OPS-003' || v.ruleId === 'OPS-004').length}件`);
  ok(audit(data, res.assignments).length === 0, 'ハード制約の違反なし');
  ok(res.violations.some(v => v.ruleId === 'OPS-003' || v.ruleId === 'OPS-004'), '役割を満たせないことが違反として報告される');
  ok(res.log.some(l => l.indexOf('人数だけ') >= 0), '「人数だけ埋めた」ことがログに残る（黙って埋めない）',
    res.log.slice(0, 2).join(' | '));
}

T('シナリオ14：壊れた保存データ・不正な入力値でも落ちない');
{
  [{}, { employees: [], shiftTypes: [] }, { settings: 'x', employees: [{}], shiftTypes: [{}] },
  { settings: { year: 99999, month: 77 }, employees: [{ name: 'A', wage: -5, maxDays: 'abc' }], shiftTypes: [{ start: 'xx', end: null }] },
  { employees: [{ id: 'a', name: 'A' }], shiftTypes: [{ id: 'A', name: '日勤', start: '09:00', end: '18:00', breakMin: 60 }], demand: {} },
  { employees: [{ id: 'a', name: 'A' }], shiftTypes: [{ id: 'A', name: '日勤', start: '09:00', end: '18:00', breakMin: 60 }], demand: { byWeekday: null, roleReq: 'x', overrides: [] } },
  { employees: [{ id: 'a', name: 'A' }], shiftTypes: [{ id: 'A', name: '日勤', start: '09:00', end: '18:00', breakMin: 60 }], assignments: { '2026-08-01': { A: 'notarray' } }, requests: 'x', avail: [] }
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
