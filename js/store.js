/* store.js — データモデル / localStorage 保存 / 初期サンプル
   すべてブラウザ内で完結。外部へ送信しない。 */
var Store = (function () {

  var KEY = 'shift-maker-v1';

  /* ---------- 勤務区分の計算（時刻まわり） ---------- */
  function stCalc(st) {
    var s = U.hm2min(st.start);
    var e = U.hm2min(st.end);
    if (e <= s) e += 1440;                       // 日跨ぎ
    var span = e - s;                            // 拘束
    var work = span - (st.breakMin || 0);        // 実労働
    // 深夜(22:00-5:00)の重なり：当日0-5時 / 22時-翌5時 / 翌22時-翌々5時
    var night = U.overlap(s, e, 0, 300)
      + U.overlap(s, e, 1320, 1740)
      + U.overlap(s, e, 2760, 3180);
    return { start: s, end: e, span: span, work: work, night: night, overnight: e > 1440 };
  }

  /* ---------- 初期データ ---------- */
  function sampleData() {
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth() + 1;

    var shiftTypes = [
      { id: 'A', name: '早番', short: '早', start: '08:00', end: '17:00', breakMin: 60, color: '#f6c453' },
      { id: 'B', name: '遅番', short: '遅', start: '13:00', end: '22:00', breakMin: 60, color: '#7fb3f5' },
      { id: 'N', name: '夜勤', short: '夜', start: '22:00', end: '07:00', breakMin: 90, color: '#9b8cf0' }
    ];

    function emp(o) {
      return Object.assign({
        id: U.uid('e'), name: '', wage: 1100, employment: 'part',
        leader: false, certified: false, trainer: false, newbie: false, minor: false,
        canShift: shiftTypes.map(function (s) { return s.id; }),
        ngWeekdays: [], priority: 0,
        minDays: 0, maxDays: 22, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 0,
        ngPartners: [], goodPartners: [], trainerId: '',
        incomeCap: 0, ytdEarnings: 0, note: ''
      }, o);
    }

    var e1 = emp({ id: 'e1', name: '田中 店長', wage: 1800, employment: 'full', leader: true, certified: true, trainer: true, minDays: 18, maxDays: 22 });
    var e2 = emp({ id: 'e2', name: '佐藤', wage: 1400, employment: 'full', leader: true, trainer: true, minDays: 16, maxDays: 21 });
    var e3 = emp({ id: 'e3', name: '鈴木', wage: 1250, leader: true, certified: true, trainer: true, minDays: 14, maxDays: 21 });
    var e4 = emp({ id: 'e4', name: '高橋', wage: 1150, certified: true, minDays: 14, maxDays: 21, priority: 1 });
    var e5 = emp({ id: 'e5', name: '伊藤(扶養内)', wage: 1150, minDays: 6, maxDays: 12, incomeCap: 1230000, ytdEarnings: 620000, canShift: ['A', 'B'] });
    var e6 = emp({ id: 'e6', name: '渡辺(学生)', wage: 1100, employment: 'student', minDays: 6, maxDays: 16, canShift: ['A', 'B'], ngWeekdays: [1, 2] });
    var e7 = emp({ id: 'e7', name: '山本(新人)', wage: 1100, newbie: true, minDays: 8, maxDays: 16, canShift: ['A', 'B'], trainerId: 'e3' });
    var e8 = emp({ id: 'e8', name: '中村(高校生)', wage: 1080, employment: 'student', minor: true, minDays: 4, maxDays: 10, canShift: ['A'], priority: -1 });
    var e9 = emp({ id: 'e9', name: '小林', wage: 1200, leader: true, trainer: true, minDays: 14, maxDays: 20 });
    var e10 = emp({ id: 'e10', name: '加藤', wage: 1150, certified: true, trainer: true, minDays: 12, maxDays: 20 });

    var employees = [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10];

    // 曜日別の必要人数 [日,月,火,水,木,金,土]
    var byWeekday = {
      A: [2, 2, 2, 2, 2, 2, 2],
      B: [2, 1, 1, 1, 1, 1, 2],
      N: [1, 1, 1, 1, 1, 1, 1]
    };
    var roleReq = {
      A: { leader: true, certified: false },
      B: { leader: false, certified: true },
      N: { leader: false, certified: false }
    };

    return {
      version: 1,
      settings: {
        storeName: 'サンプル店',
        year: y, month: m,
        holidays: [],           // 祝日 'YYYY-MM-DD'
        budget: 0,              // 月間人件費予算（0=無制限）
        has36: true,            // 36協定あり
        weekStartsOn: 0,        // 週の起算日 0=日曜
        collectOpen: true,      // 希望提出の受付中か
        deadline: '',           // 提出締切日
        unsubmittedPolicy: 'available', // 未提出日の扱い available=出勤可 / unavailable=不可
        allowOverstaff: false   // 最低出勤日数を満たすために必要人数＋1まで許容するか
      },
      shiftTypes: shiftTypes,
      demand: { byWeekday: byWeekday, roleReq: roleReq, overrides: {} },
      employees: employees,
      requests: {},             // requests[empId][date] = 'off'|'must'|'want'|'paid'
      avail: {},                // avail[empId][date] = {allday:true} | {off:true} | {from:'09:00',to:'18:00'}
      submissions: {},          // submissions[empId] = {status:'submitted', at:'...'}
      assignments: {},          // assignments[date][shiftTypeId] = [empId,...]
      prevMonth: {},            // prevMonth[date][shiftTypeId] = [empId,...]（月跨ぎ判定用）
      carryover: {},            // carryover[empId] = {nights, weekends, rejects}
      ruleConfig: {},           // rules.js の既定からの差分
      lastResult: null
    };
  }

  /* ---------- 保存・読み込み ---------- */
  var data = null;

  function load() {
    try {
      var raw = (typeof localStorage === 'undefined') ? null : localStorage.getItem(KEY);
      if (raw) {
        var obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) { data = migrate(obj); return data; }
      }
    } catch (e) { console.warn('保存データを読めなかったため初期データで起動します', e); }
    data = sampleData();
    return data;
  }

  /** 足りないキー・壊れた型を既定値で補う（保存データの破損・旧バージョン対策） */
  function migrate(target) {
    var d = target || data;
    var base = sampleData();
    if (!d || typeof d !== 'object' || Array.isArray(d)) d = base;

    Object.keys(base).forEach(function (k) {
      var want = base[k];
      var got = d[k];
      var okType = Array.isArray(want) ? Array.isArray(got)
        : (want !== null && typeof want === 'object') ? (got !== null && typeof got === 'object' && !Array.isArray(got))
          : true;
      if (got === undefined || got === null || !okType) d[k] = U.clone(want);
    });
    Object.keys(base.settings).forEach(function (k) {
      if (d.settings[k] === undefined || d.settings[k] === null) d.settings[k] = base.settings[k];
    });
    // 年月が不正なら今月に戻す
    var s = d.settings;
    if (!(s.year >= 1970 && s.year <= 3000)) s.year = base.settings.year;
    if (!(s.month >= 1 && s.month <= 12)) s.month = base.settings.month;
    if (!Array.isArray(s.holidays)) s.holidays = [];

    if (!d.shiftTypes.length) d.shiftTypes = U.clone(base.shiftTypes);
    d.shiftTypes.forEach(function (st, i) {
      if (!st.id) st.id = 'S' + i;
      if (!st.name) st.name = '勤務' + (i + 1);
      if (!/^\d{1,2}:\d{2}$/.test(st.start || '')) st.start = '09:00';
      if (!/^\d{1,2}:\d{2}$/.test(st.end || '')) st.end = '18:00';
      st.breakMin = Math.max(0, Math.min(600, +st.breakMin || 0));
    });

    // demand の入れ子まで型を保証する（demand:{} や byWeekday:null で落ちないように）
    if (!d.demand || typeof d.demand !== 'object' || Array.isArray(d.demand)) d.demand = {};
    ['byWeekday', 'roleReq', 'overrides', 'byWeekdayMax'].forEach(function (k) {
      if (!d.demand[k] || typeof d.demand[k] !== 'object' || Array.isArray(d.demand[k])) d.demand[k] = {};
    });
    Object.keys(d.demand.roleReq).forEach(function (k) {
      var v = d.demand.roleReq[k];
      if (!v || typeof v !== 'object' || Array.isArray(v)) d.demand.roleReq[k] = { leader: false, certified: false };
    });
    Object.keys(d.demand.overrides).forEach(function (k) {
      var v = d.demand.overrides[k];
      if (!v || typeof v !== 'object' || Array.isArray(v)) delete d.demand.overrides[k];
    });
    ['requests', 'avail', 'submissions', 'carryover', 'assignments', 'prevMonth', 'ruleConfig'].forEach(function (k) {
      if (!d[k] || typeof d[k] !== 'object' || Array.isArray(d[k])) d[k] = {};
    });
    [d.assignments, d.prevMonth].forEach(function (map) {
      Object.keys(map).forEach(function (date) {
        var day = map[date];
        if (!day || typeof day !== 'object' || Array.isArray(day)) { delete map[date]; return; }
        Object.keys(day).forEach(function (stId) { if (!Array.isArray(day[stId])) day[stId] = []; });
      });
    });
    ['requests', 'avail'].forEach(function (k) {
      Object.keys(d[k]).forEach(function (id) {
        if (!d[k][id] || typeof d[k][id] !== 'object' || Array.isArray(d[k][id])) d[k][id] = {};
      });
    });

    var defEmp = base.employees[0];
    d.employees = d.employees.filter(function (e) { return e && typeof e === 'object'; });
    d.employees.forEach(function (e, i) {
      Object.keys(defEmp).forEach(function (k) {
        if (e[k] === undefined || e[k] === null) e[k] = U.clone(defEmp[k]);
        else if (Array.isArray(defEmp[k]) && !Array.isArray(e[k])) e[k] = U.clone(defEmp[k]);
      });
      if (!e.id) e.id = U.uid('e');
      if (!e.name) e.name = '従業員' + (i + 1);
      e.wage = Math.max(0, +e.wage || 0);
      ['minDays', 'maxDays', 'maxConsecutive', 'maxHoursMonth', 'maxNights', 'incomeCap', 'ytdEarnings'].forEach(function (k) {
        e[k] = Math.max(0, +e[k] || 0);
      });
      e.priority = Math.max(-3, Math.min(3, +e.priority || 0));
    });

    // 勤務区分・従業員の消滅に伴う参照切れを掃除
    var stIds = {}; d.shiftTypes.forEach(function (st) { stIds[st.id] = 1; });
    var empIds = {}; d.employees.forEach(function (e) { empIds[e.id] = 1; });
    d.employees.forEach(function (e) {
      e.canShift = (e.canShift || []).filter(function (x) { return stIds[x]; });
      e.ngPartners = (e.ngPartners || []).filter(function (x) { return empIds[x]; });
      e.goodPartners = (e.goodPartners || []).filter(function (x) { return empIds[x]; });
      if (e.trainerId && !empIds[e.trainerId]) e.trainerId = '';
    });
    [d.assignments, d.prevMonth].forEach(function (map) {
      Object.keys(map || {}).forEach(function (date) {
        Object.keys(map[date] || {}).forEach(function (stId) {
          if (!stIds[stId]) { delete map[date][stId]; return; }
          map[date][stId] = (map[date][stId] || []).filter(function (x) { return empIds[x]; });
        });
      });
    });
    ['requests', 'avail', 'submissions', 'carryover'].forEach(function (key) {
      Object.keys(d[key] || {}).forEach(function (id) { if (!empIds[id]) delete d[key][id]; });
    });
    Object.keys(d.demand.byWeekday || {}).forEach(function (stId) { if (!stIds[stId]) delete d.demand.byWeekday[stId]; });
    d.shiftTypes.forEach(function (st) {
      if (!Array.isArray(d.demand.byWeekday[st.id]) || d.demand.byWeekday[st.id].length !== 7)
        d.demand.byWeekday[st.id] = [0, 0, 0, 0, 0, 0, 0];
      if (!d.demand.roleReq[st.id]) d.demand.roleReq[st.id] = { leader: false, certified: false };
    });
    return d;
  }

  /** 従業員を削除し、関連データも一緒に消す */
  function removeEmployee(empId) {
    var d = get();
    d.employees = d.employees.filter(function (e) { return e.id !== empId; });
    migrate();
    save();
  }

  /** 勤務区分を削除し、関連データも一緒に消す */
  function removeShiftType(stId) {
    var d = get();
    d.shiftTypes = d.shiftTypes.filter(function (s) { return s.id !== stId; });
    migrate();
    save();
  }

  function save() {
    if (typeof localStorage === 'undefined') return;   // Node でのテスト実行時
    try { localStorage.setItem(KEY, JSON.stringify(data)); }
    catch (e) { console.warn('保存に失敗しました（容量超過の可能性）', e); }
  }
  /** テスト用：任意のデータを流し込む */
  function setData(d) { data = d; migrate(); return data; }

  function get() { return data || load(); }
  function reset() { data = sampleData(); save(); return data; }

  function exportJson() {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'shift_' + data.settings.year + U.pad(data.settings.month) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /** 読み込みは一時オブジェクトで完結させてから差し替える（失敗しても現在のデータを壊さない） */
  function importJson(text) {
    var obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('シフトデータではありません');
    if (!Array.isArray(obj.employees) || !Array.isArray(obj.shiftTypes)) throw new Error('シフトデータではありません（従業員・勤務区分が見つかりません）');
    var fixed = migrate(U.clone(obj));
    data = fixed; save();
  }

  /** スタッフ1人分の提出内容だけを取り込む（LINE等で受け取ったコード用） */
  function exportSubmission(empId) {
    var d = get(), e = empById(empId);
    if (!e) throw new Error('従業員が見つかりません');
    return {
      t: 'shift-submission', v: 1, name: e.name, id: empId,
      ym: d.settings.year + '-' + U.pad(d.settings.month),
      avail: d.avail[empId] || {}, requests: d.requests[empId] || {}
    };
  }
  function importSubmission(obj) {
    var d = get();
    if (!obj || obj.t !== 'shift-submission') throw new Error('提出コードではありません');
    var e = empById(obj.id) || d.employees.filter(function (x) { return x.name === obj.name; })[0];
    if (!e) throw new Error('「' + (obj.name || '?') + '」という従業員が登録されていません');
    var ym = d.settings.year + '-' + U.pad(d.settings.month);
    if (obj.ym && obj.ym !== ym) throw new Error('対象月が違います（提出コードは ' + obj.ym + '）');
    d.avail[e.id] = obj.avail || {};
    d.requests[e.id] = obj.requests || {};
    d.submissions[e.id] = { status: 'submitted', at: '取込' };
    save();
    return e;
  }

  /* ---------- 参照ヘルパ ---------- */
  function empById(id) {
    return get().employees.filter(function (e) { return e.id === id; })[0] || null;
  }
  function stById(id) {
    return get().shiftTypes.filter(function (s) { return s.id === id; })[0] || null;
  }
  function monthDates() {
    return U.monthDates(get().settings.year, get().settings.month);
  }
  /** その日・その勤務区分の必要人数 */
  function needOf(date, stId) {
    var d = get().demand;
    var ov = d.overrides[date];
    if (ov && ov[stId] !== undefined && ov[stId] !== null && ov[stId] !== '') return +ov[stId];
    var arr = d.byWeekday[stId];
    if (!arr) return 0;
    return +arr[U.weekdayOf(date)] || 0;
  }
  function assignedOf(date, stId) {
    var a = get().assignments[date];
    return (a && a[stId]) ? a[stId] : [];
  }
  function requestOf(empId, date) {
    var r = get().requests[empId];
    return (r && r[date]) ? r[date] : '';
  }
  /** 提出済みの勤務可能時間
   *  null = 未提出 / false = その日は不可 / 'any' = 終日可 / {from,to} = 時間指定 */
  function availOf(empId, date) {
    var a = get().avail[empId];
    if (!a || !a[date]) return null;
    var v = a[date];
    if (v.off) return false;
    if (v.allday) return 'any';
    if (v.from && v.to) return { from: v.from, to: v.to };
    return null;
  }
  function setAvail(empId, date, val) {
    var d = get();
    if (!d.avail[empId]) d.avail[empId] = {};
    if (val === null) delete d.avail[empId][date];
    else d.avail[empId][date] = val;
  }
  /** 提出状況 */
  function submissionOf(empId) {
    return get().submissions[empId] || { status: 'open', at: '' };
  }
  function submittedCount() {
    var d = get();
    return d.employees.filter(function (e) { return submissionOf(e.id).status === 'submitted'; }).length;
  }
  function isHoliday(date) { return get().settings.holidays.indexOf(date) >= 0; }
  function isWeekendOrHoliday(date) {
    var w = U.weekdayOf(date);
    return w === 0 || w === 6 || isHoliday(date);
  }

  return {
    load: load, save: save, get: get, reset: reset, setData: setData,
    exportJson: exportJson, importJson: importJson, sampleData: sampleData,
    removeEmployee: removeEmployee, removeShiftType: removeShiftType,
    exportSubmission: exportSubmission, importSubmission: importSubmission,
    stCalc: stCalc, empById: empById, stById: stById, monthDates: monthDates,
    needOf: needOf, assignedOf: assignedOf, requestOf: requestOf,
    availOf: availOf, setAvail: setAvail, submissionOf: submissionOf, submittedCount: submittedCount,
    isHoliday: isHoliday, isWeekendOrHoliday: isWeekendOrHoliday
  };
})();

if (typeof module !== 'undefined') module.exports = Store;
