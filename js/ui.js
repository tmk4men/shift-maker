/* ui.js — 画面。データは Store、判定は Rules、生成は Solver に任せる */
(function () {
  var D = Store.load();
  var el = U.el;
  var currentTab = 'setup';
  var staffView = '';     // スタッフ提出モードで選択中の従業員ID

  /* ================= 共通 ================= */
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }
  function saveAndRender() { Store.save(); render(); }

  function modal(title, bodyNode, footNodes) {
    document.getElementById('modalTitle').textContent = title;
    var body = document.getElementById('modalBody'); body.innerHTML = '';
    body.appendChild(bodyNode);
    var foot = document.getElementById('modalFoot'); foot.innerHTML = '';
    (footNodes || []).forEach(function (n) { foot.appendChild(n); });
    document.getElementById('modal').classList.remove('hidden');
  }
  function closeModal() { document.getElementById('modal').classList.add('hidden'); }

  function field(label, input) { return el('div', { class: 'field' }, [el('label', { text: label }), input]); }
  function input(type, value, oninput, attrs) {
    var a = Object.assign({ type: type, value: value === undefined ? '' : value, oninput: oninput }, attrs || {});
    return el('input', a);
  }
  function checkbox(label, checked, onchange) {
    var c = el('input', { type: 'checkbox', onchange: onchange });
    c.checked = !!checked;
    return el('label', { class: 'switch' }, [c, label]);
  }
  function select(options, value, onchange) {
    var s = el('select', { onchange: onchange });
    options.forEach(function (o) {
      var op = el('option', { value: o.v, text: o.t });
      if (String(o.v) === String(value)) op.selected = true;
      s.appendChild(op);
    });
    return s;
  }
  function card(title, hint, children) {
    return el('div', { class: 'card' }, [el('h2', { text: title }), hint ? el('p', { class: 'hint', text: hint }) : null].concat(children));
  }

  /* ================= ① 基本設定 ================= */
  function renderSetup() {
    var p = document.getElementById('panel-setup'); p.innerHTML = '';
    var s = D.settings;

    p.appendChild(card('店舗・対象月', 'まずはここだけ設定すれば動きます。', [
      el('div', { class: 'row' }, [
        field('店舗名', input('text', s.storeName, function (e) { s.storeName = e.target.value; Store.save(); })),
        field('年', input('number', s.year, function (e) { s.year = +e.target.value; saveAndRender(); }, { min: 2000, max: 2100 })),
        field('月', select([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return { v: m, t: m + '月' }; }), s.month,
          function (e) { s.month = +e.target.value; saveAndRender(); })),
        field('人件費予算（0=無制限）', input('number', s.budget, function (e) { s.budget = +e.target.value; Store.save(); }, { step: 10000 })),
        field('週の起算日', select([{ v: 0, t: '日曜' }, { v: 1, t: '月曜' }], s.weekStartsOn, function (e) { s.weekStartsOn = +e.target.value; Store.save(); })),
        field('36協定', select([{ v: 'y', t: 'あり（残業可）' }, { v: 'n', t: 'なし（残業不可）' }], s.has36 ? 'y' : 'n',
          function (e) { s.has36 = e.target.value === 'y'; Store.save(); })),
        field('未提出日の扱い', select([{ v: 'available', t: '出勤できる扱い' }, { v: 'unavailable', t: '出勤不可の扱い' }], s.unsubmittedPolicy,
          function (e) { s.unsubmittedPolicy = e.target.value; Store.save(); }))
      ]),
      el('div', { class: 'row', style: 'margin-top:10px' }, [
        field('祝日（カンマ区切り 例 2026-08-11）', input('text', (s.holidays || []).join(','), function (e) {
          s.holidays = e.target.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean); Store.save();
        }, { style: 'width:320px' })),
        el('div', { class: 'field' }, [el('label', { text: '人数の上振れ' }),
        checkbox('最低出勤日数を満たすため必要人数＋1まで許容', s.allowOverstaff, function (e) { s.allowOverstaff = e.target.checked; Store.save(); })])
      ])
    ]));

    /* 勤務区分 */
    var stRows = D.shiftTypes.map(function (st, i) {
      var c = Store.stCalc(st);
      var warn = '';
      if (c.work > 480 && st.breakMin < 60) warn = '休憩60分以上が必要';
      else if (c.work > 360 && st.breakMin < 45) warn = '休憩45分以上が必要';
      return el('tr', {}, [
        el('td', {}, [input('text', st.name, function (e) { st.name = e.target.value; Store.save(); }, { style: 'width:80px' })]),
        el('td', {}, [input('text', st.short, function (e) { st.short = e.target.value; Store.save(); }, { style: 'width:44px' })]),
        el('td', {}, [input('time', st.start, function (e) { st.start = e.target.value; saveAndRender(); })]),
        el('td', {}, [input('time', st.end, function (e) { st.end = e.target.value; saveAndRender(); })]),
        el('td', {}, [input('number', st.breakMin, function (e) { st.breakMin = +e.target.value; saveAndRender(); }, { style: 'width:70px', step: 5 })]),
        el('td', {}, [input('color', st.color, function (e) { st.color = e.target.value; Store.save(); }, { style: 'width:44px;padding:0' })]),
        el('td', { class: 'nowrap', text: U.min2h(c.work) + 'h' }),
        el('td', { class: 'nowrap', text: c.night > 0 ? U.min2h(c.night) + 'h' : '—' }),
        el('td', {}, [warn ? el('span', { class: 'badge ng', text: warn }) : el('span', { class: 'badge ok', text: 'OK' })]),
        el('td', {}, [el('button', {
          class: 'btn ghost sm danger', text: '削除', onclick: function () {
            if (D.shiftTypes.length <= 1) return toast('最低1つは必要です');
            if (!confirm(st.name + ' を削除しますか？')) return;
            D.shiftTypes.splice(i, 1); delete D.demand.byWeekday[st.id]; saveAndRender();
          }
        })])
      ]);
    });

    p.appendChild(card('勤務区分', '早番・遅番・夜勤など。終了が開始より前なら日跨ぎ（夜勤）として自動計算します。', [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, ['名称', '略', '開始', '終了', '休憩(分)', '色', '実働', '深夜', '休憩チェック', ''].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, stRows)
      ]),
      el('div', { style: 'margin-top:10px' }, [el('button', {
        class: 'btn sm', text: '＋ 勤務区分を追加', onclick: function () {
          var id = 'S' + (D.shiftTypes.length + 1) + Math.floor(Math.random() * 90 + 10);
          D.shiftTypes.push({ id: id, name: '新しい勤務', short: '新', start: '09:00', end: '18:00', breakMin: 60, color: '#b0bec5' });
          D.demand.byWeekday[id] = [0, 0, 0, 0, 0, 0, 0];
          D.demand.roleReq[id] = { leader: false, certified: false };
          D.employees.forEach(function (e) { e.canShift.push(id); });
          saveAndRender();
        }
      })])
    ]));

    /* 必要人数 */
    var head = el('tr', {}, [el('th', { text: '勤務区分' })].concat(U.WD.map(function (w, i) {
      return el('th', { class: i === 0 ? 'sun' : i === 6 ? 'sat' : '', text: w });
    })).concat([el('th', { text: '責任者必須' }), el('th', { text: '有資格者必須' })]));

    var rows = D.shiftTypes.map(function (st) {
      var arr = D.demand.byWeekday[st.id] || (D.demand.byWeekday[st.id] = [0, 0, 0, 0, 0, 0, 0]);
      var rr = D.demand.roleReq[st.id] || (D.demand.roleReq[st.id] = {});
      return el('tr', {}, [el('td', { text: st.name })].concat(arr.map(function (v, i) {
        return el('td', {}, [input('number', v, function (e) { arr[i] = +e.target.value; Store.save(); }, { style: 'width:56px', min: 0 })]);
      })).concat([
        el('td', {}, [checkbox('', rr.leader, function (e) { rr.leader = e.target.checked; Store.save(); })]),
        el('td', {}, [checkbox('', rr.certified, function (e) { rr.certified = e.target.checked; Store.save(); })])
      ]));
    });

    p.appendChild(card('必要人数（曜日別）', '各曜日・各勤務区分に何人必要か。特定日だけ変えたい場合は下の「特定日の調整」で。', [
      el('table', {}, [el('thead', {}, [head]), el('tbody', {}, rows)])
    ]));

    /* 特定日の調整 */
    var det = el('details', { class: 'rule' }, [el('summary', { text: '特定日の調整（イベント・繁忙日）' })]);
    var ovTable = el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', { text: '日付' })].concat(D.shiftTypes.map(function (st) { return el('th', { text: st.name }); })))]),
      el('tbody', {}, Store.monthDates().map(function (date) {
        var w = U.weekdayOf(date);
        return el('tr', {}, [el('td', { class: w === 0 ? 'sun' : w === 6 ? 'sat' : '', text: date.slice(5) + '(' + U.WD[w] + ')' })]
          .concat(D.shiftTypes.map(function (st) {
            var ov = D.demand.overrides[date] || {};
            return el('td', {}, [input('number', ov[st.id] === undefined ? '' : ov[st.id], function (e) {
              if (!D.demand.overrides[date]) D.demand.overrides[date] = {};
              if (e.target.value === '') delete D.demand.overrides[date][st.id];
              else D.demand.overrides[date][st.id] = +e.target.value;
              Store.save();
            }, { style: 'width:56px', min: 0, placeholder: Store.needOf(date, st.id) })]);
          })));
      }))
    ]);
    det.appendChild(el('div', { class: 'scroll', style: 'max-height:340px;margin-top:8px' }, [ovTable]));
    p.appendChild(card('特定日の調整', '空欄なら曜日別の設定が使われます。', [det]));
  }

  /* ================= ② 従業員 ================= */
  function renderStaff() {
    var p = document.getElementById('panel-staff'); p.innerHTML = '';

    var rows = D.employees.map(function (e) {
      var chips = [];
      if (e.leader) chips.push(el('span', { class: 'chip leader', text: '責任者' }));
      if (e.certified) chips.push(el('span', { class: 'chip cert', text: '有資格' }));
      if (e.trainer) chips.push(el('span', { class: 'chip trainer', text: '教育担当' }));
      if (e.newbie) chips.push(el('span', { class: 'chip newbie', text: '新人' }));
      if (e.minor) chips.push(el('span', { class: 'chip minor', text: '18歳未満' }));
      return el('tr', {}, [
        el('td', {}, [el('strong', { text: e.name })].concat(el('div', {}, chips))),
        el('td', { class: 'right', text: U.yen(e.wage) }),
        el('td', { text: e.canShift.map(function (id) { var s = Store.stById(id); return s ? s.short || s.name : ''; }).join('/') }),
        el('td', { class: 'right', text: e.minDays + '〜' + e.maxDays + '日' }),
        el('td', { class: 'right', text: e.maxConsecutive + '連勤' }),
        el('td', { class: 'right', text: e.priority > 0 ? '+' + e.priority : String(e.priority) }),
        el('td', { class: 'right nowrap', text: e.incomeCap > 0 ? U.yen(e.incomeCap) : '—' }),
        el('td', {}, [
          el('button', { class: 'btn ghost sm', text: '編集', onclick: function () { editEmp(e); } }),
          el('button', {
            class: 'btn ghost sm danger', text: '削除', onclick: function () {
              if (!confirm(e.name + ' を削除しますか？')) return;
              D.employees = D.employees.filter(function (x) { return x.id !== e.id; });
              saveAndRender();
            }
          })
        ])
      ]);
    });

    p.appendChild(card('従業員', '「優遇度」は多めに入れたい／控えめにしたいの調整。マイナスにしても最低出勤日数は必ず守ります。', [
      el('div', { class: 'scroll' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['氏名 / 属性', '時給', '担当可能', '出勤日数', '連勤上限', '優遇度', '年収上限', ''].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])]),
      el('div', { style: 'margin-top:12px' }, [el('button', {
        class: 'btn', text: '＋ 従業員を追加', onclick: function () {
          var e = {
            id: U.uid('e'), name: '新しい従業員', wage: 1100, employment: 'part',
            leader: false, certified: false, trainer: false, newbie: false, minor: false,
            canShift: D.shiftTypes.map(function (s) { return s.id; }), ngWeekdays: [], priority: 0,
            minDays: 0, maxDays: 20, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 0,
            ngPartners: [], goodPartners: [], trainerId: '', incomeCap: 0, ytdEarnings: 0, note: ''
          };
          D.employees.push(e); Store.save(); editEmp(e);
        }
      })])
    ]));
  }

  function editEmp(e) {
    var b = el('div', {}, []);
    b.appendChild(el('div', { class: 'row' }, [
      field('氏名', input('text', e.name, function (ev) { e.name = ev.target.value; })),
      field('時給', input('number', e.wage, function (ev) { e.wage = +ev.target.value; }, { step: 10 })),
      field('雇用区分', select([{ v: 'full', t: '正社員' }, { v: 'part', t: 'パート/アルバイト' }, { v: 'student', t: '学生' }, { v: 'contract', t: '契約' }], e.employment, function (ev) { e.employment = ev.target.value; }))
    ]));

    b.appendChild(el('h4', { text: '属性', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, [
      checkbox('責任者', e.leader, function (ev) { e.leader = ev.target.checked; }),
      checkbox('有資格者', e.certified, function (ev) { e.certified = ev.target.checked; }),
      checkbox('教育担当（新人と組める）', e.trainer, function (ev) { e.trainer = ev.target.checked; }),
      checkbox('新人（要ペア勤務）', e.newbie, function (ev) { e.newbie = ev.target.checked; }),
      checkbox('18歳未満', e.minor, function (ev) { e.minor = ev.target.checked; })
    ]));

    b.appendChild(el('h4', { text: '担当できる勤務区分', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, D.shiftTypes.map(function (st) {
      return checkbox(st.name, e.canShift.indexOf(st.id) >= 0, function (ev) {
        if (ev.target.checked) { if (e.canShift.indexOf(st.id) < 0) e.canShift.push(st.id); }
        else e.canShift = e.canShift.filter(function (x) { return x !== st.id; });
      });
    })));

    b.appendChild(el('h4', { text: '勤務できない曜日', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, U.WD.map(function (w, i) {
      return checkbox(w, e.ngWeekdays.indexOf(i) >= 0, function (ev) {
        if (ev.target.checked) { if (e.ngWeekdays.indexOf(i) < 0) e.ngWeekdays.push(i); }
        else e.ngWeekdays = e.ngWeekdays.filter(function (x) { return x !== i; });
      });
    })));

    b.appendChild(el('h4', { text: '勤務量', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, [
      field('最低出勤日数', input('number', e.minDays, function (ev) { e.minDays = +ev.target.value; }, { min: 0 })),
      field('最大出勤日数', input('number', e.maxDays, function (ev) { e.maxDays = +ev.target.value; }, { min: 0 })),
      field('連勤上限', input('number', e.maxConsecutive, function (ev) { e.maxConsecutive = +ev.target.value; }, { min: 0 })),
      field('月間上限時間(0=なし)', input('number', e.maxHoursMonth, function (ev) { e.maxHoursMonth = +ev.target.value; }, { min: 0 })),
      field('月間夜勤上限(0=なし)', input('number', e.maxNights, function (ev) { e.maxNights = +ev.target.value; }, { min: 0 })),
      field('優遇度 -3〜+3', select([-3, -2, -1, 0, 1, 2, 3].map(function (v) {
        return { v: v, t: v > 0 ? '+' + v + '（多めに）' : v < 0 ? v + '（控えめに）' : '0（標準）' };
      }), e.priority, function (ev) { e.priority = +ev.target.value; }))
    ]));

    b.appendChild(el('h4', { text: '年収の壁（扶養内で働きたい人）', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, [
      field('年収上限（0=設定しない）', input('number', e.incomeCap, function (ev) { e.incomeCap = +ev.target.value; }, { step: 10000 })),
      field('年初からの累計賃金', input('number', e.ytdEarnings, function (ev) { e.ytdEarnings = +ev.target.value; }, { step: 10000 }))
    ]));

    var others = D.employees.filter(function (x) { return x.id !== e.id; });
    b.appendChild(el('h4', { text: '人間関係・教育', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, [
      field('担当トレーナー（新人の場合）', select([{ v: '', t: '指定なし' }].concat(others.map(function (o) { return { v: o.id, t: o.name }; })), e.trainerId, function (ev) { e.trainerId = ev.target.value; }))
    ]));
    b.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [
      el('div', { class: 'field grow' }, [el('label', { text: '同じ勤務にできない人（相性NG）' }),
      el('div', { class: 'row' }, others.map(function (o) {
        return checkbox(o.name, e.ngPartners.indexOf(o.id) >= 0, function (ev) {
          if (ev.target.checked) { if (e.ngPartners.indexOf(o.id) < 0) e.ngPartners.push(o.id); }
          else e.ngPartners = e.ngPartners.filter(function (x) { return x !== o.id; });
        });
      }))])
    ]));
    b.appendChild(el('div', { class: 'row', style: 'margin-top:8px' }, [
      el('div', { class: 'field grow' }, [el('label', { text: 'できれば一緒に組ませたい人（相性◎）' }),
      el('div', { class: 'row' }, others.map(function (o) {
        return checkbox(o.name, e.goodPartners.indexOf(o.id) >= 0, function (ev) {
          if (ev.target.checked) { if (e.goodPartners.indexOf(o.id) < 0) e.goodPartners.push(o.id); }
          else e.goodPartners = e.goodPartners.filter(function (x) { return x !== o.id; });
        });
      }))])
    ]));

    b.appendChild(el('div', { class: 'row', style: 'margin-top:12px' }, [
      el('div', { class: 'field grow' }, [el('label', { text: 'メモ（非公開）' }), input('text', e.note, function (ev) { e.note = ev.target.value; })])
    ]));

    modal('従業員の編集', b, [
      el('button', { class: 'btn ghost', text: 'キャンセル', onclick: function () { D = Store.load(); closeModal(); render(); } }),
      el('button', { class: 'btn', text: '保存', onclick: function () { Store.save(); closeModal(); render(); toast('保存しました'); } })
    ]);
  }

  /* ================= ③ 希望・提出 ================= */
  function renderRequest() {
    var p = document.getElementById('panel-request'); p.innerHTML = '';
    var dates = Store.monthDates();
    var total = D.employees.length, done = Store.submittedCount();

    /* 提出状況 */
    var statusRows = D.employees.map(function (e) {
      var sub = Store.submissionOf(e.id);
      return el('tr', {}, [
        el('td', { text: e.name }),
        el('td', {}, [el('span', { class: 'badge ' + (sub.status === 'submitted' ? 'ok' : 'warn'), text: sub.status === 'submitted' ? '提出済み' : '未提出' })]),
        el('td', { class: 'muted', text: sub.at || '' }),
        el('td', {}, [el('button', {
          class: 'btn ghost sm', text: '提出画面を開く', onclick: function () { staffView = e.id; render(); }
        })])
      ]);
    });

    p.appendChild(card('提出状況　' + done + ' / ' + total + ' 人',
      'スタッフが「この日は何時から何時まで行けます／休みたいです」を入力します。全員提出、または責任者が締切を押すとシフトを自動作成できます。', [
      el('div', { class: 'row', style: 'margin-bottom:10px' }, [
        field('提出締切日', input('date', D.settings.deadline, function (e) { D.settings.deadline = e.target.value; Store.save(); })),
        el('div', { class: 'field' }, [el('label', { text: '受付' }),
        el('span', { class: 'badge ' + (D.settings.collectOpen ? 'ok' : 'ng'), text: D.settings.collectOpen ? '受付中' : '締切済み' })]),
        el('div', { class: 'field' }, [el('label', { text: ' ' }), el('button', {
          class: 'btn', text: D.settings.collectOpen ? '締め切ってシフトを作成' : '受付を再開する',
          onclick: function () {
            if (D.settings.collectOpen) {
              if (done < total && !confirm('未提出が ' + (total - done) + ' 人います。締め切って作成しますか？\n（未提出の日は「' + (D.settings.unsubmittedPolicy === 'available' ? '出勤できる' : '出勤不可') + '」扱いになります）')) return;
              D.settings.collectOpen = false; Store.save();
              switchTab('shift'); doGenerate();
            } else { D.settings.collectOpen = true; saveAndRender(); }
          }
        })])
      ]),
      el('table', {}, [el('thead', {}, [el('tr', {}, ['氏名', '状態', '提出日時', ''].map(function (h) { return el('th', { text: h }); }))]), el('tbody', {}, statusRows)])
    ]));

    /* スタッフ提出画面 */
    if (staffView && Store.empById(staffView)) p.appendChild(staffSubmitCard(Store.empById(staffView), dates));

    /* 全員一覧グリッド */
    var head = el('tr', {}, [el('th', { class: 'namecol', text: '氏名' })].concat(dates.map(function (d) {
      var w = U.weekdayOf(d);
      return el('th', { class: w === 0 ? 'sun' : w === 6 ? 'sat' : '', text: d.slice(8) });
    })));
    var body = D.employees.map(function (e) {
      return el('tr', {}, [el('td', { class: 'namecol', text: e.name })].concat(dates.map(function (d) {
        return reqCell(e, d);
      })));
    });

    p.appendChild(card('希望一覧（責任者が直接編集も可）', 'クリックで 空欄 → 休み希望 → 絶対休 → 有給 → 出勤希望 → 空欄 と切り替わります。', [
      el('div', { class: 'legend' }, [
        el('span', { class: 'req-off', text: '△ 休み希望（できれば）' }),
        el('span', { class: 'req-must', text: '× 絶対休' }),
        el('span', { class: 'req-paid', text: '有 有給' }),
        el('span', { class: 'req-want', text: '◎ 出勤希望' })
      ]),
      el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])])
    ]));
  }

  var REQ_CYCLE = ['', 'off', 'must', 'paid', 'want'];
  var REQ_LABEL = { '': '', off: '△', must: '×', paid: '有', want: '◎' };
  var REQ_CLASS = { '': '', off: 'req-off', must: 'req-must', paid: 'req-paid', want: 'req-want' };

  function reqCell(e, date) {
    var cur = Store.requestOf(e.id, date);
    var td = el('td', { class: 'req-cell ' + REQ_CLASS[cur], text: REQ_LABEL[cur] });
    td.addEventListener('click', function () {
      var next = REQ_CYCLE[(REQ_CYCLE.indexOf(cur) + 1) % REQ_CYCLE.length];
      if (!D.requests[e.id]) D.requests[e.id] = {};
      if (next === '') delete D.requests[e.id][date]; else D.requests[e.id][date] = next;
      Store.save(); render();
    });
    return td;
  }

  function staffSubmitCard(e, dates) {
    var rows = dates.map(function (d) {
      var w = U.weekdayOf(d);
      var av = D.avail[e.id] && D.avail[e.id][d] ? D.avail[e.id][d] : null;
      var mode = !av ? '' : av.off ? 'off' : av.allday ? 'allday' : 'time';
      var req = Store.requestOf(e.id, d);

      var fromI = input('time', av && av.from ? av.from : '09:00', function (ev) {
        var cur = D.avail[e.id][d]; cur.from = ev.target.value; Store.save();
      });
      var toI = input('time', av && av.to ? av.to : '18:00', function (ev) {
        var cur = D.avail[e.id][d]; cur.to = ev.target.value; Store.save();
      });
      if (mode !== 'time') { fromI.disabled = true; toI.disabled = true; }

      var sel = select([
        { v: '', t: '未入力' }, { v: 'allday', t: '終日OK' }, { v: 'time', t: '時間を指定' }, { v: 'off', t: '× 行けない' }
      ], mode, function (ev) {
        var v = ev.target.value;
        if (!D.avail[e.id]) D.avail[e.id] = {};
        if (v === '') delete D.avail[e.id][d];
        else if (v === 'allday') D.avail[e.id][d] = { allday: true };
        else if (v === 'off') D.avail[e.id][d] = { off: true };
        else D.avail[e.id][d] = { from: fromI.value, to: toI.value };
        Store.save(); render();
      });

      var reqSel = select([
        { v: '', t: '—' }, { v: 'off', t: '△ できれば休み' }, { v: 'must', t: '× 絶対休み' },
        { v: 'paid', t: '有給を使う' }, { v: 'want', t: '◎ 入りたい' }
      ], req, function (ev) {
        if (!D.requests[e.id]) D.requests[e.id] = {};
        if (ev.target.value === '') delete D.requests[e.id][d]; else D.requests[e.id][d] = ev.target.value;
        Store.save(); render();
      });

      return el('tr', {}, [
        el('td', { class: w === 0 ? 'sun' : w === 6 ? 'sat' : '', text: d.slice(5) + '(' + U.WD[w] + ')' }),
        el('td', {}, [sel]),
        el('td', {}, [fromI]), el('td', {}, [toI]),
        el('td', {}, [reqSel])
      ]);
    });

    var bulk = el('div', { class: 'row', style: 'margin-bottom:10px' }, [
      el('button', {
        class: 'btn ghost sm', text: '全日「終日OK」にする', onclick: function () {
          if (!D.avail[e.id]) D.avail[e.id] = {};
          dates.forEach(function (d) { D.avail[e.id][d] = { allday: true }; });
          Store.save(); render();
        }
      }),
      el('button', {
        class: 'btn ghost sm', text: '平日だけ終日OK', onclick: function () {
          if (!D.avail[e.id]) D.avail[e.id] = {};
          dates.forEach(function (d) {
            var w = U.weekdayOf(d);
            D.avail[e.id][d] = (w === 0 || w === 6) ? { off: true } : { allday: true };
          });
          Store.save(); render();
        }
      }),
      el('button', {
        class: 'btn ghost sm danger', text: '入力をクリア', onclick: function () {
          delete D.avail[e.id]; delete D.requests[e.id];
          D.submissions[e.id] = { status: 'open', at: '' };
          Store.save(); render();
        }
      })
    ]);

    return card('📱 ' + e.name + ' さんの提出画面',
      '「行ける日と時間」「休みたい日」を入れて提出ボタンを押してください。', [
      bulk,
      el('div', { class: 'scroll', style: 'max-height:420px' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['日付', '出勤可否', '何時から', '何時まで', '希望'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])]),
      el('div', { class: 'row', style: 'margin-top:12px' }, [
        el('button', {
          class: 'btn big', text: 'この内容で提出する', onclick: function () {
            var now = new Date();
            D.submissions[e.id] = {
              status: 'submitted',
              at: now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate() + ' ' + U.pad(now.getHours()) + ':' + U.pad(now.getMinutes())
            };
            Store.save(); staffView = ''; render();
            toast(e.name + 'さんの希望を受け付けました');
            if (Store.submittedCount() === D.employees.length) {
              setTimeout(function () {
                if (confirm('全員の提出がそろいました。今すぐシフトを自動作成しますか？')) {
                  D.settings.collectOpen = false; Store.save(); switchTab('shift'); doGenerate();
                }
              }, 300);
            }
          }
        }),
        el('button', { class: 'btn ghost', text: '閉じる', onclick: function () { staffView = ''; render(); } })
      ])
    ]);
  }

  /* ================= ④ シフト表 ================= */
  function renderShift() {
    var p = document.getElementById('panel-shift'); p.innerHTML = '';
    var dates = Store.monthDates();
    var res = D.lastResult;

    var head = el('div', { class: 'row', style: 'margin-bottom:8px' }, [
      el('button', { class: 'btn big', text: '⚙ シフトを自動作成', onclick: doGenerate }),
      el('button', {
        class: 'btn ghost', text: '空にする', onclick: function () {
          if (!confirm('作成したシフトを消しますか？')) return;
          D.assignments = {}; D.lastResult = null; saveAndRender();
        }
      }),
      el('button', { class: 'btn ghost', text: 'CSV出力', onclick: exportCsv }),
      el('button', {
        class: 'btn ghost', text: '前月として保存', onclick: function () {
          D.prevMonth = U.clone(D.assignments); Store.save();
          toast('現在のシフトを「前月分」として記録しました（月跨ぎの連勤判定に使われます）');
        }
      })
    ]);
    p.appendChild(head);

    if (res) {
      var hardN = res.violations.filter(function (v) { return v.level === 'hard'; }).length;
      var softN = res.violations.length - hardN;
      p.appendChild(card('作成結果', '', [
        el('div', { class: 'grid2' }, [
          stat('法令・必須違反', hardN + ' 件', hardN ? 'ng' : 'ok'),
          stat('要調整（希望など）', softN + ' 件', softN ? 'warn' : 'ok'),
          stat('人員不足の枠', res.unfilled.length + ' 件', res.unfilled.length ? 'warn' : 'ok'),
          stat('概算人件費', U.yen(res.totalPay), D.settings.budget > 0 && res.totalPay > D.settings.budget ? 'warn' : 'ok')
        ]),
        res.violations.length ? el('div', { style: 'margin-top:12px' }, res.violations.slice(0, 60).map(function (v) {
          return el('div', { class: 'violation ' + (v.level === 'hard' ? 'hard' : '') }, [
            el('div', { class: 'vt', text: v.msg }),
            el('div', { class: 'vd', text: (Rules.DEF_MAP[v.ruleId] ? v.ruleId + ' ' + Rules.DEF_MAP[v.ruleId].name : v.ruleId) })
          ]);
        })) : el('p', { class: 'muted', text: 'ルール違反はありません。' }),
        res.log && res.log.length ? el('div', { style: 'margin-top:8px' }, res.log.map(function (l) { return el('div', { class: 'vd', text: '・' + l }); })) : null
      ]));
    }

    /* シフト表（人 × 日） */
    var thead = el('tr', {}, [el('th', { class: 'namecol', text: '氏名' })].concat(dates.map(function (d) {
      var w = U.weekdayOf(d);
      return el('th', { class: w === 0 || Store.isHoliday(d) ? 'sun' : w === 6 ? 'sat' : '', text: d.slice(8) + '\n' + U.WD[w], style: 'white-space:pre;text-align:center' });
    })).concat([el('th', { text: '日数' }), el('th', { text: '時間' })]));

    var rows = D.employees.map(function (e) {
      var days = 0, mins = 0;
      var tds = dates.map(function (d) {
        var stId = shiftOfEmp(e.id, d);
        var td;
        if (stId) {
          var st = Store.stById(stId);
          days++; mins += Store.stCalc(st).work;
          td = el('td', { class: 'cell-shift', text: st.short || st.name, style: 'background:' + st.color + '33;color:inherit' });
        } else {
          var req = Store.requestOf(e.id, d);
          td = el('td', { class: 'cell-shift empty ' + (REQ_CLASS[req] || ''), text: req ? REQ_LABEL[req] : '・' });
        }
        td.addEventListener('click', function () { openCell(e, d); });
        return td;
      });
      return el('tr', {}, [el('td', { class: 'namecol', text: e.name })].concat(tds)
        .concat([el('td', { class: 'right', text: String(days) }), el('td', { class: 'right', text: U.min2h(mins) })]));
    });

    /* 日別の充足状況 */
    var needRows = D.shiftTypes.map(function (st) {
      return el('tr', {}, [el('td', { class: 'namecol', text: st.name + ' 充足' })].concat(dates.map(function (d) {
        var need = Store.needOf(d, st.id), got = Store.assignedOf(d, st.id).length;
        if (need === 0 && got === 0) return el('td', { class: 'cell-shift empty', text: '' });
        var okc = got >= need;
        return el('td', {
          class: 'cell-shift', text: got + '/' + need,
          style: okc ? 'color:var(--ok)' : 'color:#fff;background:var(--ng)'
        });
      })).concat([el('td', {}), el('td', {})]));
    });

    p.appendChild(card('シフト表', 'セルをクリックすると勤務を変更できます。「なぜこの人か」も表示されます。', [
      el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [thead]), el('tbody', {}, rows.concat(needRows))])])
    ]));
  }

  function stat(k, v, cls) {
    return el('div', { class: 'stat' }, [el('div', { class: 'k', text: k }), el('div', { class: 'v ' + (cls === 'ng' ? '' : ''), text: v })]);
  }

  function shiftOfEmp(empId, date) {
    var a = D.assignments[date] || {};
    var found = '';
    Object.keys(a).forEach(function (stId) { if ((a[stId] || []).indexOf(empId) >= 0) found = stId; });
    return found;
  }

  function openCell(e, date) {
    var cur = shiftOfEmp(e.id, date);
    var b = el('div', {}, []);
    b.appendChild(el('p', { class: 'muted', text: date + '（' + U.WD[U.weekdayOf(date)] + '）　' + e.name + ' さん' }));

    // 提出内容
    var av = Store.availOf(e.id, date);
    var avText = av === null ? '未提出' : av === false ? '本人「行けない」' : av === 'any' ? '終日OK' : (av.from + '〜' + av.to);
    var req = Store.requestOf(e.id, date);
    b.appendChild(el('p', {}, [
      el('span', { class: 'chip', text: '提出：' + avText }),
      req ? el('span', { class: 'chip', text: '希望：' + { off: '休み希望', must: '絶対休', paid: '有給', want: '出勤希望' }[req] }) : null
    ]));

    // 変更ボタン
    var btns = el('div', { class: 'row', style: 'margin:12px 0' }, D.shiftTypes.map(function (st) {
      var ngs = cur === st.id ? [] : Solver.checkManual(D, assignmentsWithout(e.id, date), e.id, date, st.id);
      var btn = el('button', {
        class: 'btn ' + (cur === st.id ? '' : 'ghost'),
        text: st.name + (ngs.length ? '（NG）' : ''),
        onclick: function () {
          if (ngs.length && !confirm('この割当は次のルールに反します：\n' + ngs.map(function (n) { return '・' + n.msg; }).join('\n') + '\nそれでも入れますか？')) return;
          setCell(e.id, date, st.id); closeModal();
        }
      });
      if (ngs.length) btn.title = ngs.map(function (n) { return n.msg; }).join(' / ');
      return btn;
    }).concat([el('button', { class: 'btn ghost danger', text: '休み（外す）', onclick: function () { setCell(e.id, date, ''); closeModal(); } })]));
    b.appendChild(btns);

    // NG理由
    var ngList = [];
    D.shiftTypes.forEach(function (st) {
      if (cur === st.id) return;
      var ngs = Solver.checkManual(D, assignmentsWithout(e.id, date), e.id, date, st.id);
      ngs.forEach(function (n) { ngList.push(st.name + '：' + n.msg + '（' + n.ruleId + '）'); });
    });
    if (ngList.length) {
      b.appendChild(el('h4', { text: '入れられない理由' }));
      ngList.forEach(function (t) { b.appendChild(el('div', { class: 'vd', text: '・' + t })); });
    }

    // 生成時の根拠
    var tr = D.lastResult && D.lastResult.trace[date] && D.lastResult.trace[date][cur] && D.lastResult.trace[date][cur][e.id];
    if (tr) {
      b.appendChild(el('h4', { text: 'この人が選ばれた理由', style: 'margin-top:14px' }));
      (tr.why || []).filter(function (w) { return w.label; }).forEach(function (w) {
        b.appendChild(el('div', { class: 'vd', text: (w.v > 0 ? '△ ' : w.v < 0 ? '◎ ' : '・') + w.label + '（' + (w.v > 0 ? '+' : '') + w.v + '点）' }));
      });
      if (tr.alternatives && tr.alternatives.length) {
        b.appendChild(el('div', { class: 'vd', style: 'margin-top:6px', text: '次点：' + tr.alternatives.map(function (a) { return a.name + '(' + a.score + ')'; }).join('、') }));
      }
      if (tr.blocked && tr.blocked.length) {
        b.appendChild(el('h4', { text: '他の人が入れなかった理由', style: 'margin-top:10px' }));
        tr.blocked.slice(0, 6).forEach(function (x) {
          b.appendChild(el('div', { class: 'vd', text: '・' + x.name + '：' + x.reason }));
        });
      }
    }

    // その枠に入れる他の候補
    if (cur) {
      var cands = Solver.candidatesFor(Rules.buildContext(D, U.clone(assignmentsWithout(e.id, date))), { date: date, stId: cur, need: Store.needOf(date, cur) });
      if (cands.length) {
        b.appendChild(el('h4', { text: '交代できる人', style: 'margin-top:14px' }));
        b.appendChild(el('div', { class: 'row' }, cands.slice(0, 8).map(function (c) {
          return el('button', {
            class: 'btn ghost sm', text: Store.empById(c.empId).name, onclick: function () {
              setCell(e.id, date, '');
              setCell(c.empId, date, cur);
              closeModal();
            }
          });
        })));
      }
    }

    modal('勤務の変更', b, [el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })]);
  }

  function assignmentsWithout(empId, date) {
    var a = U.clone(D.assignments);
    if (a[date]) Object.keys(a[date]).forEach(function (stId) {
      a[date][stId] = (a[date][stId] || []).filter(function (x) { return x !== empId; });
    });
    return a;
  }

  function setCell(empId, date, stId) {
    if (!D.assignments[date]) D.assignments[date] = {};
    Object.keys(D.assignments[date]).forEach(function (s) {
      D.assignments[date][s] = (D.assignments[date][s] || []).filter(function (x) { return x !== empId; });
    });
    if (stId) {
      if (!D.assignments[date][stId]) D.assignments[date][stId] = [];
      D.assignments[date][stId].push(empId);
    }
    var rv = Solver.revalidate(D, D.assignments);
    if (D.lastResult) { D.lastResult.violations = rv.violations; D.lastResult.stats = rv.stats; D.lastResult.totalPay = rv.totalPay; }
    saveAndRender();
  }

  function doGenerate() {
    var res = Solver.generate(D);
    D.assignments = res.assignments;
    D.lastResult = res;
    Store.save(); render();
    var hard = res.violations.filter(function (v) { return v.level === 'hard'; }).length;
    toast(hard === 0 ? 'シフトを作成しました（ルール違反なし）' : 'シフトを作成しました（要確認 ' + hard + ' 件）');
  }

  function exportCsv() {
    var dates = Store.monthDates();
    var lines = [];
    lines.push(['氏名'].concat(dates.map(function (d) { return d.slice(5) + '(' + U.WD[U.weekdayOf(d)] + ')'; })).concat(['日数', '時間']).join(','));
    D.employees.forEach(function (e) {
      var days = 0, mins = 0;
      var row = [e.name].concat(dates.map(function (d) {
        var stId = shiftOfEmp(e.id, d);
        if (!stId) return '';
        var st = Store.stById(stId); days++; mins += Store.stCalc(st).work;
        return st.name;
      }));
      lines.push(row.concat([days, U.min2h(mins)]).join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'shift_' + D.settings.year + U.pad(D.settings.month) + '.csv';
    a.click();
  }

  /* ================= ⑤ 集計 ================= */
  function renderSummary() {
    var p = document.getElementById('panel-summary'); p.innerHTML = '';
    var rv = Solver.revalidate(D, D.assignments);
    var st = rv.stats;

    var rows = D.employees.map(function (e) {
      var s = st[e.id];
      var ytd = (e.ytdEarnings || 0) + s.pay;
      var capCls = e.incomeCap > 0 ? (ytd > e.incomeCap ? 'ng' : ytd > e.incomeCap * 0.9 ? 'warn' : 'ok') : '';
      return el('tr', {}, [
        el('td', { text: e.name }),
        el('td', { class: 'right', text: s.days + ' 日' + (e.minDays > s.days ? '（不足' + (e.minDays - s.days) + '）' : '') }),
        el('td', { class: 'right', text: s.hours + ' h' }),
        el('td', { class: 'right', text: s.nights + ' 回' }),
        el('td', { class: 'right', text: s.weekends + ' 回' }),
        el('td', { class: 'right', text: s.nightHours + ' h' }),
        el('td', { class: 'right', text: (s.otHours || 0) + ' h' }),
        el('td', { class: 'right', text: U.yen(s.pay) }),
        el('td', { class: 'right' }, [e.incomeCap > 0 ? el('span', { class: 'badge ' + capCls, text: U.yen(ytd) + ' / ' + U.yen(e.incomeCap) }) : el('span', { class: 'muted', text: '—' })])
      ]);
    });

    var totalHours = D.employees.reduce(function (a, e) { return a + st[e.id].hours; }, 0);
    p.appendChild(card('集計', '公平性のチェックにも使えます。', [
      el('div', { class: 'grid2' }, [
        stat('総労働時間', totalHours.toFixed(1) + ' h'),
        stat('概算人件費', U.yen(rv.totalPay)),
        stat('予算', D.settings.budget > 0 ? U.yen(D.settings.budget) : '未設定'),
        stat('差引', D.settings.budget > 0 ? U.yen(D.settings.budget - rv.totalPay) : '—')
      ]),
      el('div', { class: 'scroll', style: 'margin-top:12px' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['氏名', '出勤日数', '労働時間', '夜勤', '土日祝', '深夜時間', '時間外', '賃金(概算)', '年収の壁'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])])
    ]));

    // 公平性
    var nights = D.employees.map(function (e) { return st[e.id].nights; });
    var hours = D.employees.map(function (e) { return st[e.id].hours; });
    p.appendChild(card('公平性', '差が大きい項目は、ルール設定で重みを上げると平準化されます。', [
      el('div', { class: 'grid2' }, [
        stat('夜勤の最大差', (Math.max.apply(null, nights.concat([0])) - Math.min.apply(null, nights.concat([0]))) + ' 回'),
        stat('労働時間の最大差', (Math.max.apply(null, hours.concat([0])) - Math.min.apply(null, hours.concat([0]))).toFixed(1) + ' h')
      ])
    ]));
  }

  /* ================= ⑥ ルール設定 ================= */
  function renderRules() {
    var p = document.getElementById('panel-rules'); p.innerHTML = '';
    var groups = { law: [], ops: [] };
    Rules.DEFS.forEach(function (d) { groups[d.cat].push(d); });

    function ruleRow(d) {
      var c = Rules.cfg(D, d.id);
      var body = el('div', { class: 'row', style: 'margin-top:8px' }, []);
      if (!c.lock) {
        body.appendChild(checkbox('有効', c.enabled, function (e) { setRule(d.id, { enabled: e.target.checked }); }));
        body.appendChild(field('区分', select([{ v: 'hard', t: 'ハード（絶対）' }, { v: 'soft', t: 'ソフト（できるだけ）' }], c.type,
          function (e) { setRule(d.id, { type: e.target.value }); })));
        if (c.type === 'soft')
          body.appendChild(field('重み', input('number', c.weight, function (e) { setRule(d.id, { weight: +e.target.value }); }, { step: 100 })));
        if (d.id === 'OPS-027')
          body.appendChild(field('インターバル時間', input('number', c.params.hours, function (e) { setRule(d.id, { params: { hours: +e.target.value } }); }, { min: 0, max: 24 })));
      } else {
        body.appendChild(el('span', { class: 'badge ng', text: '法令のため常に有効（変更不可）' }));
      }
      return el('details', { class: 'rule' }, [
        el('summary', {}, [
          el('span', { class: d.cat === 'law' ? 'tag-law' : 'tag-ops', text: d.id + ' ' }),
          el('span', { text: d.name + '　' }),
          el('span', { class: 'badge ' + (c.type === 'hard' ? 'ng' : 'warn'), text: c.type === 'hard' ? '必須' : '重み ' + c.weight })
        ]),
        el('p', { class: 'hint', text: d.desc }),
        body
      ]);
    }

    p.appendChild(card('法令ルール（変更不可）', 'rules/01-legal.md に対応。労働基準法などに基づく制約です。', groups.law.map(ruleRow)));
    p.appendChild(card('運用ルール', 'rules/02-operational.md・05-real-world-knowledge.md に対応。現場に合わせて調整できます。', groups.ops.map(ruleRow)));
  }

  function setRule(id, patch) {
    if (!D.ruleConfig[id]) D.ruleConfig[id] = {};
    Object.keys(patch).forEach(function (k) {
      if (k === 'params') D.ruleConfig[id].params = Object.assign({}, D.ruleConfig[id].params || {}, patch.params);
      else D.ruleConfig[id][k] = patch[k];
    });
    saveAndRender();
  }

  /* ================= タブ・初期化 ================= */
  function switchTab(name) {
    currentTab = name;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.panel'), function (pn) {
      pn.classList.toggle('hidden', pn.id !== 'panel-' + name);
    });
    render();
  }

  function render() {
    D = Store.get();
    if (currentTab === 'setup') renderSetup();
    if (currentTab === 'staff') renderStaff();
    if (currentTab === 'request') renderRequest();
    if (currentTab === 'shift') renderShift();
    if (currentTab === 'summary') renderSummary();
    if (currentTab === 'rules') renderRules();
  }

  document.getElementById('tabs').addEventListener('click', function (e) {
    if (e.target.classList.contains('tab')) switchTab(e.target.dataset.tab);
  });
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });
  document.getElementById('btnExport').addEventListener('click', function () { Store.exportJson(); });
  document.getElementById('btnImport').addEventListener('click', function () { document.getElementById('fileImport').click(); });
  document.getElementById('fileImport').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try { Store.importJson(r.result); D = Store.get(); render(); toast('読み込みました'); }
      catch (err) { alert('読み込めませんでした：' + err.message); }
    };
    r.readAsText(f);
    e.target.value = '';
  });
  document.getElementById('btnReset').addEventListener('click', function () {
    if (!confirm('すべてのデータを初期状態に戻します。よろしいですか？')) return;
    D = Store.reset(); render(); toast('初期化しました');
  });

  render();
})();
