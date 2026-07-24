/* store.js — データモデル / localStorage 保存 / 初期サンプル
   すべて端末内で完結。外部へ送信しない。 */
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
      { id: 'A', name: '早番', short: '早', start: '08:00', end: '17:00', breakMin: 60, color: '#e5b978' },
      { id: 'B', name: '遅番', short: '遅', start: '13:00', end: '22:00', breakMin: 60, color: '#8fb2d8' },
      { id: 'N', name: '夜勤', short: '夜', start: '22:00', end: '07:00', breakMin: 90, color: '#a89ad0' }
    ];

    function emp(o) {
      return Object.assign({
        id: U.uid('e'), name: '', wage: 1100, employment: 'part',
        leader: false, certified: false, trainer: false, newbie: false, minor: false,
        canShift: shiftTypes.map(function (s) { return s.id; }),
        ngWeekdays: [], priority: 0,
        minDays: 0, maxDays: 22, minHoursMonth: 0, maxHoursMonth: 0,
        maxConsecutive: 5, maxNights: 0, weeklyHoursCap: 0,
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
        weekStartsOn: 0,        // 週の始まり 0=日曜 1=月曜
        budget: 0,              // 月間人件費予算（0=無制限）
        closedWeekdays: [],     // 定休日の曜日 [0=日 … 6=土]
        closedDates: []         // 臨時休業日 'YYYY-MM-DD'
      },
      // 祝日は自動計算（util.jpHolidays）。未提出日は出勤させない。
      // 必要人数を超える配置はしない。この3つは設定にせず固定。
      shiftTypes: shiftTypes,
      demand: { byWeekday: byWeekday, roleReq: roleReq, overrides: {} },
      employees: employees,
      requests: sampleRequests(y, m, employees),
      avail: sampleAvail(y, m, employees),   // avail[empId][date] = {allday:true}|{off:true}|{from,to}
      submissions: sampleSubmissions(employees),
      assignments: {},          // assignments[date][shiftTypeId] = [empId,...]
      prevMonth: {},            // prevMonth[date][shiftTypeId] = [empId,...]（月跨ぎ判定用）
      carryover: {},            // carryover[empId] = {nights, weekends, rejects}
      ruleConfig: {},           // rules.js の既定からの差分
      lastResult: null
    };
  }

  /* ---------- サンプル用の希望データ（初回から動くように） ---------- */
  function sampleAvail(y, m, employees) {
    var out = {};
    var dates = U.monthDates(y, m);
    employees.forEach(function (e, i) {
      out[e.id] = {};
      dates.forEach(function (d, j) {
        var w = U.weekdayOf(d);
        if ((e.ngWeekdays || []).indexOf(w) >= 0) { out[e.id][d] = { off: true }; return; }
        // 「この日は行けない」を人ごとにずらして入れる（周期11なので10人まで重ならない）
        if ((j + i) % 11 === 0) { out[e.id][d] = { off: true }; return; }
        if (e.id === 'e5' || e.id === 'e8') out[e.id][d] = { from: '08:00', to: '17:00' };
        else out[e.id][d] = { allday: true };
      });
    });
    return out;
  }
  function sampleRequests(y, m, employees) {
    var out = {};
    var dates = U.monthDates(y, m);
    employees.forEach(function (e, i) {
      out[e.id] = {};
      if (dates[4 + i]) out[e.id][dates[4 + i]] = 'off';
      if (dates[15 + (i % 5)]) out[e.id][dates[15 + (i % 5)]] = 'want';
    });
    return out;
  }
  function sampleSubmissions(employees) {
    var out = {};
    employees.forEach(function (e) { out[e.id] = { status: 'submitted', at: 'サンプル' }; });
    return out;
  }

  /* ---------- 初期状態（実運用の出発点） ----------
     従業員もシフトも空。勤務区分だけ雛形を置いておき、店に合わせて直してもらう。
     サンプルの店で試したい場合は loadDemo() を呼ぶ。 */
  function emptyData() {
    var base = sampleData();
    return {
      version: 1,
      settings: Object.assign({}, base.settings, { storeName: '' }),
      shiftTypes: U.clone(base.shiftTypes),
      demand: {
        byWeekday: { A: [0, 0, 0, 0, 0, 0, 0], B: [0, 0, 0, 0, 0, 0, 0], N: [0, 0, 0, 0, 0, 0, 0] },
        roleReq: { A: { leader: false, certified: false }, B: { leader: false, certified: false }, N: { leader: false, certified: false } },
        overrides: {}
      },
      employees: [],
      requests: {}, avail: {}, submissions: {},
      assignments: {}, prevMonth: {}, carryover: {}, ruleConfig: {}, lastResult: null
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
    } catch (e) { console.warn('保存データを読めなかったため初期状態で起動します', e); }
    data = emptyData();
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
    if (!Array.isArray(s.closedWeekdays)) s.closedWeekdays = [];
    if (!Array.isArray(s.closedDates)) s.closedDates = [];

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
      ['minDays', 'maxDays', 'minHoursMonth', 'maxHoursMonth', 'maxConsecutive', 'maxNights', 'weeklyHoursCap', 'incomeCap', 'ytdEarnings'].forEach(function (k) {
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

  var saveErrorHandler = null;
  function onSaveError(fn) { saveErrorHandler = fn; }

  function save() {
    if (typeof localStorage === 'undefined') return true;   // Node でのテスト実行時
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      // 容量超過など。説明用のデータ（trace）を捨ててもう一度試す
      try {
        if (data.lastResult) { data.lastResult.trace = {}; }
        localStorage.setItem(KEY, JSON.stringify(data));
        if (saveErrorHandler) saveErrorHandler('保存容量が不足したため、作成理由の記録だけ削除して保存しました');
        return true;
      } catch (e2) {
        console.warn('保存に失敗しました', e2);
        if (saveErrorHandler) saveErrorHandler('⚠ 保存できませんでした。［書き出し］でファイルに残してください');
        return false;
      }
    }
  }
  /** テスト用：任意のデータを流し込む */
  function setData(d) { data = d; migrate(); return data; }

  function get() { return data || load(); }
  function reset() { data = emptyData(); save(); return data; }
  /** 動きを試すためのサンプル店（10名）を読み込む */
  function loadDemo() { data = migrate(sampleData()); save(); return data; }

  /** 初期サンプルのまま触られていないか（案内を出すかの判定用） */
  function isSample() {
    var d = get();
    return d.settings.storeName === 'サンプル店'
      && d.employees.length === 10
      && d.employees[0] && d.employees[0].id === 'e1' && d.employees[0].name === '田中 店長';
  }

  /** 中身を消して、自分の店を1から作る状態にする */
  function startFresh() {
    data = migrate(emptyData());
    save();
    return data;
  }

  function exportJson() {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    U.download(blob, 'shift_' + data.settings.year + U.pad(data.settings.month) + '.json');
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
  /** 氏名のゆらぎを吸収して照合するための正規化（空白・全角半角） */
  function normName(x) {
    return String(x || '').replace(/[\s　]/g, '').toLowerCase();
  }
  /** 希望データに一致しそうな従業員を推測する（見つからなければ null） */
  function guessEmployee(obj) {
    var d = get();
    if (obj && obj.id) { var byId = empById(obj.id); if (byId) return byId; }
    var n = normName(obj && obj.name);
    if (!n) return null;
    return d.employees.filter(function (x) { return normName(x.name) === n; })[0] || null;
  }
  /** 従業員を新規追加して返す */
  function addEmployee(name) {
    var d = get();
    var e = U.clone(sampleData().employees[0]);
    e.id = U.uid('e');
    e.name = name || '新しい従業員';
    e.leader = false; e.certified = false; e.trainer = false; e.newbie = false; e.minor = false;
    e.priority = 0; e.minDays = 0; e.maxDays = 20; e.maxConsecutive = 5;
    e.minHoursMonth = 0; e.maxHoursMonth = 0; e.maxNights = 0; e.weeklyHoursCap = 0;
    e.incomeCap = 0; e.ytdEarnings = 0; e.note = '';
    e.ngPartners = []; e.goodPartners = []; e.trainerId = ''; e.ngWeekdays = [];
    e.canShift = d.shiftTypes.map(function (s) { return s.id; });
    d.employees.push(e);
    save();
    return e;
  }

  /** 希望データを取り込む。forceEmpId を渡すとその人に確定で入れる（プルダウン選択用） */
  function importSubmission(obj, forceEmpId) {
    var d = get();
    if (!obj || obj.t !== 'shift-submission') throw new Error('シフト希望のデータではありません');
    var e = forceEmpId ? empById(forceEmpId) : guessEmployee(obj);
    if (!e) throw new Error('「' + (obj.name || '?') + '」は従業員に登録されていません（先に②で登録してください）');
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
  /** お店が休みの日か（定休日 or 臨時休業日） */
  function isClosed(date) {
    var s = get().settings;
    if ((s.closedDates || []).indexOf(date) >= 0) return true;
    return (s.closedWeekdays || []).indexOf(U.weekdayOf(date)) >= 0;
  }

  /** その日・その勤務区分の必要人数（休業日は0人） */
  function needOf(date, stId) {
    if (isClosed(date)) return 0;
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
  /** 日本の祝日か（自動計算・設定不要） */
  function isHoliday(date) {
    var y = +String(date).slice(0, 4);
    return !!U.jpHolidays(y)[date];
  }
  function holidayName(date) {
    var y = +String(date).slice(0, 4);
    return U.jpHolidays(y)[date] || '';
  }
  function isWeekendOrHoliday(date) {
    var w = U.weekdayOf(date);
    return w === 0 || w === 6 || isHoliday(date);
  }

  return {
    load: load, save: save, get: get, reset: reset, setData: setData,
    isSample: isSample, startFresh: startFresh, emptyData: emptyData, loadDemo: loadDemo,
    exportJson: exportJson, importJson: importJson, sampleData: sampleData,
    removeEmployee: removeEmployee, removeShiftType: removeShiftType,
    exportSubmission: exportSubmission, importSubmission: importSubmission, onSaveError: onSaveError,
    guessEmployee: guessEmployee, addEmployee: addEmployee,
    stCalc: stCalc, empById: empById, stById: stById, monthDates: monthDates,
    needOf: needOf, assignedOf: assignedOf, requestOf: requestOf,
    availOf: availOf, setAvail: setAvail, submissionOf: submissionOf, submittedCount: submittedCount,
    isHoliday: isHoliday, holidayName: holidayName, isWeekendOrHoliday: isWeekendOrHoliday,
    isClosed: isClosed
  };
})();

if (typeof module !== 'undefined') module.exports = Store;
