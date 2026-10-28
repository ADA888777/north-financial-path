/* لوحة المتعلم. كل الأرقام من my_dashboard، ولا قيمة ثابتة واحدة. */
(function () {
  'use strict';
  var L = window.northLearn;
  if (!L) return;
  var db = L.db, el = L.el, esc = L.esc, num = L.num;

  L.guard().then(function (s) { if (s) load(); });

  function load() {
    db.rpc('my_dashboard').then(function (r) {
      if (r.error) { L.deny('تعذّر تحميل اللوحة', r.error.message, false); return; }
      var d = r.data || {};
      if (d.error) { L.deny('تعذّر تحميل اللوحة', d.error, false); return; }
      render(d);
      /* فتح اللوحة يُحتسب يوماً نشطاً */
      db.rpc('touch_activity').then(function () {});
    });
  }

  function render(d) {
    el('hi').textContent = 'أهلاً، ' + (d.name || '');
    el('hi-sub').textContent = d.allowed
      ? 'واصل من حيث توقفت.'
      : 'اشتراكك غير نافذ حالياً، فالمحتوى مقفل.';

    /* ---- الشرائح ---- */
    var chips = [];
    if (d.membership_no) {
      chips.push('<span class="chip-i"><span class="ms">badge</span> رقم العضوية ' +
        '<span class="num">' + esc(d.membership_no) + '</span></span>');
    }
    if (d.plan) chips.push('<span class="chip-i"><span class="ms">workspace_premium</span> ' + esc(d.plan) + '</span>');
    chips.push(d.allowed
      ? '<span class="chip-i ok"><span class="ms">verified</span> اشتراك نافذ</span>'
      : '<span class="chip-i off"><span class="ms">lock</span> اشتراك غير نافذ</span>');
    chips.push('<span class="chip-i"><span class="ms">trending_up</span> أنجزت ' +
      num(d.percent) + '٪</span>');
    el('chips').innerHTML = chips.join('');

    /* ---- متابعة التعلم ---- */
    var target = d.last_lesson || d.next_lesson;
    el('resume-box').innerHTML = target
      ? '<div class="resume">' +
          '<div><span class="lbl">' +
            (d.last_lesson ? 'آخر درس وصلت إليه' : 'ابدأ من هنا') + '</span>' +
            '<b>' + esc(target.title) + '</b></div>' +
          '<a class="btn btn-light" href="lesson.html?id=' + encodeURIComponent(target.id) + '">متابعة التعلم</a>' +
        '</div>'
      : '';

    /* ---- المستويات ---- */
    var lv = d.levels || [];
    el('levels').innerHTML = lv.length ? lv.map(function (x) {
      var p = L.pct(x.done, x.total);
      var full = x.total > 0 && x.done >= x.total;
      return '<div class="lvl">' +
        '<div class="lvl-h"><b>' + esc(x.title) + '</b>' +
          '<span>' + num(x.done) + ' من ' + num(x.total) + '</span></div>' +
        L.bar(p) +
        '<div class="lvl-f">' +
          '<span style="font-size:12.5px;color:var(--fg-2)">' + num(p) + '٪' +
            (full ? ' <span class="done-tag">مكتمل</span>' : '') + '</span>' +
          (x.total > 0
            ? '<a href="level.html?id=' + encodeURIComponent(x.id) + '">استكمال التعلم</a>'
            : '<span style="font-size:12.5px;color:var(--fg-3)">لا دروس منشورة بعد</span>') +
        '</div></div>';
    }).join('') : empty('school', 'لا توجد مستويات منشورة بعد.');

    /* ---- الاختبارات ---- */
    var qz = d.quizzes || [];
    el('quizzes').innerHTML = qz.length ? qz.map(function (q) {
      var state = q.passed
        ? '<span class="done-tag">اجتزته</span>'
        : (q.attempts > 0
            ? '<span style="color:var(--fg-2);font-size:12.5px">أفضل نتيجة ' + num(q.best || 0) + '٪</span>'
            : '<span style="color:var(--fg-3);font-size:12.5px">لم تبدأه</span>');
      return '<div class="qz"><div><b>' + esc(q.title) + '</b>' +
        '<div class="meta">النجاح من ' + num(q.pass_score) + '٪ · محاولات ' + num(q.attempts) + '</div></div>' +
        '<div style="display:flex;align-items:center;gap:12px">' + state +
          '<a class="btn btn-ghost btn-sm" href="quiz.html?id=' + encodeURIComponent(q.id) + '">' +
            (q.attempts > 0 ? 'إعادة' : 'ابدأ') + '</a>' +
        '</div></div>';
    }).join('') : empty('quiz', 'لا توجد اختبارات متاحة بعد.');

    /* ---- الاستمرارية ---- */
    var days = (d.activity || []).map(function (a, i, arr) {
      return '<span class="day' + (a.active ? ' on' : '') +
        (i === arr.length - 1 ? ' today' : '') + '" title="' + esc(a.day) + '"></span>';
    }).join('');
    el('streak').innerHTML =
      '<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px">' +
        '<b style="font-family:var(--display);font-size:32px;font-weight:700">' + num(d.streak) + '</b>' +
        '<span style="color:var(--fg-2);font-size:13.5px">' +
          (d.streak === 1 ? 'يوم متصل' : 'أيام متصلة') + '</span></div>' +
      '<div class="days">' + days + '</div>' +
      '<p class="days-note">آخر 14 يوماً. أطول سلسلة لك ' + num(d.longest_streak) + '. ' +
        (d.active_today ? 'سُجّل نشاطك اليوم.' : 'افتح درساً أو أنجز مهمة ليُحتسب اليوم.') + '</p>';

    /* ---- المهام ---- */
    drawTasks(d.tasks || []);

    /* ---- التنبيهات ---- */
    var alerts = [];
    if (d.account_status !== 'active') {
      alerts.push(['block', 'حسابك موقوف. تواصل مع إدارة المنصة.']);
    } else if (!d.allowed) {
      alerts.push(['lock', 'اشتراكك غير نافذ، فالدروس والاختبارات مقفلة.']);
    } else if (d.subscription_expires_at) {
      var left = Math.ceil((new Date(d.subscription_expires_at) - new Date()) / 864e5);
      if (left <= 14 && left >= 0) {
        alerts.push(['schedule', 'يتبقى على انتهاء اشتراكك ' + num(left) +
          (left === 1 ? ' يوم.' : ' يوماً.')]);
      }
    }
    if (alerts.length) {
      el('alerts-box').hidden = false;
      el('alerts').innerHTML = alerts.map(function (a) {
        return '<div class="task" style="border:none;padding:8px 0">' +
          '<span class="ms" style="color:var(--dn);font-size:20px">' + a[0] + '</span>' +
          '<div><b style="font-weight:500;font-size:14px">' + esc(a[1]) + '</b></div></div>';
      }).join('');
    }
  }

  function empty(icon, text) {
    return '<div class="empty"><span class="ms">' + icon + '</span>' + esc(text) + '</div>';
  }

  function drawTasks(tasks) {
    var box = el('tasks');
    if (!tasks.length) {
      box.innerHTML = empty('task_alt', 'لا توجد مهام لهذا اليوم.');
      return;
    }
    var allDone = tasks.every(function (t) { return t.done; });
    box.innerHTML = tasks.map(function (t) {
      return '<label class="task' + (t.done ? ' is-done' : '') + '">' +
        '<input type="checkbox" data-task="' + esc(t.id) + '"' + (t.done ? ' checked' : '') + '>' +
        '<div><b>' + esc(t.title) + '</b>' +
          (t.description ? '<p>' + esc(t.description) + '</p>' : '') +
        '</div></label>';
    }).join('') +
      (allDone ? '<p class="days-note" style="color:var(--up)">أنجزت مهام اليوم كلها.</p>' : '');

    box.querySelectorAll('input[data-task]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        cb.disabled = true;
        db.rpc('complete_task', { p_task: cb.getAttribute('data-task'), p_done: cb.checked })
          .then(function (r) {
            cb.disabled = false;
            if (r.error || (r.data && r.data.error)) {
              cb.checked = !cb.checked;
              return;
            }
            cb.closest('.task').classList.toggle('is-done', cb.checked);
            load();
          });
      });
    });
  }
})();
