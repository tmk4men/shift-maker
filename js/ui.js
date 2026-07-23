/* ui.js — 画面。データは Store、判定は Rules、生成は Solver に任せる */
(function () {
  var D = Store.load();
  var el = U.el;
  var currentTab = 'setup';
  var staffView = '';     // 提出画面を開いている従業員ID
  var staffPage = '';     // スタッフ専用モードの表示（shift = 自分のシフト / submit = 希望提出）

  /* スタッフ専用モード：?staff=従業員ID で開くと提出画面だけになる（管理操作は出さない） */
  var staffOnly = '', inputMode = false;
  try {
    var q = (typeof location !== 'undefined' && location.search) ? location.search : '';
    var m = q.match(/[?&]staff=([^&]+)/);
    if (m) staffOnly = decodeURIComponent(m[1]);
    inputMode = /[?&]input=1/.test(q);
  } catch (err) { staffOnly = ''; inputMode = false; }



  /* ================= 共通 ================= */
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(t._tm); t._tm = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }
  function saveAndRender() { Store.save(); render(); }
  Store.onSaveError(function (msg) { toast(msg); });

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
  /* ================= 手順ガイド ================= */
  /** いまどこまで進んでいて、次に何をすればいいか */
  function steps() {
    var dates = Store.monthDates();
    var needSet = dates.some(function (d) {
      return D.shiftTypes.some(function (st) { return Store.needOf(d, st.id) > 0; });
    });
    var hasShift = dates.some(function (d) {
      return D.shiftTypes.some(function (st) { return Store.assignedOf(d, st.id).length > 0; });
    });
    return [
      { n: 1, tab: 'setup', label: '店の設定', done: needSet, todo: '勤務区分と必要人数を決める' },
      { n: 2, tab: 'staff', label: 'スタッフ登録', done: D.employees.length > 0, todo: 'スタッフを登録する' },
      { n: 3, tab: 'request', label: '希望を入れる', done: D.employees.some(function (e) {
        return dates.some(function (d) { return D.avail[e.id] && D.avail[e.id][d]; });
      }), todo: 'スタッフの行ける日・時間を入れる' },
      { n: 4, tab: 'shift', label: 'シフト作成', done: hasShift, todo: 'シフトを自動作成する' }
    ];
  }

  function guideBar() {
    var st = steps();
    var next = st.filter(function (s) { return !s.done; })[0];

    var strip = el('div', { class: 'guide' }, st.map(function (s, i) {
      var state = s.done ? 'done' : (next && next.n === s.n ? 'now' : '');
      return el('button', {
        class: 'guide-step ' + state, onclick: function () { switchTab(s.tab); },
        title: s.todo
      }, [
        el('span', { class: 'guide-n', text: s.done ? '✓' : String(s.n) }),
        el('span', { text: s.label })
      ]);
    }));

    var msg = next
      ? el('div', { class: 'guide-next' }, [
        el('span', { text: '次にやること：' + next.todo }),
        el('button', { class: 'btn sm', text: '開く', onclick: function () { switchTab(next.tab); } })
      ])
      : el('div', { class: 'guide-next done' }, [
        el('span', { text: 'シフトができました。④で内容を確認し、③のスタッフ用リンクで共有できます。' })
      ]);

    return el('div', { class: 'guide-wrap' }, [strip, msg]);
  }

  function card(title, hint, children) {
    return el('div', { class: 'card' }, [el('h2', { text: title }), hint ? el('p', { class: 'hint', text: hint }) : null].concat(children));
  }

  /* ================= ① 基本設定 ================= */
  function renderSetup() {
    var p = document.getElementById('panel-setup'); p.innerHTML = '';
    var s = D.settings;

    /* サンプルのままなら、まず消して始められるように案内する */
    if (Store.isSample()) {
      p.appendChild(card('サンプルのお店が入っています',
        'そのまま試せます。自分の店で使うときは空にしてください。', [
        el('div', { class: 'row' }, [
          el('button', {
            class: 'btn', text: 'サンプルを消して空から始める', onclick: function () {
              if (!confirm('サンプルの従業員・シフトをすべて消して、空の状態から始めます。よろしいですか？')) return;
              D = Store.startFresh(); currentTab = 'setup'; render();
              toast('空にしました。店舗名・勤務区分・必要人数から設定してください');
            }
          }),
          el('button', { class: 'btn ghost', text: 'このまま試す', onclick: function () { switchTab('shift'); } })
        ])
      ]));
    }

    /* データの保存場所についての注意（消えると困るので最初に伝える） */
    p.appendChild(el('div', { class: 'violation', style: 'margin-bottom:16px' }, [
      el('div', { class: 'vt', text: 'データはこのブラウザにのみ保存されます' }),
      el('div', { class: 'vd', text: 'ブラウザのデータを消すと失われます。右上の［書き出し］でファイルに残せます。' })
    ]));

    p.appendChild(card('店舗・対象月', null, [
      el('div', { class: 'row' }, [
        field('店舗名', input('text', s.storeName, function (e) { s.storeName = e.target.value; Store.save(); })),
        field('年', input('number', s.year, function (e) { s.year = U.num(e.target.value, 2000, 2100, s.year); saveAndRender(); }, { min: 2000, max: 2100 })),
        field('月', select([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return { v: m, t: m + '月' }; }), s.month,
          function (e) { s.month = +e.target.value; saveAndRender(); })),
        field('週の始まり', select([{ v: 0, t: '日曜' }, { v: 1, t: '月曜' }], s.weekStartsOn, function (e) { s.weekStartsOn = +e.target.value; saveAndRender(); })),
        field('人件費予算（0=なし）', input('number', s.budget, function (e) { s.budget = U.num(e.target.value, 0, 1e12, 0); Store.save(); }, { step: 10000, min: 0 }))
      ]),
      el('p', { class: 'hint', style: 'margin-top:10px', text:
        '祝日は自動判定します。希望が入力されていない日は出勤させません。必要人数を超える配置もしません。' })
    ]));

    /* お店の休み */
    var closedCard = card('お店の休み', '休みの日には誰も出勤させません。必要人数の設定より優先されます。', [
      el('div', { class: 'field' }, [el('label', { text: '定休日（毎週この曜日は休み）' }),
      el('div', { class: 'row' }, U.WD.map(function (w, i) {
        return checkbox(w + '曜', (s.closedWeekdays || []).indexOf(i) >= 0, function (e) {
          if (e.target.checked) { if (s.closedWeekdays.indexOf(i) < 0) s.closedWeekdays.push(i); }
          else s.closedWeekdays = s.closedWeekdays.filter(function (x) { return x !== i; });
          saveAndRender();
        });
      }))]),
      el('div', { class: 'field', style: 'margin-top:16px' }, [el('label', { text: '臨時休業日（年末年始・棚卸しなど）' }),
      el('div', { class: 'row' }, [
        (function () {
          var di = input('date', '', null);
          return el('div', { class: 'row' }, [di, el('button', {
            class: 'btn sm', text: '追加', onclick: function () {
              var v = di.value;
              if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return toast('日付を選んでください');
              if (s.closedDates.indexOf(v) < 0) s.closedDates.push(v);
              s.closedDates.sort();
              saveAndRender();
            }
          })]);
        })()
      ])]),
      el('div', { class: 'row', style: 'margin-top:12px' },
        (s.closedDates || []).length
          ? s.closedDates.map(function (d) {
            return el('span', { class: 'chip' }, [
              d + '（' + U.WD[U.weekdayOf(d)] + '）',
              el('button', {
                class: 'btn ghost sm', style: 'margin-left:6px;min-height:24px;padding:0 8px',
                text: '✕', onclick: function () {
                  s.closedDates = s.closedDates.filter(function (x) { return x !== d; });
                  saveAndRender();
                }
              })
            ]);
          })
          : [el('span', { class: 'muted', text: '登録なし' })])
    ]);
    p.appendChild(closedCard);

    /* 勤務区分 */
    var stRows = D.shiftTypes.map(function (st, i) {
      var c = Store.stCalc(st);
      var warn = '';
      if (c.work > 480 && st.breakMin < 60) warn = '休憩60分以上が必要';
      else if (c.work > 360 && st.breakMin < 45) warn = '休憩45分以上が必要';
      return el('tr', {}, [
        el('td', {}, [input('text', st.name, function (e) { st.name = e.target.value; Store.save(); }, { style: 'width:80px' })]),
        el('td', {}, [input('text', st.short, function (e) { st.short = e.target.value; Store.save(); }, { style: 'width:44px' })]),
        el('td', {}, [input('time', st.start, function (e) { if (U.isTime(e.target.value)) { st.start = e.target.value; saveAndRender(); } })]),
        el('td', {}, [input('time', st.end, function (e) { if (U.isTime(e.target.value)) { st.end = e.target.value; saveAndRender(); } })]),
        el('td', {}, [input('number', st.breakMin, function (e) { st.breakMin = U.num(e.target.value, 0, 600, 0); saveAndRender(); }, { style: 'width:70px', step: 5, min: 0, max: 600 })]),
        el('td', {}, [input('color', st.color, function (e) { st.color = e.target.value; Store.save(); }, { style: 'width:44px;padding:0' })]),
        el('td', { class: 'nowrap', text: U.min2h(c.work) + 'h' }),
        el('td', { class: 'nowrap', text: c.night > 0 ? U.min2h(c.night) + 'h' : '—' }),
        el('td', {}, [warn ? el('span', { class: 'badge ng', text: warn }) : el('span', { class: 'badge ok', text: 'OK' })]),
        el('td', {}, [el('button', {
          class: 'btn ghost sm danger', text: '削除', onclick: function () {
            if (D.shiftTypes.length <= 1) return toast('最低1つは必要です');
            if (!confirm(st.name + ' を削除します。\n作成済みシフトのこの勤務、必要人数の設定、各人の「担当できる勤務区分」からも削除されます。よろしいですか？')) return;
            Store.removeShiftType(st.id); D = Store.get(); render();
          }
        })])
      ]);
    });

    p.appendChild(card('勤務区分', '終了が開始より前なら日跨ぎ（夜勤）として計算します。', [
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
        return el('td', {}, [input('number', v, function (e) { arr[i] = U.num(e.target.value, 0, 99, 0); Store.save(); }, { style: 'width:56px', min: 0, max: 99 })]);
      })).concat([
        el('td', {}, [checkbox('', rr.leader, function (e) { rr.leader = e.target.checked; Store.save(); })]),
        el('td', {}, [checkbox('', rr.certified, function (e) { rr.certified = e.target.checked; Store.save(); })])
      ]));
    });

    p.appendChild(card('必要人数（曜日別）', null, [
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
              else D.demand.overrides[date][st.id] = U.num(e.target.value, 0, 99, 0);
              Store.save();
            }, { style: 'width:56px', min: 0, placeholder: Store.needOf(date, st.id) })]);
          })));
      }))
    ]);
    det.appendChild(el('div', { class: 'scroll', style: 'max-height:340px;margin-top:8px' }, [ovTable]));
    p.appendChild(card('特定日の調整', null, [det]));
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
              if (!confirm(e.name + ' さんを削除します。\n作成済みシフト・希望・提出内容・相性設定からも削除されます。よろしいですか？')) return;
              Store.removeEmployee(e.id); D = Store.get(); render();
            }
          })
        ])
      ]);
    });

    p.appendChild(card('従業員', '優遇度をマイナスにしても、最低出勤日数は必ず守ります。', [
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
            minDays: 0, maxDays: 20, maxConsecutive: 5, maxHoursMonth: 0, maxNights: 0, weeklyHoursCap: 0,
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
      field('時給', input('number', e.wage, function (ev) { e.wage = U.num(ev.target.value, 0, 100000, 0); }, { step: 10, min: 0 })),
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
      field('最低出勤日数', input('number', e.minDays, function (ev) { e.minDays = U.num(ev.target.value, 0, 31, 0); }, { min: 0 })),
      field('最大出勤日数', input('number', e.maxDays, function (ev) { e.maxDays = U.num(ev.target.value, 0, 31, 0); }, { min: 0 })),
      field('連勤上限', input('number', e.maxConsecutive, function (ev) { e.maxConsecutive = U.num(ev.target.value, 0, 31, 0); }, { min: 0 })),
      field('月間の最低時間(0=なし)', input('number', e.minHoursMonth, function (ev) { e.minHoursMonth = U.num(ev.target.value, 0, 744, 0); }, { min: 0 })),
      field('月間の上限時間(0=なし)', input('number', e.maxHoursMonth, function (ev) { e.maxHoursMonth = U.num(ev.target.value, 0, 744, 0); }, { min: 0 })),
      field('月間夜勤上限(0=なし)', input('number', e.maxNights, function (ev) { e.maxNights = U.num(ev.target.value, 0, 31, 0); }, { min: 0 })),
      field('週の上限時間(0=なし)', input('number', e.weeklyHoursCap, function (ev) { e.weeklyHoursCap = U.num(ev.target.value, 0, 80, 0); }, { min: 0, max: 80 })),
      field('優遇度 -3〜+3', select([-3, -2, -1, 0, 1, 2, 3].map(function (v) {
        return { v: v, t: v > 0 ? '+' + v + '（多めに）' : v < 0 ? v + '（控えめに）' : '0（標準）' };
      }), e.priority, function (ev) { e.priority = +ev.target.value; }))
    ]));

    b.appendChild(el('p', { class: 'hint', style: 'margin-top:6px', text:
      '※「最低出勤日数」「月間の最低時間」は契約で保障している下限です。届かない場合は不足として報告します（休業手当の検討が必要になるため）。' }));
    b.appendChild(el('p', { class: 'hint', text:
      '※「週の上限時間」は社会保険に入りたくない人の調整に使います。2026年10月から月額8.8万円（106万円）の要件が撤廃され、'
      + '週20時間以上が加入の分かれ目になるため、その場合は 19 などを設定してください。' }));

    b.appendChild(el('h4', { text: '年収の壁（扶養内で働きたい人）', style: 'margin-top:14px' }));
    b.appendChild(el('div', { class: 'row' }, [
      field('年収上限（0=設定しない）', input('number', e.incomeCap, function (ev) { e.incomeCap = U.num(ev.target.value, 0, 1e9, 0); }, { step: 10000 })),
      field('年初からの累計賃金', input('number', e.ytdEarnings, function (ev) { e.ytdEarnings = U.num(ev.target.value, 0, 1e9, 0); }, { step: 10000 }))
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

    /* 入力状況 */
    var statusRows = D.employees.map(function (e) {
      var filled = dates.filter(function (d) { return D.avail[e.id] && D.avail[e.id][d]; }).length;
      var cls = filled === 0 ? 'ng' : filled < dates.length ? 'warn' : 'ok';
      var label = filled === 0 ? '未入力（シフトに入りません）' : filled + ' / ' + dates.length + ' 日';
      return el('tr', {}, [
        el('td', { text: e.name }),
        el('td', {}, [el('span', { class: 'badge ' + cls, text: label })]),
        el('td', {}, [
          el('button', { class: 'btn ghost sm', text: '入力する', onclick: function () { staffView = e.id; render(); } }),
          el('button', {
            class: 'btn ghost sm', text: '全日OKにする', onclick: function () {
              if (!D.avail[e.id]) D.avail[e.id] = {};
              dates.forEach(function (d) {
                if ((e.ngWeekdays || []).indexOf(U.weekdayOf(d)) >= 0) D.avail[e.id][d] = { off: true };
                else D.avail[e.id][d] = { allday: true };
              });
              saveAndRender(); toast(e.name + 'さんを全日OKにしました');
            }
          })
        ])
      ]);
    });

    var noInput = D.employees.filter(function (e) {
      return !dates.some(function (d) { return D.avail[e.id] && D.avail[e.id][d]; });
    });

    p.appendChild(card('希望の入力状況　' + (D.employees.length - noInput.length) + ' / ' + D.employees.length + ' 人',
      '入力がない日は出勤させません。全く入力のない人はシフトに入りません。', [
      el('div', { class: 'row', style: 'margin-bottom:12px' }, [
        el('button', {
          class: 'btn', text: 'シフトを作成する', onclick: function () {
            if (noInput.length && !confirm(noInput.map(function (e) { return e.name; }).join('、')
              + ' さんの希望が未入力です。\nこのままだとシフトに入りません。作成しますか？')) return;
            switchTab('shift'); doGenerate();
          }
        }),
        el('button', { class: 'btn ghost', text: '希望ファイルを読み込む', onclick: function () { document.getElementById('fileRequests').click(); } }),
        el('button', { class: 'btn ghost', text: 'コードを貼り付けて取り込む', onclick: importCodeDialog }),
        el('button', { class: 'btn ghost', text: 'スタッフ用の入力ページ', onclick: showInputPageLink })
      ]),
      el('div', { class: 'scroll' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['氏名', '入力状況', ''].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, statusRows)
      ])])
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

    p.appendChild(card('希望一覧（責任者が直接編集も可）', 'クリックで切り替わります。', [
      el('div', { class: 'legend' }, [
        el('span', { class: 'req-off', text: '△ 休み希望（できれば）' }),
        el('span', { class: 'req-must', text: '× 絶対休' }),
        el('span', { class: 'req-paid', text: '有 有給' }),
        el('span', { class: 'req-want', text: '◎ 出勤希望' })
      ]),
      el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [head]), el('tbody', {}, body)])])
    ]));
  }

  function showStaffLink(e) {
    var base = '';
    try { base = (typeof location !== 'undefined') ? (location.origin + location.pathname) : 'index.html'; }
    catch (err) { base = 'index.html'; }
    var url = base + '?staff=' + encodeURIComponent(e.id);
    var ta = el('textarea', { readonly: 'readonly', style: 'width:100%;height:70px;font-family:monospace;font-size:12px' });
    ta.value = url;
    var b = el('div', {}, [
      el('p', { class: 'hint', text: 'このURLを開くと、' + e.name + ' さんの希望提出画面だけが表示されます（管理用の設定は出ません）。' }),
      ta,
      el('p', { class: 'hint', style: 'margin-top:10px', text: '※ データはこのブラウザにだけ保存されます。別の端末では共有されません。スタッフのスマホで入力してもらう場合は［スタッフ用の入力ページ］を使ってください。' })
    ]);
    modal('スタッフ用リンク', b, [
      el('button', {
        class: 'btn', text: 'コピーする', onclick: function () {
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(url);
            toast('コピーしました');
          } catch (err2) { toast('コピーできませんでした'); }
        }
      }),
      el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })
    ]);
  }

  /** スタッフに配る入力ページのURL */
  function showInputPageLink() {
    var base = '';
    try { base = (typeof location !== 'undefined') ? (location.origin + location.pathname) : 'index.html'; }
    catch (err) { base = 'index.html'; }
    var url = base + '?input=1';
    var ta = el('textarea', { readonly: 'readonly', style: 'width:100%;height:60px;font-family:monospace;font-size:12px' });
    ta.value = url;
    modal('スタッフ用の入力ページ', el('div', {}, [
      el('p', {}, [el('strong', { text: '使い方' })]),
      el('p', { class: 'hint', text: '1. このURLをスタッフに送る（LINEなど）' }),
      el('p', { class: 'hint', text: '2. スタッフは名前と、行ける日・時間を入力して［ファイルに保存］' }),
      el('p', { class: 'hint', text: '3. できたファイルを店長に送り返してもらう' }),
      el('p', { class: 'hint', text: '4. この画面の［希望ファイルを読み込む］でまとめて取り込む（何人分でも一度に選べます）' }),
      ta
    ]), [
      el('button', {
        class: 'btn', text: 'コピー', onclick: function () {
          try { if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(url); toast('コピーしました'); }
          catch (e) { toast('コピーできませんでした'); }
        }
      }),
      el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })
    ]);
  }

  /** 希望ファイルをまとめて読み、誰のものかを確認してから取り込む */
  function importRequestFiles(files) {
    var items = [], ngList = [], pending = files.length;
    if (!pending) return;
    Array.prototype.forEach.call(files, function (f) {
      var r = new FileReader();
      r.onload = function () {
        try { items.push({ src: f.name, obj: decodeCode(r.result) }); }
        catch (err) { ngList.push(f.name + '：' + err.message); }
        if (--pending === 0) showAssignDialog(items, ngList);
      };
      r.onerror = function () { ngList.push(f.name + '：読めませんでした'); if (--pending === 0) showAssignDialog(items, ngList); };
      r.readAsText(f);
    });
  }

  /** 「これは誰の希望か」をプルダウンで確認してから取り込む画面 */
  function showAssignDialog(items, ngList) {
    ngList = ngList || [];
    if (!items.length) {
      modal('読み込み結果', el('div', {}, ngList.map(function (m) {
        return el('div', { class: 'vd', text: '・' + m });
      })), [el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })]);
      return;
    }

    var ym = D.settings.year + '-' + U.pad(D.settings.month);
    var rows = items.map(function (it, i) {
      var guess = Store.guessEmployee(it.obj);
      it.targetId = guess ? guess.id : '__new__';

      var opts = [{ v: '__new__', t: '＋ 新しく登録する（' + (it.obj.name || '名前なし') + '）' }]
        .concat(D.employees.map(function (e) { return { v: e.id, t: e.name }; }));
      var sel = select(opts, it.targetId, function (ev) { it.targetId = ev.target.value; });

      var days = Object.keys(it.obj.avail || {}).length;
      var monthNg = it.obj.ym && it.obj.ym !== ym;
      it.skip = monthNg;

      return el('tr', {}, [
        el('td', {}, [
          el('strong', { text: it.obj.name || '（名前なし）' }),
          el('div', { class: 'vd', text: it.src })
        ]),
        el('td', { class: 'nowrap', text: (it.obj.ym || '?') + '　' + days + '日分' }),
        el('td', {}, monthNg
          ? [el('span', { class: 'badge ng', text: '対象月が違うため取り込みません' })]
          : [sel])
      ]);
    });

    var body = el('div', {}, [
      el('p', { class: 'hint', text: 'これは誰の希望か確認してください。名前が一致した人は最初から選ばれています。' }),
      el('table', {}, [
        el('thead', {}, [el('tr', {}, ['データ', '対象月・件数', '誰の希望か'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])
    ].concat(ngList.length ? [el('h4', { text: '読めなかったもの', style: 'margin-top:12px' })]
      .concat(ngList.map(function (m) { return el('div', { class: 'vd', text: '・' + m }); })) : []));

    modal('希望の取り込み', body, [
      el('button', { class: 'btn ghost', text: 'やめる', onclick: closeModal }),
      el('button', {
        class: 'btn', text: '取り込む', onclick: function () {
          var done = [], failed = [];
          items.forEach(function (it) {
            if (it.skip) { failed.push((it.obj.name || it.src) + '：対象月が違います'); return; }
            try {
              var id = it.targetId;
              if (id === '__new__') id = Store.addEmployee(it.obj.name || '新しい従業員').id;
              var emp = Store.importSubmission(it.obj, id);
              done.push(emp.name);
            } catch (err) { failed.push((it.obj.name || it.src) + '：' + err.message); }
          });
          closeModal(); D = Store.get(); render();
          if (failed.length) {
            modal('取り込み結果', el('div', {}, [
              done.length ? el('p', { text: '取り込めた人：' + done.join('、') }) : null,
              el('h4', { text: '取り込めなかったもの', style: 'margin-top:10px' })
            ].concat(failed.map(function (m) { return el('div', { class: 'vd', text: '・' + m }); }))),
              [el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })]);
          } else {
            toast(done.length + '人分の希望を取り込みました（' + done.join('、') + '）');
          }
        }
      })
    ]);
  }

  function importCodeDialog() {
    var ta = el('textarea', { placeholder: 'ここにコードを貼り付け（複数人分を続けて貼ってもOK）', style: 'width:100%;height:140px;font-family:monospace;font-size:11px' });
    var msg = el('p', { class: 'hint', text: 'スタッフから受け取ったコードを貼り付けて［確認へ進む］を押してください。' });
    modal('コードの取り込み', el('div', {}, [msg, ta]), [
      el('button', {
        class: 'btn', text: '確認へ進む', onclick: function () {
          // 改行区切りで複数貼られても拾えるようにする
          var chunks = String(ta.value || '').split(/\s*\n\s*\n\s*|\s*\n(?=SHIFT[01]:)/)
            .map(function (x) { return x.trim(); }).filter(Boolean);
          if (!chunks.length) { msg.textContent = 'コードが入力されていません'; return; }
          var items = [], ng = [];
          chunks.forEach(function (c, i) {
            try { items.push({ src: 'コード' + (i + 1), obj: decodeCode(c) }); }
            catch (err) { ng.push('コード' + (i + 1) + '：読み取れませんでした'); }
          });
          if (!items.length) { msg.textContent = '取り込めるコードがありませんでした'; return; }
          closeModal();
          showAssignDialog(items, ng);
        }
      }),
      el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })
    ]);
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
    var locked = false;

    var rows = dates.map(function (d) {
      var w = U.weekdayOf(d);
      var av = D.avail[e.id] && D.avail[e.id][d] ? D.avail[e.id][d] : null;
      var mode = !av ? '' : av.off ? 'off' : av.allday ? 'allday' : 'time';
      var req = Store.requestOf(e.id, d);

      var fromI = input('time', av && av.from ? av.from : '09:00', function (ev) {
        if (!U.isTime(ev.target.value)) return;
        var cur = D.avail[e.id][d]; cur.from = ev.target.value; Store.save();
      });
      var toI = input('time', av && av.to ? av.to : '18:00', function (ev) {
        if (!U.isTime(ev.target.value)) return;
        var cur = D.avail[e.id][d]; cur.to = ev.target.value; Store.save();
      });
      if (mode !== 'time' || locked) { fromI.disabled = true; toI.disabled = true; }

      var sel = select([
        { v: '', t: '未入力' }, { v: 'allday', t: '終日OK' }, { v: 'time', t: '時間を指定' }, { v: 'off', t: '行けない' }
      ], mode, function (ev) {
        var v = ev.target.value;
        if (!D.avail[e.id]) D.avail[e.id] = {};
        if (v === '') delete D.avail[e.id][d];
        else if (v === 'allday') D.avail[e.id][d] = { allday: true };
        else if (v === 'off') D.avail[e.id][d] = { off: true };
        else D.avail[e.id][d] = { from: fromI.value, to: toI.value };
        Store.save(); render();
      });
      sel.disabled = locked;

      var reqSel = select([
        { v: '', t: '希望なし' }, { v: 'off', t: 'できれば休みたい' }, { v: 'must', t: '絶対に休みたい' },
        { v: 'paid', t: '有給を使いたい' }, { v: 'want', t: 'ぜひ入りたい' }
      ], req, function (ev) {
        if (!D.requests[e.id]) D.requests[e.id] = {};
        if (ev.target.value === '') delete D.requests[e.id][d]; else D.requests[e.id][d] = ev.target.value;
        Store.save(); render();
      });
      reqSel.disabled = locked;

      return el('tr', { class: 'day-row' }, [
        el('td', { class: 'daycell ' + (w === 0 ? 'sun' : w === 6 ? 'sat' : ''), 'data-label': '日付', text: d.slice(5) + '（' + U.WD[w] + '）' }),
        el('td', { 'data-label': '出勤できる？' }, [sel]),
        el('td', { 'data-label': '何時から' }, [fromI]),
        el('td', { 'data-label': '何時まで' }, [toI]),
        el('td', { 'data-label': '希望' }, [reqSel])
      ]);
    });

    var bulk = el('div', { class: 'row', style: 'margin-bottom:10px' }, locked ? [] : [
      el('button', {
        class: 'btn ghost sm', text: '全部「終日OK」', onclick: function () {
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
        class: 'btn ghost sm', text: '全部「時間指定」にする', onclick: function () {
          if (!D.avail[e.id]) D.avail[e.id] = {};
          dates.forEach(function (d) {
            var cur = D.avail[e.id][d];
            if (cur && cur.off) return;
            D.avail[e.id][d] = { from: (cur && cur.from) || '09:00', to: (cur && cur.to) || '18:00' };
          });
          Store.save(); render();
        }
      }),
      el('button', {
        class: 'btn ghost sm danger', text: '入力をクリア', onclick: function () {
          if (!confirm('入力した内容をすべて消します。よろしいですか？')) return;
          delete D.avail[e.id]; delete D.requests[e.id];
          D.submissions[e.id] = { status: 'open', at: '' };
          Store.save(); render();
        }
      })
    ]);

    var doneCount = dates.filter(function (d) { return D.avail[e.id] && D.avail[e.id][d]; }).length;

    var foot = [
      el('button', {
        class: 'btn big', text: 'この内容で提出する', onclick: function () {
          if (doneCount === 0 && !confirm('まだ1日も入力されていません。このまま提出しますか？')) return;
          var now = new Date();
          D.submissions[e.id] = {
            status: 'submitted',
            at: now.getFullYear() + '/' + (now.getMonth() + 1) + '/' + now.getDate() + ' ' + U.pad(now.getHours()) + ':' + U.pad(now.getMinutes())
          };
          Store.save();
          toast(e.name + 'さんの希望を保存しました');
          if (staffOnly) { render(); return; }
          staffView = ''; render();
        }
      }),
      el('button', {
        class: 'btn ghost', text: '提出コードをコピー', title: '別の端末で入力した場合、このコードを責任者に送ってください',
        onclick: function () { showSubmissionCode(e); }
      }),
      staffOnly ? null : el('button', { class: 'btn ghost', text: '閉じる', onclick: function () { staffView = ''; render(); } })
    ];

    var sub = Store.submissionOf(e.id);
    return card(e.name + ' さんの希望提出（' + D.settings.year + '年' + D.settings.month + '月）',
      '行ける日と時間を選んでください。', [
      el('div', { class: 'row', style: 'margin-bottom:8px' }, [
        el('span', { class: 'badge ' + (sub.status === 'submitted' ? 'ok' : 'warn'), text: sub.status === 'submitted' ? '提出済み（' + sub.at + '）' : '未提出' }),
        el('span', { class: 'badge ' + (doneCount === dates.length ? 'ok' : 'warn'), text: '入力 ' + doneCount + ' / ' + dates.length + ' 日' })
      ]),
      bulk,
      el('div', { class: 'scroll staff-table', style: 'max-height:60vh' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['日付', '出勤できる？', '何時から', '何時まで', '希望'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])]),
      el('div', { class: 'row', style: 'margin-top:12px' }, foot)
    ]);
  }

  /* 提出内容をテキストコード化（別端末で入力 → 責任者に送って取り込む用） */
  function showSubmissionCode(e) {
    var code = encodeCode(Store.exportSubmission(e.id));
    var ta = el('textarea', { readonly: 'readonly', style: 'width:100%;height:140px;font-family:monospace;font-size:11px' });
    ta.value = code;
    var b = el('div', {}, [
      el('p', { class: 'hint', text: 'このコードをコピーして、LINEなどで責任者に送ってください。責任者は［③ 希望を入れる］の［コードを貼り付けて取り込む］に貼り付けます。' }),
      ta
    ]);
    modal(e.name + ' さんの提出コード', b, [
      el('button', {
        class: 'btn', text: 'コピーする', onclick: function () {
          try {
            if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(code);
            else { ta.select && ta.select(); document.execCommand && document.execCommand('copy'); }
            toast('コピーしました');
          } catch (err) { toast('コピーできませんでした。手動で選択してください'); }
        }
      }),
      el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })
    ]);
  }

  function encodeCode(obj) {
    var json = JSON.stringify(obj);
    try { return 'SHIFT1:' + btoa(unescape(encodeURIComponent(json))); }
    catch (err) { return 'SHIFT0:' + json; }
  }
  function decodeCode(text) {
    text = String(text || '').trim();
    if (text.indexOf('SHIFT1:') === 0) return JSON.parse(decodeURIComponent(escape(atob(text.slice(7)))));
    if (text.indexOf('SHIFT0:') === 0) return JSON.parse(text.slice(7));
    return JSON.parse(text);   // 生のJSONも受け付ける
  }

  /* ================= ④ シフト表 ================= */
  function renderShift() {
    var p = document.getElementById('panel-shift'); p.innerHTML = '';
    var dates = Store.monthDates();
    var res = D.lastResult;

    var head = el('div', { class: 'row', style: 'margin-bottom:8px;align-items:center' }, [
      el('button', { class: 'btn ghost sm', text: '◀ 前月', onclick: function () { moveMonth(-1); } }),
      el('strong', { style: 'font-size:16px', text: D.settings.year + '年 ' + D.settings.month + '月' }),
      el('button', { class: 'btn ghost sm', text: '翌月 ▶', onclick: function () { moveMonth(1); } }),
      el('span', { style: 'width:12px' }),
      el('button', { class: 'btn big', text: 'シフトを自動作成', onclick: doGenerate }),
      el('button', {
        class: 'btn ghost', text: 'この月を空にする', onclick: function () {
          if (!confirm(D.settings.month + '月のシフトを消します。よろしいですか？（他の月は残ります）')) return;
          var prefix = D.settings.year + '-' + U.pad(D.settings.month);
          Object.keys(D.assignments).forEach(function (dt) { if (dt.indexOf(prefix) === 0) delete D.assignments[dt]; });
          D.lastResult = null; saveAndRender();
        }
      }),
      el('button', { class: 'btn ghost', text: 'CSV出力', onclick: exportCsv }),
      el('button', {
        class: 'btn ghost', text: '印刷', onclick: function () {
          if (typeof window !== 'undefined' && window.print) window.print();
        }
      })
    ]);
    p.appendChild(head);

    var prevPrefix = U.addDays(D.settings.year + '-' + U.pad(D.settings.month) + '-01', -1).slice(0, 7);
    var hasPrev = Object.keys(D.assignments).some(function (dt) { return dt.indexOf(prevPrefix) === 0; });
    p.appendChild(el('p', { class: 'hint', style: 'margin:-4px 0 10px', text: hasPrev
      ? '前月（' + prevPrefix + '）のシフトも保存されています。月をまたぐ連勤・夜勤明け・夜勤/土日の公平性に自動で反映されます。'
      : '前月のシフトがまだありません。前月を作っておくと、月をまたぐ連勤や夜勤の偏りも調整されます。' }));

    /* 作成前チェック：作る前に分かる問題を先に出す */
    var pre = preflight();
    if (pre.length) {
      p.appendChild(card('作成前チェック', null,
        pre.map(function (x) {
          return el('div', { class: 'violation ' + (x.level === 'ng' ? 'hard' : '') }, [
            el('div', { class: 'vt', text: x.msg }),
            x.hint ? el('div', { class: 'vd', text: x.hint }) : null
          ]);
        })));
    }

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

    var zc = zeroDayCard();
    if (zc) p.appendChild(zc);

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
          td = el('td', { class: 'cell-shift', text: st.short || st.name, style: 'background:' + st.color + '4d;color:inherit' });
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

    p.appendChild(card('シフト表', 'セルをクリックすると、勤務の変更と「急に休むときの代わりさがし」ができます。', [
      el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [thead]), el('tbody', {}, rows.concat(needRows))])])
    ]));
  }

  /** 作成前に分かる問題を洗い出す */
  function preflight() {
    var out = [];
    var dates = Store.monthDates();

    if (!D.employees.length) { out.push({ level: 'ng', msg: '従業員が1人も登録されていません', hint: '「② 従業員」で追加してください' }); return out; }

    var totalNeed = 0;
    dates.forEach(function (d) { D.shiftTypes.forEach(function (st) { totalNeed += Store.needOf(d, st.id); }); });
    if (totalNeed === 0) out.push({ level: 'ng', msg: '必要人数が全部0人です', hint: '「① 基本設定」の必要人数（曜日別）を入れてください' });

    // 供給と需要のざっくり比較
    var capacity = D.employees.reduce(function (a, e) { return a + (e.maxDays || 0); }, 0);
    if (totalNeed > capacity)
      out.push({
        level: 'warn', msg: '必要な延べ人数（' + totalNeed + '人日）が、全員の最大出勤日数の合計（' + capacity + '人日）を超えています',
        hint: '人手が足りません。必要人数を下げるか、最大出勤日数を見直すか、増員が必要です'
      });

    // 勤務区分ごとに担当できる人がいるか
    D.shiftTypes.forEach(function (st) {
      var need = dates.some(function (d) { return Store.needOf(d, st.id) > 0; });
      if (!need) return;
      var n = D.employees.filter(function (e) { return (e.canShift || []).indexOf(st.id) >= 0; }).length;
      if (n === 0) out.push({ level: 'ng', msg: st.name + 'を担当できる人が1人もいません', hint: '「② 従業員」の「担当できる勤務区分」を確認してください' });
      var rr = (D.demand.roleReq || {})[st.id] || {};
      if (rr.leader && !D.employees.some(function (e) { return e.leader && (e.canShift || []).indexOf(st.id) >= 0; }))
        out.push({ level: 'ng', msg: st.name + 'は責任者必須ですが、担当できる責任者がいません' });
      if (rr.certified && !D.employees.some(function (e) { return e.certified && (e.canShift || []).indexOf(st.id) >= 0; }))
        out.push({ level: 'ng', msg: st.name + 'は有資格者必須ですが、担当できる有資格者がいません' });
    });

    // 新人に対する教育担当
    var newbies = D.employees.filter(function (e) { return e.newbie; });
    if (newbies.length && !D.employees.some(function (e) { return (e.trainer || e.leader) && !e.newbie; }))
      out.push({ level: 'ng', msg: '新人がいますが、教育担当（またはリーダー）が誰も登録されていません', hint: '新人を配置できず、勤務が入りません' });

    // 休憩不足
    D.shiftTypes.forEach(function (st) {
      var c = Store.stCalc(st);
      if ((c.work > 480 && st.breakMin < 60) || (c.work > 360 && st.breakMin < 45))
        out.push({ level: 'ng', msg: st.name + 'の休憩時間が法定を下回っています（実働' + U.min2h(c.work) + 'h / 休憩' + st.breakMin + '分）' });
    });

    // 希望の入力状況（入力がない日は出勤させない仕様なので、ここが一番効く）
    var noInput = D.employees.filter(function (e) {
      return !dates.some(function (d) { return D.avail[e.id] && D.avail[e.id][d]; });
    });
    if (noInput.length)
      out.push({
        level: 'ng', msg: noInput.map(function (e) { return e.name; }).join('、') + ' さんの希望が未入力です',
        hint: '入力がない日は出勤させないため、この人たちはシフトに入りません。「③ 希望を入れる」で入力してください'
      });
    var partial = D.employees.filter(function (e) {
      if (noInput.indexOf(e) >= 0) return false;
      return dates.filter(function (d) { return D.avail[e.id] && D.avail[e.id][d]; }).length < dates.length;
    });
    if (partial.length)
      out.push({
        level: 'warn', msg: partial.map(function (e) { return e.name; }).join('、') + ' さんは一部の日が未入力です',
        hint: '未入力の日は出勤しない扱いになります'
      });

    return out;
  }

  /** 今月まだ1日も入っていない人（希望の取り込み漏れに気づくため） */
  function zeroDayStaff() {
    var dates = Store.monthDates();
    return D.employees.map(function (e) {
      var days = dates.filter(function (d) { return shiftOfEmp(e.id, d); }).length;
      if (days > 0) return null;
      var inputDays = dates.filter(function (d) { return D.avail[e.id] && D.avail[e.id][d]; }).length;
      var okDays = dates.filter(function (d) {
        var av = Store.availOf(e.id, d);
        return av && av !== false;
      }).length;
      var reason = inputDays === 0 ? '希望が未入力（取り込まれていません）'
        : okDays === 0 ? '本人が全日「行けない」と入力'
          : '希望はあるが、条件が合わず入りませんでした';
      return { emp: e, reason: reason, inputDays: inputDays };
    }).filter(Boolean);
  }

  function zeroDayCard() {
    var zs = zeroDayStaff();
    if (!zs.length) return null;
    return card('今月シフトが0日の人（' + zs.length + '名）',
      '希望の取り込み漏れがないか確認してください。', zs.map(function (z) {
        return el('div', { class: 'violation ' + (z.inputDays === 0 ? 'hard' : '') }, [
          el('div', { class: 'vt', text: z.emp.name }),
          el('div', { class: 'vd', text: z.reason }),
          z.inputDays === 0 ? el('button', {
            class: 'btn ghost sm', style: 'margin-top:4px',
            text: 'この人の希望を入力する', onclick: function () { staffView = z.emp.id; switchTab('request'); }
          }) : null
        ]);
      }));
  }

  function stat(k, v, cls) {
    var color = cls === 'ng' ? 'color:var(--ng)' : cls === 'warn' ? 'color:var(--warn)' : cls === 'ok' ? 'color:var(--ok)' : '';
    return el('div', { class: 'stat' }, [
      el('div', { class: 'k', text: k }),
      el('div', { class: 'v', style: color, text: v })
    ]);
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

    // 急な欠勤への対応（いちばん使う操作なので最上部に出す）
    if (cur) {
      b.appendChild(el('div', { class: 'row', style: 'margin:16px 0' }, [
        el('button', {
          class: 'btn', text: 'この人が休む → 代わりを探す',
          onclick: function () { absenceDialog(e, date, cur); }
        })
      ]));
    }

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

  /* ================= 欠員対応 ================= */
  /** 「この人が急に休む」→ 代わりを4段階で提示する */
  function absenceDialog(emp, date, stId) {
    var st = Store.stById(stId);
    var o = Solver.coverageOptions(D, D.assignments, date, stId, emp.id);
    var w = U.WD[U.weekdayOf(date)];
    var head = (+date.slice(5, 7)) + '月' + (+date.slice(8)) + '日（' + w + '）' + st.name;

    function pickBtn(id, name, cls, confirmMsg) {
      return el('button', {
        class: 'btn ' + (cls || ''), text: name, onclick: function () {
          if (confirmMsg && !confirm(confirmMsg)) return;
          setCell(emp.id, date, '');      // 休む人を外す
          setCell(id, date, stId);        // 代わりを入れる
          closeModal();
          toast(name + 'さんに交代しました');
        }
      });
    }

    var b = el('div', {}, []);
    b.appendChild(el('p', { class: 'hint', text: head + '　' + emp.name + 'さんの代わりを探します。' }));

    /* ① すぐ入れる */
    b.appendChild(el('h4', { text: 'そのまま入れる人（' + o.ready.length + '名）' }));
    if (o.ready.length) {
      b.appendChild(el('div', { class: 'row', style: 'margin-bottom:4px' },
        o.ready.slice(0, 8).map(function (c) { return pickBtn(c.empId, c.name); })));
      o.ready.slice(0, 3).forEach(function (c) {
        var r = c.why.map(function (x) { return x.label; }).filter(Boolean).join(' / ');
        if (r) b.appendChild(el('div', { class: 'vd', text: '・' + c.name + '：' + r }));
      });
    } else {
      b.appendChild(el('p', { class: 'vd', text: 'ルールを守ったまま入れる人はいません。下の候補から選んでください。' }));
    }

    /* ② 本人に確認すれば入れる */
    if (o.askPerson.length) {
      b.appendChild(el('h4', { text: '本人に聞けば入れるかもしれない人（' + o.askPerson.length + '名）' }));
      b.appendChild(el('p', { class: 'vd', text: '本人の都合の問題だけです。電話して都合がつけば入れられます。' }));
      o.askPerson.forEach(function (c) {
        b.appendChild(el('div', { class: 'violation', style: 'margin-bottom:6px' }, [
          el('div', { class: 'vt', text: c.name }),
          el('div', { class: 'vd', text: c.reason }),
          el('div', { style: 'margin-top:6px' }, [
            pickBtn(c.empId, c.name, 'ghost sm', c.name + 'さんに確認は取れましたか？\n（' + c.reason + '）')
          ])
        ]));
      });
    }

    /* ③ 無理をさせれば入れる */
    if (o.stretch.length) {
      b.appendChild(el('h4', { text: '無理をさせれば入れる人（' + o.stretch.length + '名）' }));
      b.appendChild(el('p', { class: 'vd', text: '法令には触れませんが、店のルールを破ることになります。' }));
      o.stretch.slice(0, 6).forEach(function (c) {
        var msgs = c.breaks.map(function (x) { return x.msg; });
        b.appendChild(el('div', { class: 'violation', style: 'margin-bottom:6px' }, [
          el('div', { class: 'vt', text: c.name })
        ].concat(msgs.map(function (m) { return el('div', { class: 'vd', text: '・' + m }); }))
          .concat([el('div', { style: 'margin-top:6px' }, [
            pickBtn(c.empId, c.name, 'ghost sm', c.name + 'さんを入れると次のようになります。\n\n'
              + msgs.map(function (m) { return '・' + m; }).join('\n') + '\n\nそれでも入れますか？')
          ])])));
      });
    }

    /* ④ 入れられない */
    if (o.blocked.length) {
      var det = el('details', { class: 'rule', style: 'margin-top:12px' }, [
        el('summary', { text: '入れられない人（' + o.blocked.length + '名）' })
      ]);
      o.blocked.forEach(function (c) {
        det.appendChild(el('div', { class: 'vd', text: (c.isLaw ? '【法令】' : '') + c.name + '：' + c.reason }));
      });
      b.appendChild(det);
    }

    modal('欠員の代わりを探す', b, [
      el('button', {
        class: 'btn ghost danger', text: '代わりを立てず人数不足のままにする', onclick: function () {
          setCell(emp.id, date, '');
          closeModal();
          toast(head + ' は1人不足のままです');
        }
      }),
      el('button', { class: 'btn ghost', text: 'やめる', onclick: closeModal })
    ]);
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

  function moveMonth(delta) {
    var m = D.settings.month + delta, y = D.settings.year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    D.settings.year = y; D.settings.month = m;
    D.lastResult = null;
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
    lines.push(['氏名'].concat(dates.map(function (d) { return d.slice(5) + '(' + U.WD[U.weekdayOf(d)] + ')'; })).concat(['日数', '時間']).map(U.csv).join(','));
    D.employees.forEach(function (e) {
      var days = 0, mins = 0;
      var row = [e.name].concat(dates.map(function (d) {
        var stId = shiftOfEmp(e.id, d);
        if (!stId) return '';
        var st = Store.stById(stId); days++; mins += Store.stCalc(st).work;
        return st.name;
      }));
      lines.push(row.concat([days, U.min2h(mins)]).map(U.csv).join(','));
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
    p.appendChild(card('集計', null, [
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

    var zc2 = zeroDayCard();
    if (zc2) p.appendChild(zc2);

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

    /* かんたん設定（プリセット） */
    var PRESETS = {
      balanced: { label: 'バランス重視', desc: '希望と公平性のバランス（初期設定）', w: {} },
      request: { label: '希望重視', desc: '希望休をできるだけ通す。公平性は少し犠牲に', w: { 'OPS-030': 20000, 'OPS-031': 8000, 'OPS-080': 400, 'OPS-081': 300, 'OPS-084': 800 } },
      fair: { label: '公平重視', desc: '夜勤・土日・労働時間の偏りを最小に', w: { 'OPS-030': 4000, 'OPS-031': 1500, 'OPS-080': 2500, 'OPS-081': 1800, 'OPS-084': 3000 } },
      cost: { label: '人件費重視', desc: '単価の高い人の投入を抑える（予算設定が必要）', w: { 'OPS-110': 2500, 'OPS-084': 800, 'OPS-030': 5000 } }
    };
    p.appendChild(card('かんたん設定', '方針を選ぶと、下の重みがまとめて変わります。', [
      el('div', { class: 'row' }, Object.keys(PRESETS).map(function (k) {
        var ps = PRESETS[k];
        return el('button', {
          class: 'btn ghost', text: ps.label, title: ps.desc, onclick: function () {
            Object.keys(ps.w).forEach(function (id) {
              if (!D.ruleConfig[id]) D.ruleConfig[id] = {};
              D.ruleConfig[id].weight = ps.w[id];
            });
            if (k === 'balanced') {
              Object.keys(D.ruleConfig).forEach(function (id) { delete D.ruleConfig[id].weight; });
            }
            saveAndRender(); toast(ps.label + ' に変更しました');
          }
        });
      })),
      el('p', { class: 'hint', style: 'margin-top:8px', text: '法令ルールはどの設定でも守られます。' })
    ]));

    p.appendChild(card('法令ルール（変更不可）', '労働基準法などに基づく制約です。', groups.law.map(ruleRow)));
    p.appendChild(card('運用ルール', '現場に合わせて調整できます。', groups.ops.map(ruleRow)));
  }

  function setRule(id, patch) {
    if (!D.ruleConfig[id]) D.ruleConfig[id] = {};
    Object.keys(patch).forEach(function (k) {
      if (k === 'params') D.ruleConfig[id].params = Object.assign({}, D.ruleConfig[id].params || {}, patch.params);
      else D.ruleConfig[id][k] = patch[k];
    });
    saveAndRender();
  }

  /* ================= スタッフ入力ページ（?input=1） =================
     店の設定が何もなくても単体で動く。名前と行ける日時を入れてファイルに保存し、
     それを責任者が読み込む。手入力の手間をなくすための画面。 */
  var inputDraft = null;

  function loadDraft() {
    if (inputDraft) return inputDraft;
    var saved = null;
    try {
      if (typeof localStorage !== 'undefined') saved = JSON.parse(localStorage.getItem('shift-input-draft') || 'null');
    } catch (e) { saved = null; }
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth() + 2;      // 既定は翌月
    if (m > 12) { m = 1; y++; }
    inputDraft = saved && saved.avail ? saved : { name: '', year: y, month: m, avail: {}, requests: {} };
    return inputDraft;
  }
  function saveDraft() {
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem('shift-input-draft', JSON.stringify(inputDraft));
    } catch (e) { /* 保存できなくても入力は続けられる */ }
  }

  function renderInputPage() {
    var tabsEl = document.getElementById('tabs');
    if (tabsEl && tabsEl.style) tabsEl.style.display = 'none';
    var ha = document.querySelector ? document.querySelector('.header-actions') : null;
    if (ha && ha.style) ha.style.display = 'none';
    ['setup', 'staff', 'shift', 'summary', 'rules'].forEach(function (n) {
      var pn = document.getElementById('panel-' + n);
      if (pn) { pn.innerHTML = ''; pn.classList.add('hidden'); }
    });

    var dr = loadDraft();
    var p = document.getElementById('panel-request');
    p.classList.remove('hidden');
    p.innerHTML = '';

    var dates = U.monthDates(dr.year, dr.month);
    var filled = dates.filter(function (d) { return dr.avail[d]; }).length;

    /* 名前と対象月 */
    p.appendChild(card('シフト希望の入力', '名前と、行ける日・時間を入れて、いちばん下の［ファイルに保存］を押してください。', [
      el('div', { class: 'row' }, [
        el('div', { class: 'field grow' }, [el('label', { text: 'あなたの名前' }),
        input('text', dr.name, function (e) { dr.name = e.target.value; saveDraft(); }, { placeholder: '例）山田 太郎' })]),
        field('年', input('number', dr.year, function (e) { dr.year = U.num(e.target.value, 2000, 2100, dr.year); saveDraft(); render(); }, { min: 2000, max: 2100 })),
        field('月', select([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (mm) { return { v: mm, t: mm + '月' }; }), dr.month,
          function (e) { dr.month = +e.target.value; saveDraft(); render(); }))
      ]),
      el('div', { class: 'row', style: 'margin-top:12px' }, [
        el('button', {
          class: 'btn ghost sm', text: '全部「終日OK」', onclick: function () {
            dates.forEach(function (d) { dr.avail[d] = { allday: true }; }); saveDraft(); render();
          }
        }),
        el('button', {
          class: 'btn ghost sm', text: '平日だけ終日OK', onclick: function () {
            dates.forEach(function (d) {
              var w = U.weekdayOf(d);
              dr.avail[d] = (w === 0 || w === 6) ? { off: true } : { allday: true };
            });
            saveDraft(); render();
          }
        }),
        el('button', {
          class: 'btn ghost sm danger', text: '入力を消す', onclick: function () {
            if (!confirm('入力した内容をすべて消します。よろしいですか？')) return;
            dr.avail = {}; dr.requests = {}; saveDraft(); render();
          }
        }),
        el('span', { class: 'badge ' + (filled === dates.length ? 'ok' : 'warn'), text: '入力 ' + filled + ' / ' + dates.length + ' 日' })
      ])
    ]));

    /* 日ごとの入力 */
    var rows = dates.map(function (d) {
      var w = U.weekdayOf(d);
      var av = dr.avail[d] || null;
      var mode = !av ? '' : av.off ? 'off' : av.allday ? 'allday' : 'time';

      var fromI = input('time', av && av.from ? av.from : '09:00', function (ev) {
        if (!U.isTime(ev.target.value)) return;
        dr.avail[d].from = ev.target.value; saveDraft();
      });
      var toI = input('time', av && av.to ? av.to : '18:00', function (ev) {
        if (!U.isTime(ev.target.value)) return;
        dr.avail[d].to = ev.target.value; saveDraft();
      });
      if (mode !== 'time') { fromI.disabled = true; toI.disabled = true; }

      var sel = select([
        { v: '', t: '未入力' }, { v: 'allday', t: '終日OK' }, { v: 'time', t: '時間を指定' }, { v: 'off', t: '行けない' }
      ], mode, function (ev) {
        var v = ev.target.value;
        if (v === '') delete dr.avail[d];
        else if (v === 'allday') dr.avail[d] = { allday: true };
        else if (v === 'off') dr.avail[d] = { off: true };
        else dr.avail[d] = { from: fromI.value, to: toI.value };
        saveDraft(); render();
      });

      var reqSel = select([
        { v: '', t: '希望なし' }, { v: 'off', t: 'できれば休みたい' }, { v: 'must', t: '絶対に休みたい' },
        { v: 'paid', t: '有給を使いたい' }, { v: 'want', t: 'ぜひ入りたい' }
      ], dr.requests[d] || '', function (ev) {
        if (ev.target.value === '') delete dr.requests[d]; else dr.requests[d] = ev.target.value;
        saveDraft();
      });

      var hol = Store.holidayName(d);
      return el('tr', { class: 'day-row' }, [
        el('td', {
          class: 'daycell ' + (w === 0 || hol ? 'sun' : w === 6 ? 'sat' : ''),
          'data-label': '日付', text: (+d.slice(8)) + '日（' + U.WD[w] + '）' + (hol ? ' ' + hol : '')
        }),
        el('td', { 'data-label': '出勤できる？' }, [sel]),
        el('td', { 'data-label': '何時から' }, [fromI]),
        el('td', { 'data-label': '何時まで' }, [toI]),
        el('td', { 'data-label': '希望' }, [reqSel])
      ]);
    });

    p.appendChild(card('', '', [
      el('div', { class: 'scroll staff-table', style: 'max-height:60vh' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['日付', '出勤できる？', '何時から', '何時まで', '希望'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])]),
      el('div', { class: 'row', style: 'margin-top:14px' }, [
        el('button', { class: 'btn big', text: 'ファイルに保存する', onclick: saveInputFile }),
        el('button', { class: 'btn ghost', text: 'コードでコピーする', onclick: copyInputCode })
      ]),
      el('p', { class: 'hint', style: 'margin-top:8px', text: '保存したファイル（またはコピーしたコード）を責任者に送ってください。入力内容はこの端末に残るので、閉じても続きから入力できます。' })
    ]));
  }

  function inputPayload() {
    var dr = loadDraft();
    if (!dr.name.trim()) { alert('名前を入れてください'); return null; }
    return {
      t: 'shift-submission', v: 1, name: dr.name.trim(), id: '',
      ym: dr.year + '-' + U.pad(dr.month),
      avail: dr.avail, requests: dr.requests
    };
  }

  function saveInputFile() {
    var obj = inputPayload(); if (!obj) return;
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'シフト希望_' + obj.name + '_' + obj.ym + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('保存しました。責任者に送ってください');
  }

  function copyInputCode() {
    var obj = inputPayload(); if (!obj) return;
    var code = encodeCode(obj);
    var ta = el('textarea', { readonly: 'readonly', style: 'width:100%;height:140px;font-family:monospace;font-size:11px' });
    ta.value = code;
    modal('提出コード', el('div', {}, [
      el('p', { class: 'hint', text: 'このコードをコピーして、LINEなどで責任者に送ってください。' }), ta
    ]), [
      el('button', {
        class: 'btn', text: 'コピー', onclick: function () {
          try { if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(code); toast('コピーしました'); }
          catch (e) { toast('手動で選択してコピーしてください'); }
        }
      }),
      el('button', { class: 'btn ghost', text: '閉じる', onclick: closeModal })
    ]);
  }

  /* ================= スタッフ専用モード（?staff=従業員ID） ================= */
  function renderStaffOnly() {
    // 管理用のタブ・操作を隠す
    var tabsEl = document.getElementById('tabs');
    if (tabsEl && tabsEl.style) tabsEl.style.display = 'none';
    var ha = document.querySelector ? document.querySelector('.header-actions') : null;
    if (ha && ha.style) ha.style.display = 'none';
    ['setup', 'staff', 'shift', 'summary', 'rules'].forEach(function (n) {
      var pn = document.getElementById('panel-' + n);
      if (pn) { pn.innerHTML = ''; pn.classList.add('hidden'); }
    });

    var p = document.getElementById('panel-request');
    p.classList.remove('hidden');
    p.innerHTML = '';
    var e = Store.empById(staffOnly);
    if (!e) {
      p.appendChild(card('スタッフが見つかりません',
        'このリンクの従業員（' + staffOnly + '）は登録されていません。責任者にリンクを確認してください。', []));
      return;
    }

    // シフトが出来ていればそちらを先に見せる（スタッフが一番知りたいのは「自分がいつ入るか」）
    var mine = myShifts(e.id);
    if (!staffPage) staffPage = mine.length ? 'shift' : 'submit';

    p.appendChild(el('div', { class: 'row', style: 'margin-bottom:12px' }, [
      el('button', {
        class: 'btn ' + (staffPage === 'shift' ? '' : 'ghost'), text: '自分のシフト' + (mine.length ? '（' + mine.length + '日）' : ''),
        onclick: function () { staffPage = 'shift'; render(); }
      }),
      el('button', {
        class: 'btn ' + (staffPage === 'submit' ? '' : 'ghost'), text: '希望を出す',
        onclick: function () { staffPage = 'submit'; render(); }
      })
    ]));

    if (staffPage === 'shift') p.appendChild(myShiftCard(e, mine));
    else p.appendChild(staffSubmitCard(e, Store.monthDates()));
  }

  /** その人の今月の勤務を並べる */
  function myShifts(empId) {
    return Store.monthDates().map(function (date) {
      var stId = shiftOfEmp(empId, date);
      if (!stId) return null;
      var st = Store.stById(stId);
      if (!st) return null;
      return { date: date, st: st, calc: Store.stCalc(st) };
    }).filter(Boolean);
  }

  function myShiftCard(e, mine) {
    if (!mine.length) {
      return card(e.name + ' さんのシフト（' + D.settings.year + '年' + D.settings.month + '月）', '', [
        el('p', { text: 'この月のシフトはまだ出ていません。' }),
        el('p', { class: 'hint', text: '責任者がシフトを作成すると、このページに表示されます。先に「希望を出す」から希望を提出しておいてください。' })
      ]);
    }

    var totalMin = mine.reduce(function (a, m) { return a + m.calc.work; }, 0);
    var nights = mine.filter(function (m) { return m.calc.night > 0; }).length;

    var rows = mine.map(function (m) {
      var w = U.weekdayOf(m.date);
      var end = m.calc.overnight ? m.st.end + '（翌日）' : m.st.end;
      return el('tr', { class: 'day-row' }, [
        el('td', {
          class: 'daycell ' + (w === 0 || Store.isHoliday(m.date) ? 'sun' : w === 6 ? 'sat' : ''),
          'data-label': '日付', text: (+m.date.slice(8)) + '日（' + U.WD[w] + '）'
        }),
        el('td', { 'data-label': '勤務' }, [
          el('span', { class: 'chip', style: 'background:' + m.st.color + '55;border-color:' + m.st.color + ';color:inherit', text: m.st.name })
        ]),
        el('td', { 'data-label': '時間', text: m.st.start + ' 〜 ' + end }),
        el('td', { 'data-label': '休憩', text: m.st.breakMin + '分' }),
        el('td', { 'data-label': '実働', text: U.min2h(m.calc.work) + 'h' })
      ]);
    });

    return card(e.name + ' さんのシフト（' + D.settings.year + '年' + D.settings.month + '月）',
      null, [
      el('div', { class: 'grid2', style: 'margin-bottom:12px' }, [
        stat('出勤日数', mine.length + ' 日'),
        stat('実働時間', U.min2h(totalMin) + ' h'),
        nights ? stat('夜勤', nights + ' 回') : null,
        stat('次の出勤', nextShiftLabel(mine))
      ].filter(Boolean)),
      el('div', { class: 'scroll staff-table', style: 'max-height:60vh' }, [el('table', {}, [
        el('thead', {}, [el('tr', {}, ['日付', '勤務', '時間', '休憩', '実働'].map(function (h) { return el('th', { text: h }); }))]),
        el('tbody', {}, rows)
      ])]),
      el('div', { class: 'row', style: 'margin-top:12px' }, [
        el('button', { class: 'btn ghost', text: '印刷', onclick: function () { if (typeof window !== 'undefined' && window.print) window.print(); } })
      ])
    ]);
  }

  function nextShiftLabel(mine) {
    var t = new Date();
    var today = t.getFullYear() + '-' + U.pad(t.getMonth() + 1) + '-' + U.pad(t.getDate());
    var next = mine.filter(function (m) { return m.date >= today; })[0];
    if (!next) return 'なし';
    return (+next.date.slice(5, 7)) + '/' + (+next.date.slice(8)) + ' ' + next.st.name;
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
    if (inputMode) return renderInputPage();
    if (staffOnly) return renderStaffOnly();
    if (currentTab === 'setup') renderSetup();
    if (currentTab === 'staff') renderStaff();
    if (currentTab === 'request') renderRequest();
    if (currentTab === 'shift') renderShift();
    if (currentTab === 'summary') renderSummary();
    if (currentTab === 'rules') renderRules();

    // どのタブでも先頭に「いまどこまで進んでいるか」を出す
    var p = document.getElementById('panel-' + currentTab);
    if (p && p.insertBefore && p.children && p.children.length) p.insertBefore(guideBar(), p.children[0]);
    else if (p) p.appendChild(guideBar());
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
  document.getElementById('fileRequests').addEventListener('change', function (e) {
    importRequestFiles(e.target.files);
    e.target.value = '';
  });
  document.getElementById('btnReset').addEventListener('click', function () {
    if (!confirm('すべてのデータを初期状態に戻します。よろしいですか？')) return;
    D = Store.reset(); render(); toast('初期化しました');
  });

  render();
})();
