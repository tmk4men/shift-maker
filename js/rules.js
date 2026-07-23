/* rules.js — ルールブック本体
   rules/01〜05 の制約をコードに落としたもの。
   hard = 絶対に破らない / soft = 減点して最小化する。
   法令(law)由来のルールは UI から無効化できない。 */
var Rules = (function () {

  /* =========================================================
     ルール定義
     ========================================================= */
  var DEFS = [
    // ---- 法令（ハード固定・無効化不可） ----
    { id: 'LAW-001', cat: 'law', name: '1日8時間・週40時間', type: 'hard', lock: true, params: { daily: 480, weekly: 2400 }, desc: '法定労働時間。36協定がない場合は超過不可。' },
    { id: 'LAW-005', cat: 'law', name: '36協定なしの時間外禁止', type: 'hard', lock: true, params: {}, desc: '36協定が未締結なら法定時間超の勤務を割り当てない。' },
    { id: 'LAW-006', cat: 'law', name: '時間外労働の上限（月45時間）', type: 'hard', lock: true, params: { monthlyOt: 2700 }, desc: '36協定があっても時間外労働は原則 月45時間・年360時間まで。' },
    { id: 'LAW-020', cat: 'law', name: '休憩時間', type: 'hard', lock: true, params: {}, desc: '6時間超は45分以上、8時間超は60分以上。勤務区分マスタを検証。' },
    { id: 'LAW-024', cat: 'law', name: '週1日以上の休日', type: 'hard', lock: true, params: { maxRun: 6 }, desc: '連続勤務は最大6日まで（週1日の休日を確保）。' },
    { id: 'LAW-040', cat: 'law', name: '18歳未満の深夜勤務禁止', type: 'hard', lock: true, params: {}, desc: '22:00〜5:00に及ぶ勤務を割り当てない。' },
    { id: 'LAW-041', cat: 'law', name: '18歳未満の時間外禁止', type: 'hard', lock: true, params: {}, desc: '1日8時間・週40時間を厳守（36協定があっても超過不可）。' },
    { id: 'LAW-060', cat: 'law', name: '有給・確定休の尊重', type: 'hard', lock: true, params: {}, desc: '有給申請日・絶対休の日は勤務にしない。' },

    // ---- 運用（設定変更可） ----
    { id: 'OPS-001', cat: 'ops', name: '必要人数の充足', type: 'hard', params: {}, desc: '各日・各勤務区分の必要人数を満たす。' },
    { id: 'OPS-003', cat: 'ops', name: '責任者の配置', type: 'hard', params: {}, desc: '責任者必須の勤務区分に責任者を1名以上。' },
    { id: 'OPS-004', cat: 'ops', name: '有資格者の配置', type: 'hard', params: {}, desc: '有資格者必須の勤務区分に有資格者を1名以上。' },
    { id: 'OPS-006', cat: 'ops', name: '新人だけの勤務にしない', type: 'hard', params: {}, desc: '新人には教育担当者を同じ勤務に同時配置する。' },
    { id: 'OPS-008', cat: 'ops', name: '担当可能な勤務区分', type: 'hard', params: {}, desc: '本人ができない勤務区分には入れない。' },
    { id: 'OPS-027', cat: 'ops', name: '勤務間インターバル', type: 'hard', weight: 0, params: { hours: 11 }, desc: '終業から次の始業まで一定時間を空ける。' },
    { id: 'OPS-030', cat: 'ops', name: '希望休の尊重', type: 'soft', weight: 8000, params: {}, desc: '「休み希望」の日は極力避ける（絶対休は別途ハード）。' },
    { id: 'OPS-031', cat: 'ops', name: '出勤希望の尊重', type: 'soft', weight: 3000, params: {}, desc: '「出たい」と申告した日を優先的に割り当てる。' },
    { id: 'OPS-032', cat: 'ops', name: '勤務不可の曜日', type: 'hard', params: {}, desc: '通学・ダブルワーク等で出勤できない曜日を除外。' },
    { id: 'OPS-033', cat: 'ops', name: '本人が提出した勤務可能時間', type: 'hard', params: {}, desc: 'スタッフが提出した「この日は何時から何時まで行けます」の範囲内にだけ割り当てる。' },
    { id: 'OPS-034', cat: 'ops', name: '最低出勤日数', type: 'soft', weight: 500, params: {}, desc: '契約上の最低日数に達するよう優先的に割り当てる。' },
    { id: 'OPS-035', cat: 'ops', name: '最大出勤日数・上限時間', type: 'hard', params: {}, desc: '本人ごとの上限日数・上限時間を超えない。' },
    { id: 'OPS-036', cat: 'ops', name: '最大連勤日数', type: 'hard', params: {}, desc: '本人ごとの連勤上限を超えない。' },
    { id: 'OPS-042', cat: 'ops', name: '年収の壁（扶養）', type: 'hard', weight: 1500, params: {}, desc: '年間上限額を超える割当を禁止し、使い切りペースを平準化する。' },
    { id: 'OPS-060', cat: 'ops', name: '夜勤明けの翌日は休み', type: 'hard', params: {}, desc: '日跨ぎ勤務の翌日は勤務を入れない。' },
    { id: 'OPS-064', cat: 'ops', name: '月間夜勤回数の上限', type: 'hard', params: {}, desc: '本人ごとの夜勤上限回数を超えない。' },
    { id: 'OPS-080', cat: 'ops', name: '夜勤の公平配分', type: 'soft', weight: 600, params: {}, desc: '夜勤回数が偏らないようにする。' },
    { id: 'OPS-081', cat: 'ops', name: '土日祝の公平配分', type: 'soft', weight: 400, params: {}, desc: '土日祝の出勤が偏らないようにする。' },
    { id: 'OPS-084', cat: 'ops', name: '勤務時間の均等化', type: 'soft', weight: 1200, params: {}, desc: '契約上限に対する消化率を揃える。' },
    { id: 'OPS-100', cat: 'ops', name: '相性NGの回避', type: 'hard', params: {}, desc: '同じ勤務に入れない組み合わせ。' },
    { id: 'OPS-101', cat: 'ops', name: '相性GOODの優先', type: 'soft', weight: 300, params: {}, desc: '一緒に組ませたい相手が同じ勤務にいれば加点。' },
    { id: 'OPS-110', cat: 'ops', name: '人件費予算', type: 'soft', weight: 400, params: {}, desc: '予算を設定した場合、単価の高い人の過剰投入を抑える。' },
    { id: 'OPS-A01', cat: 'ops', name: '個人ごとの優遇度', type: 'soft', weight: 500, params: {}, desc: '「多めに入れたい／控えめにしたい」を反映（最低日数は下回らない）。' },
    { id: 'OPS-A02', cat: 'ops', name: '連勤の抑制', type: 'soft', weight: 150, params: {}, desc: '連勤が長くなるほど避ける。' },
    { id: 'OPS-A03', cat: 'ops', name: '教育ペアの優先', type: 'soft', weight: 800, params: {}, desc: '新人と担当トレーナーを同じ勤務に寄せる。' },
    { id: 'OPS-A04', cat: 'ops', name: '責任者・有資格者の温存', type: 'soft', weight: 700, params: {}, desc: '責任者や有資格者を、その役割が不要な枠で使い切らないようにする。' },
    { id: 'OPS-A05', cat: 'ops', name: '月内のペース配分', type: 'soft', weight: 2500, params: {}, desc: '月の前半で出勤枠を使い切って後半が空になるのを防ぐ。' }
  ];

  var DEF_MAP = {};
  DEFS.forEach(function (d) { DEF_MAP[d.id] = d; });

  /** 実効設定（ユーザー設定を反映） */
  function cfg(data, id) {
    var d = DEF_MAP[id];
    if (!d) return { enabled: false };
    var o = data.ruleConfig && data.ruleConfig[id] ? data.ruleConfig[id] : {};
    return {
      id: id, name: d.name, cat: d.cat, lock: !!d.lock, desc: d.desc,
      enabled: o.enabled === undefined ? true : (d.lock ? true : !!o.enabled),
      type: d.lock ? d.type : (o.type || d.type),
      weight: o.weight === undefined ? (d.weight === undefined ? 1000 : d.weight) : +o.weight,
      params: Object.assign({}, d.params, o.params || {})
    };
  }
  function on(data, id) { return cfg(data, id).enabled; }

  /* =========================================================
     コンテキスト（割当状態の集計）
     ========================================================= */
  function dayIndex(dateStr) {
    var p = U.parseYmd(dateStr);
    return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
  }

  function buildContext(data, assignments) {
    var ctx = {
      data: data,
      assign: assignments || {},
      st: {},           // stId -> calc
      emp: {},          // empId -> employee
      shiftOf: {},      // empId -> { date: stId }（前月含む）
      stats: {}         // empId -> {days, minutes, nights, weekends, pay, dates:[]}
    };
    data.shiftTypes.forEach(function (s) { ctx.st[s.id] = Object.assign({}, s, Store.stCalc(s)); });
    data.employees.forEach(function (e) {
      ctx.emp[e.id] = e;
      ctx.shiftOf[e.id] = {};
      ctx.stats[e.id] = { days: 0, minutes: 0, nightMin: 0, nights: 0, weekends: 0, pay: 0, dates: [], week: {}, weekOt: {} };
    });
    // 前月分（月跨ぎの連勤・インターバル判定用）
    applyMap(ctx, data.prevMonth || {}, false);
    applyMap(ctx, ctx.assign, true);
    return ctx;
  }

  function applyMap(ctx, map, counting) {
    Object.keys(map).forEach(function (date) {
      Object.keys(map[date] || {}).forEach(function (stId) {
        (map[date][stId] || []).forEach(function (empId) {
          if (!ctx.emp[empId] || !ctx.st[stId]) return;
          ctx.shiftOf[empId][date] = stId;
          if (counting) addStat(ctx, empId, date, stId, 1);
        });
      });
    });
  }

  function weekKey(data, date) {
    var w = U.weekdayOf(date);
    var off = (w - (data.settings.weekStartsOn || 0) + 7) % 7;
    return U.addDays(date, -off);
  }

  function addStat(ctx, empId, date, stId, sign) {
    var s = ctx.stats[empId], c = ctx.st[stId], e = ctx.emp[empId];
    s.days += sign;
    s.minutes += sign * c.work;
    s.nightMin += sign * c.night;
    if (c.night > 0) s.nights += sign;
    if (Store.isWeekendOrHoliday(date)) s.weekends += sign;
    s.pay += sign * payOf(e, c);
    var wk = weekKey(ctx.data, date);
    s.week[wk] = (s.week[wk] || 0) + sign * c.work;
    s.weekOt[wk] = (s.weekOt[wk] || 0) + sign * Math.max(0, c.work - 480);   // 1日8時間超＝法定時間外
    if (sign > 0) { s.dates.push(date); s.dates.sort(); }
    else { var i = s.dates.indexOf(date); if (i >= 0) s.dates.splice(i, 1); }
  }

  /** 月の法定時間外労働（分）
   *  週ごとに「1日8時間超の分」＋「（週の労働−その分）が40時間を超えた分」 */
  function monthlyOt(ctx, empId, skipWeek, extraWeek, extraWeekOt) {
    var s = ctx.stats[empId], total = 0;
    Object.keys(s.week).forEach(function (wk) {
      if (wk === skipWeek) return;
      var wo = s.weekOt[wk] || 0;
      total += wo + Math.max(0, (s.week[wk] - wo) - 2400);
    });
    if (skipWeek) total += extraWeekOt + Math.max(0, (extraWeek - extraWeekOt) - 2400);
    return total;
  }

  /** 1回の勤務の賃金（深夜25%・8時間超25%の割増を加味した概算） */
  function payOf(emp, c) {
    var base = emp.wage * (c.work / 60);
    var nightAdd = emp.wage * 0.25 * (Math.min(c.night, c.work) / 60);
    var otMin = Math.max(0, c.work - 480);
    var otAdd = emp.wage * 0.25 * (otMin / 60);
    return base + nightAdd + otAdd;
  }

  function assignedAt(ctx, date, stId) {
    var a = ctx.assign[date];
    return (a && a[stId]) ? a[stId] : [];
  }

  function doAssign(ctx, date, stId, empId) {
    if (!ctx.assign[date]) ctx.assign[date] = {};
    if (!ctx.assign[date][stId]) ctx.assign[date][stId] = [];
    ctx.assign[date][stId].push(empId);
    ctx.shiftOf[empId][date] = stId;
    addStat(ctx, empId, date, stId, 1);
  }

  function undoAssign(ctx, date, stId, empId) {
    var arr = assignedAt(ctx, date, stId);
    var i = arr.indexOf(empId);
    if (i >= 0) arr.splice(i, 1);
    delete ctx.shiftOf[empId][date];
    addStat(ctx, empId, date, stId, -1);
  }

  /** 連続勤務日数（dateに入れた場合の連続長） */
  function runLength(ctx, empId, date) {
    var so = ctx.shiftOf[empId], n = 1, d;
    d = U.addDays(date, -1); while (so[d]) { n++; d = U.addDays(d, -1); }
    d = U.addDays(date, 1); while (so[d]) { n++; d = U.addDays(d, 1); }
    return n;
  }

  function absRange(date, c) {
    var base = dayIndex(date) * 1440;
    return { s: base + c.start, e: base + c.end };
  }

  /* =========================================================
     ハード判定：この人をこの枠に入れられるか
     ========================================================= */
  function hardCheck(ctx, empId, date, stId) {
    var data = ctx.data, e = ctx.emp[empId], c = ctx.st[stId];
    var slot = assignedAt(ctx, date, stId);
    var R = [];
    function ng(id, msg) { R.push({ ruleId: id, msg: msg }); }

    // 同日重複
    if (ctx.shiftOf[empId][date]) { ng('OPS-035', '同じ日に既に別の勤務が入っています'); return R; }
    if (slot.indexOf(empId) >= 0) { ng('OPS-035', '同じ枠に既にいます'); return R; }

    // 担当可能区分
    if (on(data, 'OPS-008') && (e.canShift || []).indexOf(stId) < 0)
      ng('OPS-008', c.name + 'を担当できない設定です');

    // 勤務不可曜日
    if (on(data, 'OPS-032') && (e.ngWeekdays || []).indexOf(U.weekdayOf(date)) >= 0)
      ng('OPS-032', U.WD[U.weekdayOf(date)] + '曜は勤務不可の設定です');

    // 本人が提出した勤務可能時間（スタッフ提出）
    if (on(data, 'OPS-033')) {
      var av = Store.availOf(empId, date);
      if (av === null) {
        if (data.settings.unsubmittedPolicy === 'unavailable')
          ng('OPS-033', 'この日の勤務可能時間が未提出です');
      } else if (av === false) {
        ng('OPS-033', '本人が「この日は不可」と提出しています');
      } else if (av !== 'any') {
        var af = U.hm2min(av.from), at = U.hm2min(av.to);
        if (at <= af) at += 1440;
        if (c.start < af || c.end > at)
          ng('OPS-033', '提出された勤務可能時間（' + av.from + '〜' + av.to + '）の外です');
      }
    }

    // 希望（絶対休・有給）
    var req = Store.requestOf(empId, date);
    if (req === 'must') ng('LAW-060', '絶対休（確定休）です');
    if (req === 'paid') ng('LAW-060', '有給休暇の申請日です');

    // 18歳未満
    if (e.minor) {
      if (c.night > 0) ng('LAW-040', '18歳未満は深夜(22:00-5:00)の勤務不可');
      if (c.work > 480) ng('LAW-041', '18歳未満は1日8時間を超えられません');
    }

    // 1日8時間
    if (c.work > 480 && (!data.settings.has36 || e.minor))
      ng('LAW-005', '36協定がないため8時間超の勤務は割り当てられません');

    // 週40時間 / 時間外の上限
    var wk = weekKey(data, date);
    var wmin = (ctx.stats[empId].week[wk] || 0) + c.work;
    var wot = (ctx.stats[empId].weekOt[wk] || 0) + Math.max(0, c.work - 480);
    var weeklyCap = cfg(data, 'LAW-001').params.weekly;
    if (!data.settings.has36 || e.minor) {
      if (wmin > weeklyCap)
        ng(e.minor ? 'LAW-041' : 'LAW-001', '週の法定労働時間(' + (weeklyCap / 60) + 'h)を超えます（この週 ' + U.min2h(wmin) + 'h）');
    } else {
      var otCap = cfg(data, 'LAW-006').params.monthlyOt || 2700;
      var otAfter = monthlyOt(ctx, empId, wk, wmin, wot);
      if (otAfter > otCap)
        ng('LAW-006', '時間外労働が月' + (otCap / 60) + '時間の上限を超えます（' + U.min2h(otAfter) + 'h）');
    }

    // 連勤（法定：週1休 → 最大6連勤）
    var run = runLength(ctx, empId, date);
    var lawRun = cfg(data, 'LAW-024').params.maxRun || 6;
    if (run > lawRun) ng('LAW-024', '連続勤務が' + run + '日になり週1日の休日を確保できません');

    // 連勤（本人設定）
    if (on(data, 'OPS-036') && e.maxConsecutive > 0 && run > e.maxConsecutive)
      ng('OPS-036', '連勤上限' + e.maxConsecutive + '日を超えます（' + run + '日）');

    // 上限日数・上限時間
    if (on(data, 'OPS-035')) {
      if (e.maxDays > 0 && ctx.stats[empId].days + 1 > e.maxDays)
        ng('OPS-035', '最大出勤日数' + e.maxDays + '日を超えます');
      if (e.maxHoursMonth > 0 && (ctx.stats[empId].minutes + c.work) > e.maxHoursMonth * 60)
        ng('OPS-035', '月間上限' + e.maxHoursMonth + '時間を超えます');
    }

    // 夜勤回数上限
    if (on(data, 'OPS-064') && c.night > 0 && e.maxNights > 0 && ctx.stats[empId].nights + 1 > e.maxNights)
      ng('OPS-064', '月間夜勤上限' + e.maxNights + '回を超えます');

    // 夜勤明けの翌日は休み
    if (on(data, 'OPS-060')) {
      var prevSt = ctx.shiftOf[empId][U.addDays(date, -1)];
      if (prevSt && ctx.st[prevSt] && ctx.st[prevSt].overnight)
        ng('OPS-060', '前日が夜勤（明け）のため休みにします');
      if (c.overnight) {
        var nextSt = ctx.shiftOf[empId][U.addDays(date, 1)];
        if (nextSt) ng('OPS-060', '翌日に勤務があるため夜勤に入れません');
      }
    }

    // 勤務間インターバル
    var ivCfg = cfg(data, 'OPS-027');
    if (ivCfg.enabled) {
      var need = (ivCfg.params.hours || 11) * 60;
      var me = absRange(date, c);
      [-1, 0, 1].forEach(function (o) {
        var d2 = U.addDays(date, o);
        var s2 = ctx.shiftOf[empId][d2];
        if (!s2 || (d2 === date)) return;
        var r2 = absRange(d2, ctx.st[s2]);
        var gap = (r2.s >= me.e) ? (r2.s - me.e) : (me.s - r2.e);
        if (gap < need)
          ng('OPS-027', '勤務間インターバル' + (need / 60) + '時間を確保できません（' + Math.max(0, Math.round(gap / 6) / 10) + 'h）');
      });
    }

    // 相性NG
    if (on(data, 'OPS-100')) {
      slot.forEach(function (o) {
        if ((e.ngPartners || []).indexOf(o) >= 0 || ((ctx.emp[o].ngPartners || []).indexOf(empId) >= 0))
          ng('OPS-100', ctx.emp[o].name + 'さんと同じ勤務にできません');
      });
    }

    // 新人は教育担当と同時勤務（枠に既にトレーナーがいること）
    if (on(data, 'OPS-006') && isNewbie(data, e)) {
      var hasTrainer = slot.some(function (o) { return isTrainerFor(ctx, o, empId); });
      if (!hasTrainer) ng('OPS-006', '新人のため、教育担当者が同じ勤務にいる必要があります');
    }

    // 年収の壁
    if (on(data, 'OPS-042') && e.incomeCap > 0) {
      var willBe = (e.ytdEarnings || 0) + ctx.stats[empId].pay + payOf(e, c);
      if (willBe > e.incomeCap)
        ng('OPS-042', '年収上限' + U.yen(e.incomeCap) + 'を超えます（見込 ' + U.yen(willBe) + '）');
    }

    return R;
  }

  function isNewbie(data, e) {
    if (!e.newbie) return false;
    return true;
  }
  function isTrainerFor(ctx, otherId, newbieId) {
    var o = ctx.emp[otherId];
    if (!o || o.newbie) return false;
    return !!(o.trainer || o.leader);
  }

  /* =========================================================
     ソフト評価：候補者のスコア（小さいほど良い）
     ========================================================= */
  function score(ctx, empId, date, stId) {
    var data = ctx.data, e = ctx.emp[empId], c = ctx.st[stId], s = ctx.stats[empId];
    var slot = assignedAt(ctx, date, stId);
    var total = 0, why = [];
    function add(v, id, label) { if (!v) return; total += v; why.push({ v: Math.round(v), id: id, label: label }); }

    // 希望休 / 出勤希望
    var req = Store.requestOf(empId, date);
    if (req === 'off') add(cfg(data, 'OPS-030').weight, 'OPS-030', '希望休の日');
    if (req === 'want') add(-cfg(data, 'OPS-031').weight, 'OPS-031', '出勤希望の日');

    // 個人の優遇度（-3〜+3）
    add(-(e.priority || 0) * cfg(data, 'OPS-A01').weight, 'OPS-A01',
      (e.priority > 0 ? '多めに入れたい設定' : e.priority < 0 ? '控えめにする設定' : ''));

    // 最低日数の未達を優先的に埋める
    var lack = Math.max(0, (e.minDays || 0) - s.days);
    add(-lack * cfg(data, 'OPS-034').weight, 'OPS-034', lack > 0 ? '最低日数まであと' + lack + '日' : '');

    // 勤務時間の均等化（上限に対する消化率）
    var capMin = (e.maxHoursMonth > 0 ? e.maxHoursMonth * 60 : (e.maxDays || 20) * 480) || 1;
    add((s.minutes / capMin) * cfg(data, 'OPS-084').weight, 'OPS-084', '消化率 ' + Math.round(s.minutes / capMin * 100) + '%');

    // 夜勤の公平（回数が増えるほど急に不利になるので偏りにくい）
    if (c.night > 0) {
      var co = (data.carryover[empId] || {}).nights || 0;
      var n = s.nights + co;
      add(n * (n + 1) / 2 * cfg(data, 'OPS-080').weight, 'OPS-080', '今月の夜勤 ' + s.nights + '回');
    }
    // 責任者・有資格者の温存（役割が要らない枠で使い切らない）
    var rr = (data.demand.roleReq || {})[stId] || {};
    var reserve = cfg(data, 'OPS-A04').weight;
    if (e.leader && !rr.leader) add(reserve, 'OPS-A04', '責任者は他の枠のために温存');
    if (e.certified && !rr.certified) add(reserve * 0.6, 'OPS-A04', '有資格者は他の枠のために温存');
    // 土日祝の公平
    if (Store.isWeekendOrHoliday(date)) {
      var cw = (data.carryover[empId] || {}).weekends || 0;
      add((s.weekends + cw) * cfg(data, 'OPS-081').weight, 'OPS-081', '今月の土日祝 ' + s.weekends + '回');
    }
    // 月内のペース配分（前半で枠を使い切って後半が空になるのを防ぐ）
    if (e.maxDays > 0) {
      var dim = U.daysInMonth(data.settings.year, data.settings.month);
      var progress = (+date.slice(8)) / dim;
      var usedRatio = s.days / e.maxDays;
      add(Math.max(0, usedRatio - progress) * cfg(data, 'OPS-A05').weight, 'OPS-A05',
        usedRatio > progress ? '月の進み具合より先に消化しすぎ' : '');
    }

    // 連勤の抑制
    var run = runLength(ctx, empId, date);
    add((run - 1) * cfg(data, 'OPS-A02').weight, 'OPS-A02', run > 1 ? run + '連勤目' : '');

    // 教育ペア
    var pairW = cfg(data, 'OPS-A03').weight;
    slot.forEach(function (o) {
      var ot = ctx.emp[o];
      if (e.newbie && (ot.trainer || ot.leader)) add(-(e.trainerId === o ? pairW : pairW * 0.4), 'OPS-A03', '教育担当の' + ot.name + 'さんと同勤務');
      if (ot.newbie && (e.trainer || e.leader)) add(-(ot.trainerId === empId ? pairW : pairW * 0.4), 'OPS-A03', '新人' + ot.name + 'さんの担当');
    });

    // 相性GOOD
    slot.forEach(function (o) {
      if ((e.goodPartners || []).indexOf(o) >= 0) add(-cfg(data, 'OPS-101').weight, 'OPS-101', ctx.emp[o].name + 'さんと相性◎');
    });

    // 人件費
    if (data.settings.budget > 0) {
      add(payOf(e, c) / 1000 * cfg(data, 'OPS-110').weight / 10, 'OPS-110', '人件費 ' + U.yen(payOf(e, c)));
    }

    // 年収の壁：使い切りペースの平準化
    if (e.incomeCap > 0) {
      var used = ((e.ytdEarnings || 0) + s.pay) / e.incomeCap;
      add(used * cfg(data, 'OPS-042').weight, 'OPS-042', '年収枠 ' + Math.round(used * 100) + '% 消化');
    }

    return { score: total, why: why };
  }

  /** 既に割り当て済みの1件を、いったん外してハード制約を全部かけ直す。
   *  日数・時間などの累積系は別途チェックするため、ここでは重複分を除く。 */
  var CUMULATIVE = { 'OPS-035': 1, 'OPS-064': 1, 'OPS-042': 1, 'LAW-006': 1, 'LAW-001': 1, 'LAW-041': 1 };
  function recheck(ctx, date, stId, empId) {
    var arr = ctx.assign[date][stId];
    var idx = arr.indexOf(empId);
    if (idx < 0) return [];
    undoAssign(ctx, date, stId, empId);
    var ng = hardCheck(ctx, empId, date, stId);
    doAssign(ctx, date, stId, empId);
    var a2 = ctx.assign[date][stId];                 // 並び順を元に戻す
    a2.splice(a2.indexOf(empId), 1);
    a2.splice(idx, 0, empId);
    return ng.filter(function (v) { return !CUMULATIVE[v.ruleId]; });
  }

  /* =========================================================
     検証：出来上がったシフト全体をチェック
     ========================================================= */
  function validate(ctx) {
    var data = ctx.data, out = [];
    function push(level, ruleId, msg, date, stId, empId) {
      out.push({ level: level, ruleId: ruleId, msg: msg, date: date || '', stId: stId || '', empId: empId || '' });
    }

    // 勤務区分マスタ：休憩
    data.shiftTypes.forEach(function (st) {
      var c = ctx.st[st.id];
      if (c.work > 480 && st.breakMin < 60) push('hard', 'LAW-020', st.name + '：8時間超なので休憩60分以上が必要（現在' + st.breakMin + '分）');
      else if (c.work > 360 && st.breakMin < 45) push('hard', 'LAW-020', st.name + '：6時間超なので休憩45分以上が必要（現在' + st.breakMin + '分）');
    });

    var dates = Store.monthDates();
    dates.forEach(function (date) {
      data.shiftTypes.forEach(function (st) {
        var need = Store.needOf(date, st.id);
        var list = assignedAt(ctx, date, st.id);
        if (list.length < need)
          push('hard', 'OPS-001', date + ' ' + st.name + '：' + need + '人必要なところ' + list.length + '人（' + (need - list.length) + '人不足）', date, st.id);

        var rr = (data.demand.roleReq || {})[st.id] || {};
        if (need > 0 && rr.leader && !list.some(function (id) { return ctx.emp[id] && ctx.emp[id].leader; }))
          push('hard', 'OPS-003', date + ' ' + st.name + '：責任者がいません', date, st.id);
        if (need > 0 && rr.certified && !list.some(function (id) { return ctx.emp[id] && ctx.emp[id].certified; }))
          push('hard', 'OPS-004', date + ' ' + st.name + '：有資格者がいません', date, st.id);

        list.slice().forEach(function (id) {
          var e = ctx.emp[id];
          if (!e) {
            push('hard', 'OPS-001', date + ' ' + st.name + '：存在しない従業員が割り当てられています(' + id + ')', date, st.id);
            return;
          }
          var req = Store.requestOf(id, date);
          if (req === 'off') push('soft', 'OPS-030', date + '：' + e.name + 'さんの希望休に出勤が入っています', date, st.id, id);

          // 既存の割当を1件ずつ外してハード制約を全部かけ直す
          // （手動編集・JSON読み込み・古い保存データで違反が紛れ込むのを防ぐ）
          recheck(ctx, date, st.id, id).forEach(function (v) {
            push('hard', v.ruleId, date + ' ' + st.name + '：' + e.name + 'さん — ' + v.msg, date, st.id, id);
          });
        });
      });
    });

    // 個人別
    data.employees.forEach(function (e) {
      var s = ctx.stats[e.id];
      if (e.minDays > 0 && s.days < e.minDays)
        push('soft', 'OPS-034', e.name + 'さん：最低' + e.minDays + '日に対し' + s.days + '日（' + (e.minDays - s.days) + '日不足）', '', '', e.id);
      if (e.maxDays > 0 && s.days > e.maxDays)
        push('hard', 'OPS-035', e.name + 'さん：最大' + e.maxDays + '日を超えて' + s.days + '日', '', '', e.id);
      if (e.incomeCap > 0) {
        var tot = (e.ytdEarnings || 0) + s.pay;
        if (tot > e.incomeCap) push('hard', 'OPS-042', e.name + 'さん：年収上限' + U.yen(e.incomeCap) + 'を超過（' + U.yen(tot) + '）', '', '', e.id);
        else if (tot > e.incomeCap * 0.9) push('soft', 'OPS-042', e.name + 'さん：年収上限の90%到達（' + U.yen(tot) + ' / ' + U.yen(e.incomeCap) + '）', '', '', e.id);
      }
      // 週40時間 / 時間外の上限
      if (!data.settings.has36 || e.minor) {
        Object.keys(s.week).forEach(function (wk) {
          if (s.week[wk] > 2400)
            push('hard', e.minor ? 'LAW-041' : 'LAW-001', e.name + 'さん：' + wk + 'の週が' + U.min2h(s.week[wk]) + '時間（36協定なしで40時間超）', '', '', e.id);
        });
      } else {
        var ot = monthlyOt(ctx, e.id);
        var otCap = cfg(data, 'LAW-006').params.monthlyOt || 2700;
        if (ot > otCap) push('hard', 'LAW-006', e.name + 'さん：時間外労働が月' + U.min2h(ot) + '時間（上限' + (otCap / 60) + '時間）', '', '', e.id);
        else if (ot > otCap * 0.8) push('soft', 'LAW-006', e.name + 'さん：時間外が月' + U.min2h(ot) + '時間（上限の8割超）', '', '', e.id);
      }
      // 連勤
      var run = 0, maxRun = 0;
      var all = Store.monthDates();
      var scan = [U.addDays(all[0], -7)].concat([]);
      var d = U.addDays(all[0], -10);
      for (var i = 0; i < all.length + 10; i++) {
        if (ctx.shiftOf[e.id][d]) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
        d = U.addDays(d, 1);
      }
      if (maxRun > 6) push('hard', 'LAW-024', e.name + 'さん：最大' + maxRun + '連勤（週1日の休日を確保できていません）', '', '', e.id);
      else if (e.maxConsecutive > 0 && maxRun > e.maxConsecutive)
        push('hard', 'OPS-036', e.name + 'さん：連勤上限' + e.maxConsecutive + '日に対し' + maxRun + '連勤', '', '', e.id);
    });

    // 予算
    if (data.settings.budget > 0) {
      var total = data.employees.reduce(function (a, e) { return a + ctx.stats[e.id].pay; }, 0);
      if (total > data.settings.budget)
        push('soft', 'OPS-110', '人件費が予算を超過（' + U.yen(total) + ' / 予算 ' + U.yen(data.settings.budget) + '）');
    }

    return out;
  }

  return {
    DEFS: DEFS, DEF_MAP: DEF_MAP, cfg: cfg, on: on,
    buildContext: buildContext, hardCheck: hardCheck, score: score, validate: validate,
    doAssign: doAssign, undoAssign: undoAssign, assignedAt: assignedAt,
    payOf: payOf, runLength: runLength, weekKey: weekKey, isTrainerFor: isTrainerFor,
    monthlyOt: monthlyOt
  };
})();
if (typeof module !== 'undefined') module.exports = Rules;
