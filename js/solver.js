/* solver.js — シフト自動生成エンジン（AI不使用・決定的アルゴリズム）
   手順は rules/04-constraint-model.md の「3. 解き方」に対応。
     Step1 制約の強い枠から順に（Most Constrained First）
     Step2 ハード制約を満たす候補だけを残す
     Step3 ソフト制約のスコアが最良の人を選ぶ
     Step4 埋まらない枠は入れ替え（swap）で修復
     Step5 全体検証
   同じ入力なら必ず同じ結果になる（乱数を使わない）。 */
var Solver = (function () {

  function generate(data) {
    var t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
    // 対象月ぶんだけ作り直し、他の月の割当はそのまま残す
    // （残した分は連勤・夜勤明け・インターバルの判定と、公平性の繰り越しに使われる）
    var prefix = data.settings.year + '-' + U.pad(data.settings.month);
    var seed = {};
    Object.keys(data.assignments || {}).forEach(function (date) {
      if (String(date).indexOf(prefix) !== 0) seed[date] = U.clone(data.assignments[date]);
    });
    var ctx = Rules.buildContext(data, seed);
    var trace = {};                                   // trace[date][stId][empId] = 説明
    var log = [];

    // ---- 枠（スロット）の一覧 ----
    var slots = [];
    Store.monthDates().forEach(function (date) {
      data.shiftTypes.forEach(function (st) {
        var need = Store.needOf(date, st.id);
        if (need > 0) slots.push({ date: date, stId: st.id, need: need });
      });
    });

    // ---- Step1〜3：制約の強い枠から順に1席ずつ埋める ----
    var guard = 0;
    while (guard++ < 20000) {
      var target = null, targetCands = null, best = Infinity;

      // まず「入れそうな人の数」をざっと数えて、最も苦しい枠を選ぶ（高速な概算）
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        var cur = Rules.assignedAt(ctx, s.date, s.stId);
        if (cur.length >= s.need) continue;
        var rr = (data.demand.roleReq || {})[s.stId] || {};
        var rolePenalty = (rr.leader || rr.certified) ? 0 : 0.5;
        // ①まず全枠に1人目を配る（人手不足でも「誰もいない日」を作らない）
        // ②同じ充足率なら、候補が少ない苦しい枠を先に埋める
        var key = (cur.length / s.need) * 10000 + quickCount(ctx, s) + rolePenalty;
        if (key < best) { best = key; target = s; }
      }
      if (!target) break;                        // すべて充足

      targetCands = candidatesFor(ctx, target);  // 選ばれた枠だけ厳密に判定

      if (!targetCands.length) {                 // この枠はもう誰も入れられない
        target.stuck = true;
        var repaired = tryRepair(ctx, target, trace);
        if (!repaired) { slots.splice(slots.indexOf(target), 1); continue; }
        else continue;
      }

      var pick = targetCands[0];
      if (targetCands.roleFallback) {
        var names = { leader: '責任者', certified: '有資格者' };
        log.push(target.date + ' ' + Store.stById(target.stId).name + '：'
          + targetCands.roleFallback.map(function (r) { return names[r]; }).join('と')
          + 'を確保できないため、人数だけ ' + ctx.emp[pick.empId].name + 'さんで充足しました');
      }
      Rules.doAssign(ctx, target.date, target.stId, pick.empId);
      putTrace(trace, target.date, target.stId, pick.empId, {
        score: Math.round(pick.score), why: pick.why,
        alternatives: targetCands.slice(1, 4).map(function (c) {
          return { empId: c.empId, name: ctx.emp[c.empId].name, score: Math.round(c.score) };
        }),
        blocked: pick.blocked
      });
    }

    // ---- Step4：不足枠の修復（入れ替え探索） ----
    slots.forEach(function (s) {
      var cur = Rules.assignedAt(ctx, s.date, s.stId);
      var tries = 0;
      while (cur.length < s.need && tries++ < 3) {
        if (!tryRepair(ctx, s, trace)) break;
        cur = Rules.assignedAt(ctx, s.date, s.stId);
      }
    });

    // ---- Step4b：最低出勤日数が未達の人を、空きのある枠に追加 ----
    fillMinDays(ctx, trace, log);

    // ---- Step4c：念のため、教育担当が付いていない新人を外す ----
    Store.monthDates().forEach(function (date) {
      data.shiftTypes.forEach(function (st) {
        Rules.assignedAt(ctx, date, st.id).slice().forEach(function (id) {
          if (!ctx.emp[id] || !ctx.emp[id].newbie) return;
          if (!slotOk(ctx, date, st.id)) {
            Rules.undoAssign(ctx, date, st.id, id);
            log.push(date + ' ' + st.name + '：教育担当を確保できないため ' + ctx.emp[id].name + 'さんを外しました');
          }
        });
      });
    });

    // ---- Step5：検証 ----
    var violations = Rules.validate(ctx);

    var stats = {};
    data.employees.forEach(function (e) {
      var s = ctx.stats[e.id];
      stats[e.id] = {
        days: s.days, minutes: s.minutes, hours: +(s.minutes / 60).toFixed(1),
        nights: s.nights, weekends: s.weekends, pay: Math.round(s.pay),
        nightHours: +(s.nightMin / 60).toFixed(1),
        otHours: +(Rules.monthlyOt(ctx, e.id) / 60).toFixed(1)
      };
    });

    var unfilled = [];
    Store.monthDates().forEach(function (date) {
      data.shiftTypes.forEach(function (st) {
        var need = Store.needOf(date, st.id);
        var got = Rules.assignedAt(ctx, date, st.id).length;
        if (got < need) unfilled.push({ date: date, stId: st.id, need: need, got: got });
      });
    });

    return {
      assignments: ctx.assign, trace: trace, violations: violations, stats: stats,
      unfilled: unfilled, log: log,
      totalPay: Math.round(data.employees.reduce(function (a, e) { return a + ctx.stats[e.id].pay; }, 0)),
      ms: Math.round(((typeof performance !== 'undefined' ? performance.now() : 0) - t0))
    };
  }

  /* 枠の「苦しさ」の概算：軽い条件だけで候補数を数える（全ハード判定より約20倍速い） */
  function quickCount(ctx, slot) {
    var data = ctx.data, n = 0;
    for (var i = 0; i < data.employees.length; i++) {
      var e = data.employees[i];
      if (ctx.shiftOf[e.id][slot.date]) continue;                      // その日は既に勤務
      if ((e.canShift || []).indexOf(slot.stId) < 0) continue;
      if ((e.ngWeekdays || []).indexOf(U.weekdayOf(slot.date)) >= 0) continue;
      var req = Store.requestOf(e.id, slot.date);
      if (req === 'must' || req === 'paid') continue;
      if (e.minor && ctx.st[slot.stId].night > 0) continue;
      var av = Store.availOf(e.id, slot.date);
      if (av === false) continue;
      if (av === null && data.settings.unsubmittedPolicy === 'unavailable') continue;
      n++;
    }
    return n;
  }

  /* 枠に入れられる候補（スコア昇順） */
  function candidatesFor(ctx, slot) {
    var data = ctx.data;
    var cur = Rules.assignedAt(ctx, slot.date, slot.stId);
    var seatsLeft = slot.need - cur.length;

    // 役割の残り必要数（責任者・有資格者）
    var rr = (data.demand.roleReq || {})[slot.stId] || {};
    var missing = [];
    if (rr.leader && !cur.some(function (id) { return ctx.emp[id].leader; })) missing.push('leader');
    if (rr.certified && !cur.some(function (id) { return ctx.emp[id].certified; })) missing.push('certified');
    var mustCoverRole = missing.length >= seatsLeft && missing.length > 0;

    var out = [], spare = [], blocked = [];
    data.employees.forEach(function (e) {
      var ng = Rules.hardCheck(ctx, e.id, slot.date, slot.stId);
      if (ng.length) {
        if (blocked.length < 8) blocked.push({ empId: e.id, name: e.name, reason: ng[0].msg, ruleId: ng[0].ruleId });
        return;
      }
      var sc = Rules.score(ctx, e.id, slot.date, slot.stId);
      var covers = missing.filter(function (r) { return e[r]; }).length;
      var item = { empId: e.id, score: sc.score, why: sc.why, blocked: blocked, covers: covers };
      // 残り1席で必須役割が2つなら、両方を満たす人しか置けない
      if (mustCoverRole && covers < Math.min(missing.length, seatsLeft ? missing.length - (seatsLeft - 1) : 1)) spare.push(item);
      else out.push(item);
    });
    // 役割を満たす人が誰もいない場合でも、人数だけは埋める
    // （空席にすると「人がいない」と「役割がいない」の二重の穴になるため。
    //   役割不足は OPS-003/004 の違反として必ず報告され、log にも残す）
    if (!out.length && spare.length) {
      out = spare;
      out.roleFallback = missing.slice();
    }

    out.sort(function (a, b) {
      // 席が足りないときは、必須役割を多く満たす人を優先
      if (mustCoverRole && a.covers !== b.covers) return b.covers - a.covers;
      if (a.score !== b.score) return a.score - b.score;
      return a.empId < b.empId ? -1 : 1;            // 同点は ID 順（決定的にする）
    });
    out.forEach(function (o) { o.blocked = blocked; });
    return out;
  }

  /* 入れ替えによる修復：同じ日に別の勤務に入っている人を移して、そこを別の人で埋める */
  function tryRepair(ctx, slot, trace) {
    var data = ctx.data;
    var cur = Rules.assignedAt(ctx, slot.date, slot.stId);
    if (cur.length >= slot.need) return false;

    for (var i = 0; i < data.employees.length; i++) {
      var e = data.employees[i];
      var otherSt = ctx.shiftOf[e.id][slot.date];
      if (!otherSt || otherSt === slot.stId) continue;

      // いったん外して、目的の枠に入れられるか確認
      Rules.undoAssign(ctx, slot.date, otherSt, e.id);
      var ok = Rules.hardCheck(ctx, e.id, slot.date, slot.stId).length === 0;
      if (ok) {
        // 空いた枠を別の人で埋められるか
        var backup = null;
        for (var j = 0; j < data.employees.length; j++) {
          var r = data.employees[j];
          if (r.id === e.id) continue;
          if (Rules.hardCheck(ctx, r.id, slot.date, otherSt).length === 0) { backup = r; break; }
        }
        if (backup) {
          Rules.doAssign(ctx, slot.date, slot.stId, e.id);
          Rules.doAssign(ctx, slot.date, otherSt, backup.id);
          if (slotOk(ctx, slot.date, otherSt) && slotOk(ctx, slot.date, slot.stId)) {
            putTrace(trace, slot.date, slot.stId, e.id, { score: null, why: [{ v: 0, id: 'repair', label: '不足枠を埋めるため' + Store.stById(otherSt).name + 'から移動' }], alternatives: [], blocked: [] });
            putTrace(trace, slot.date, otherSt, backup.id, { score: null, why: [{ v: 0, id: 'repair', label: '移動した人の代わりに補充' }], alternatives: [], blocked: [] });
            return true;
          }
          Rules.undoAssign(ctx, slot.date, otherSt, backup.id);
          Rules.undoAssign(ctx, slot.date, slot.stId, e.id);
        }
      }
      Rules.doAssign(ctx, slot.date, otherSt, e.id);   // 元に戻す
    }
    return false;
  }

  /** 入れ替え後もその枠が成立しているか（役割＋新人のペア） */
  function slotOk(ctx, date, stId) {
    var list = Rules.assignedAt(ctx, date, stId);
    // 新人が教育担当なしで残っていないか（入れ替えでトレーナーが抜けるのを防ぐ）
    var orphan = list.some(function (id) {
      if (!ctx.emp[id].newbie) return false;
      return !list.some(function (o) { return o !== id && Rules.isTrainerFor(ctx, o, id); });
    });
    if (orphan) return false;

    var rr = (ctx.data.demand.roleReq || {})[stId] || {};
    if (Store.needOf(date, stId) <= 0) return true;
    if (rr.leader && !list.some(function (id) { return ctx.emp[id].leader; })) return false;
    if (rr.certified && !list.some(function (id) { return ctx.emp[id].certified; })) return false;
    return true;
  }

  /* 最低出勤日数に届いていない人を、上限人数に余裕がある枠へ追加する */
  function fillMinDays(ctx, trace, log) {
    var data = ctx.data;
    var lacking = data.employees.filter(function (e) {
      return e.minDays > 0 && ctx.stats[e.id].days < e.minDays;
    });
    if (!lacking.length) return;

    lacking.sort(function (a, b) {
      var la = a.minDays - ctx.stats[a.id].days, lb = b.minDays - ctx.stats[b.id].days;
      if (la !== lb) return lb - la;
      return a.id < b.id ? -1 : 1;
    });

    lacking.forEach(function (e) {
      var guard = 0;
      while (ctx.stats[e.id].days < e.minDays && guard++ < 40) {
        var bestSlot = null, bestScore = Infinity;
        Store.monthDates().forEach(function (date) {
          data.shiftTypes.forEach(function (st) {
            var need = Store.needOf(date, st.id);
            if (need <= 0) return;
            var max = maxOf(data, date, st.id, need);
            var cur = Rules.assignedAt(ctx, date, st.id);
            if (cur.length >= max) return;                       // 上限人数に達している
            if (Rules.hardCheck(ctx, e.id, date, st.id).length) return;
            var sc = Rules.score(ctx, e.id, date, st.id).score;
            if (sc < bestScore) { bestScore = sc; bestSlot = { date: date, stId: st.id }; }
          });
        });
        if (!bestSlot) {
          log.push(e.name + 'さん：最低日数' + e.minDays + '日に対し' + ctx.stats[e.id].days + '日。これ以上入れられる枠がありません');
          break;
        }
        Rules.doAssign(ctx, bestSlot.date, bestSlot.stId, e.id);
        putTrace(trace, bestSlot.date, bestSlot.stId, e.id, {
          score: Math.round(bestScore),
          why: [{ v: 0, id: 'OPS-034', label: '最低出勤日数(' + e.minDays + '日)を満たすため追加' }],
          alternatives: [], blocked: []
        });
      }
    });
  }

  /** その枠の上限人数（既定は必要人数ちょうど＝過剰配置を作らない） */
  function maxOf(data, date, stId, need) {
    var ov = (data.demand.overrides[date] || {});
    if (ov['max_' + stId] !== undefined && ov['max_' + stId] !== '') return +ov['max_' + stId];
    var m = (data.demand.byWeekdayMax || {})[stId];
    if (m && m[U.weekdayOf(date)] !== undefined && m[U.weekdayOf(date)] !== '') return +m[U.weekdayOf(date)];
    return need + (data.settings.allowOverstaff ? 1 : 0);
  }

  function putTrace(trace, date, stId, empId, obj) {
    if (!trace[date]) trace[date] = {};
    if (!trace[date][stId]) trace[date][stId] = {};
    // 保存容量を抑えるため、説明に使う分だけ残す（blocked は枠内で共有された配列なので複製を切る）
    obj.why = (obj.why || []).filter(function (w) { return w.label; }).slice(0, 6);
    obj.blocked = (obj.blocked || []).slice(0, 4).map(function (b) {
      return { name: b.name, reason: b.reason, ruleId: b.ruleId };
    });
    trace[date][stId][empId] = obj;
  }

  /* 手動編集の可否チェック（UIから使う） */
  function checkManual(data, assignments, empId, date, stId) {
    var ctx = Rules.buildContext(data, U.clone(assignments));
    return Rules.hardCheck(ctx, empId, date, stId);
  }

  /* 割当済みシフトの再検証（手動編集後） */
  function revalidate(data, assignments) {
    var ctx = Rules.buildContext(data, U.clone(assignments));
    var stats = {};
    data.employees.forEach(function (e) {
      var s = ctx.stats[e.id];
      stats[e.id] = {
        days: s.days, minutes: s.minutes, hours: +(s.minutes / 60).toFixed(1),
        nights: s.nights, weekends: s.weekends, pay: Math.round(s.pay),
        nightHours: +(s.nightMin / 60).toFixed(1),
        otHours: +(Rules.monthlyOt(ctx, e.id) / 60).toFixed(1)
      };
    });
    return {
      violations: Rules.validate(ctx), stats: stats,
      totalPay: Math.round(data.employees.reduce(function (a, e) { return a + ctx.stats[e.id].pay; }, 0))
    };
  }

  return { generate: generate, checkManual: checkManual, revalidate: revalidate, candidatesFor: candidatesFor };
})();
if (typeof module !== 'undefined') module.exports = Solver;
