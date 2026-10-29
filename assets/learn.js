/* لوحة المتعلم. لا رقم في هذا الملف: كل ما يُعرض يأتي من
   my_dashboard() و my_learn_extra() و my_map() و beginner_guide(). */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num, bar = L.bar;

  var DAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  // اختصار الحرف الواحد المتعارف عليه. قصّ أول ثلاثة أحرف يعطي
  // «الس» و«الأ» و«الث» فلا يفرّق القارئ بين يوم وآخر.
  var DAY_SHORT = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
  var state = { log: [], range: 30 };

  function dayName(iso) {
    try { return DAY_AR[new Date(iso + 'T00:00:00').getDay()]; } catch (e) { return ''; }
  }
  function dayShort(iso) {
    try { return DAY_SHORT[new Date(iso + 'T00:00:00').getDay()]; } catch (e) { return ''; }
  }
  function shortDate(iso) {
    try {
      return new Intl.DateTimeFormat('ar-SA', { day: 'numeric', month: 'short' })
        .format(new Date(iso + 'T00:00:00'));
    } catch (e) { return iso; }
  }
  function when(iso) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('ar-SA', {
        dateStyle: 'medium', timeStyle: 'short'
      }).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 16); }
  }
  function empty(t) { return '<p class="empty">' + esc(t) + '</p>'; }

  /* ---------- 1) سلسلة التعلم ---------- */
  function streak(d, x) {
    var n = d.streak || 0;
    var line = n === 0
      ? 'ابدأ رحلتك اليوم!'
      : (d.active_today
          ? 'أنجزت اليوم. حافظ على السلسلة.'
          : 'لم تنجز اليوم بعد — درس واحد يكفي لتبقى في السلسلة.');

    var week = (x.week || []).map(function (w) {
      var cls = w.active ? 'on' : (w.future ? 'future' : 'off');
      if (w.today) cls += ' today';
      return '<div class="wd ' + cls + '">' +
             '<span class="wd-n" title="' + esc(dayName(w.day)) + '">' +
               esc(dayShort(w.day)) + '</span>' +
             '<i class="wd-o">' + (w.active ? '<span class="ms">check</span>' : '') + '</i>' +
             '</div>';
    }).join('');

    el('streak').innerHTML =
      '<div class="streak-top">' +
        '<div class="streak-n"><b>' + num(n) + '</b><span>' +
          (n === 1 ? 'يوم متتالٍ' : 'يوماً متتالياً') + '</span></div>' +
        '<p class="streak-msg">' + esc(line) + '</p>' +
      '</div>' +
      '<div class="week" role="list">' + week + '</div>' +
      (d.longest_streak > n
        ? '<p class="streak-best">أطول سلسلة لك: ' + num(d.longest_streak) + ' يوماً</p>' : '');
  }

  /* ---------- 2) ملخص المستوى ---------- */
  function summary(d, x) {
    var lvl = x.current_level;
    var lq = x.last_quiz;
    var nc = x.next_class;

    function card(ico, label, value, note, href) {
      var inner =
        '<span class="ms">' + ico + '</span>' +
        '<span class="s-l">' + esc(label) + '</span>' +
        '<b class="s-v">' + value + '</b>' +
        (note ? '<span class="s-n">' + esc(note) + '</span>' : '');
      return href
        ? '<a class="s-card" href="' + href + '">' + inner + '</a>'
        : '<div class="s-card">' + inner + '</div>';
    }

    el('summary').innerHTML =
      card('school', 'المستوى الحالي',
           esc(lvl ? (lvl.label || lvl.title) : 'لم يبدأ'),
           lvl && lvl.track ? lvl.track : '', lvl ? 'map.html' : null) +
      card('fact_check', 'آخر نتيجة اختبار',
           lq ? num(lq.percent) + '<i>%</i>' : 'لم يبدأ',
           lq ? (lq.passed ? 'ناجح — ' : 'لم يُجتَز — ') + lq.title : '',
           lq ? 'quiz.html?id=' + encodeURIComponent(lq.quiz_id) : null) +
      card('trending_up', 'نسبة التقدم', num(d.percent || 0) + '<i>%</i>',
           '', null) +
      card('menu_book', 'الدروس المكتملة',
           '<span dir="ltr">' + num(d.lessons_done || 0) + '/' + num(d.lessons_total || 0) + '</span>',
           '', 'map.html') +
      card('event', 'الحصة القادمة',
           nc ? esc(nc.title) : 'لا يوجد',
           nc ? when(nc.starts_at) : '',
           nc ? (nc.kind === 'live' ? 'live.html' : 'classes.html')
              : 'live.html');
  }

  /* ---------- 6) تابع التعلم ---------- */
  function resume(d, x) {
    var r = x.resume;
    var l = r || d.last_lesson || d.next_lesson;
    if (!l) {
      el('resume-box').innerHTML =
        '<div class="resume"><div><span class="lbl">ابدأ</span>' +
        '<b>لم تفتح أي درس بعد</b></div>' +
        '<a class="btn btn-light" href="map.html">اختر مرحلتك</a></div>';
      return;
    }
    var id = r ? r.lesson_id : l.id;
    var pos = r ? r.pos : 0;
    el('resume-box').innerHTML =
      '<div class="resume"><div>' +
        '<span class="lbl">تابع التعلم</span>' +
        '<b>' + esc(l.title) + '</b>' +
        (pos > 0 ? '<span class="lbl rp">توقفت عند ' + num(pos) + '% من الدرس</span>' : '') +
      '</div>' +
      '<a class="btn btn-light" href="lesson.html?id=' + encodeURIComponent(id) +
        (pos > 0 ? '&at=' + pos : '') + '">' +
        (pos > 0 ? 'أكمل من حيث وقفت' : 'متابعة التعلم') + '</a></div>';
  }

  /* ---------- 4) مهام اليوم ---------- */
  function tasks(d, x) {
    var lvl = x.current_level;
    var lesson = (x.resume && x.resume.lesson_id) ||
                 (d.next_lesson && d.next_lesson.id) ||
                 (d.last_lesson && d.last_lesson.id) || null;
    var quiz = null;
    (d.quizzes || []).forEach(function (q) {
      if (!quiz && lvl && q.level_id === lvl.id) quiz = q;
    });

    var fixed = [
      { ico: 'play_lesson', t: 'درس اليوم',
        s: lesson ? 'تابع درسك الحالي' : 'لا يوجد درس متاح بعد',
        href: lesson ? 'lesson.html?id=' + encodeURIComponent(lesson) : null },
      { ico: 'style', t: 'البطاقات التعليمية',
        s: lesson ? 'راجع مفردات الدرس' : 'تحتاج درساً أولاً',
        href: lesson ? 'cards.html?lesson=' + encodeURIComponent(lesson) : null },
      { ico: 'auto_stories', t: 'المعلم الذكي',
        s: 'اسأل عن أي مفهوم في الدروس',
        href: 'assistant.html' },
      { ico: 'fitness_center', t: 'التمرين',
        s: quiz ? esc(quiz.title) : 'لا يوجد اختبار في مرحلتك بعد',
        href: quiz ? 'quiz.html?id=' + encodeURIComponent(quiz.id) : null }
    ];

    var html = '<div class="dt">' + fixed.map(function (f) {
      var body =
        '<span class="ms">' + f.ico + '</span>' +
        '<div><b>' + esc(f.t) + '</b><p>' + f.s + '</p></div>' +
        (f.href ? '<span class="ms go">chevron_left</span>' : '');
      return f.href
        ? '<a class="dt-i" href="' + f.href + '">' + body + '</a>'
        : '<div class="dt-i off">' + body + '</div>';
    }).join('') + '</div>';

    // مهام تكتبها الإدارة، إن وُجدت
    var extra = d.tasks || [];
    if (extra.length) {
      html += '<div class="dt-extra"><h3>من الإدارة</h3>' + extra.map(function (t) {
        return '<label class="task"><input type="checkbox" data-task="' + esc(t.id) + '"' +
          (t.done ? ' checked' : '') + '><div><b>' + esc(t.title) + '</b>' +
          (t.description ? '<p>' + esc(t.description) + '</p>' : '') + '</div></label>';
      }).join('') + '</div>';
    }

    el('tasks').innerHTML = html;

    el('tasks').querySelectorAll('input[data-task]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        cb.disabled = true;
        db.rpc('complete_task', { p_task: cb.getAttribute('data-task'), p_done: cb.checked })
          .then(function () { cb.disabled = false; })
          .catch(function () { cb.checked = !cb.checked; cb.disabled = false; });
      });
    });
  }

  /* ---------- 5) نشاط المتعلم ---------- */
  function chart() {
    var log = state.log.slice(-state.range);
    var box = el('activity');
    if (!log.length) { box.innerHTML = empty('لا يوجد نشاط مسجّل بعد.'); return; }

    var max = 0;
    log.forEach(function (d) { if (d.total > max) max = d.total; });
    var total = log.reduce(function (a, d) { return a + d.total; }, 0);
    var days = log.filter(function (d) { return d.total > 0; }).length;

    var w = 100 / log.length;
    var bars = log.map(function (d, i) {
      var h = max > 0 ? (d.total / max) * 100 : 0;
      var lbl = shortDate(d.day) + ': ' +
        (d.total === 0 ? 'بلا نشاط'
          : [d.lessons ? d.lessons + ' درس' : '',
             d.quizzes ? d.quizzes + ' اختبار' : '',
             d.challenge ? d.challenge + ' تحدٍ' : ''].filter(Boolean).join('، '));
      return '<div class="ch-c" style="width:' + w + '%" title="' + esc(lbl) + '">' +
             '<i style="height:' + Math.max(d.total > 0 ? 6 : 2, h) + '%"' +
             (d.total === 0 ? ' class="z"' : '') + '></i></div>';
    }).join('');

    box.innerHTML =
      '<div class="ch" role="img" aria-label="نشاطك خلال ' + state.range + ' يوماً">' + bars + '</div>' +
      '<div class="ch-f"><span>' + esc(shortDate(log[0].day)) + '</span>' +
      '<span>' + esc(shortDate(log[log.length - 1].day)) + '</span></div>' +
      '<p class="ch-s">' + num(total) + ' نشاطاً في ' + num(days) +
      ' يوماً من ' + num(log.length) + '</p>';
  }

  function rangeBtns() {
    var opts = [[14, 'أسبوعان'], [30, 'شهر'], [90, '٣ أشهر']];
    el('act-range').innerHTML = opts.map(function (o) {
      return '<button type="button" data-r="' + o[0] + '"' +
        (o[0] === state.range ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') +
        '>' + o[1] + '</button>';
    }).join('');
    el('act-range').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        state.range = parseInt(b.getAttribute('data-r'), 10);
        rangeBtns(); chart();
      });
    });
  }

  /* ---------- 7) آخر إشعار ---------- */
  function lastNote(x) {
    var n = x.latest_notification;
    el('last-note').innerHTML =
      (n
        ? '<div class="note-last' + (n.read ? '' : ' new') + '">' +
            '<b>' + esc(n.title) + '</b>' +
            (n.body ? '<p>' + esc(n.body) + '</p>' : '') +
            '<span class="when">' + esc(when(n.created_at)) + '</span>' +
          '</div>'
        : empty('لا توجد إشعارات بعد')) +
      '<a class="btn btn-ghost btn-sm btn-wide" href="notifications.html">عرض الإشعارات' +
      (x.unread_count > 0 ? ' (' + num(x.unread_count) + ')' : '') + '</a>';
  }

  /* ---------- 3) دليل المبتدئين ---------- */
  function guide(rows) {
    if (!rows || !rows.length) return;
    el('guide-box').hidden = false;
    el('guide').innerHTML = rows.map(function (g, i) {
      var href = g.first_lesson
        ? 'lesson.html?id=' + encodeURIComponent(g.first_lesson)
        : (g.first_level ? 'level.html?id=' + encodeURIComponent(g.first_level) : 'map.html');
      return '<a class="gstep" href="' + href + '">' +
        '<i class="gs-n">' + num(i + 1) + '</i>' +
        '<div><b>' + esc(g.title) + '</b>' +
        (g.description ? '<p>' + esc(g.description) + '</p>' : '') +
        '<span class="gs-m">' + num(g.lessons) + ' درساً' +
        (g.level_label ? ' · ' + esc(g.level_label) : '') + '</span></div>' +
        '<span class="ms go">chevron_left</span></a>';
    }).join('');
  }

  /* ---------- 8) خارطة مصغّرة ---------- */
  function mapMini(m) {
    var levels = [];
    (m.tracks || []).forEach(function (t) {
      (t.levels || []).forEach(function (l) { levels.push(l); });
    });
    if (!levels.length) {
      el('map-mini').innerHTML = empty('لم تُنشر مراحل بعد.');
      return;
    }
    var ICO = { done: 'check_circle', current: 'play_circle', open: 'radio_button_unchecked', locked: 'lock' };
    var TXT = { done: 'مكتملة', current: 'الحالية', open: 'متاحة', locked: 'مقفلة' };
    el('map-mini').innerHTML =
      '<ol class="mini">' + levels.map(function (l) {
        var st = l.state;
        var to = st === 'locked' ? null
          : (l.next_lesson ? 'lesson.html?id=' + encodeURIComponent(l.next_lesson)
                           : 'level.html?id=' + encodeURIComponent(l.id));
        var in_ =
          '<span class="ms mi-s ' + st + '">' + ICO[st] + '</span>' +
          '<div><b>' + esc(l.title) + '</b>' +
          '<span class="mi-m">' + TXT[st] + ' · ' + num(l.done) + '/' + num(l.total) + '</span></div>';
        return '<li class="mi ' + st + '">' +
          (to ? '<a href="' + to + '">' + in_ + '</a>' : '<div>' + in_ + '</div>') + '</li>';
      }).join('') + '</ol>' +
      '<a class="btn btn-ghost btn-sm btn-wide" href="map.html">الخارطة كاملة</a>';
  }

  /* ---------- الاختبارات ---------- */
  function quizzes(d) {
    var rows = d.quizzes || [];
    if (!rows.length) { el('quizzes').innerHTML = empty('لا توجد اختبارات منشورة بعد.'); return; }
    el('quizzes').innerHTML = rows.map(function (q) {
      return '<div class="lvl"><div class="lvl-h"><b>' + esc(q.title) + '</b>' +
        '<span dir="ltr">' + (q.best == null ? '—' : num(q.best) + '%') + '</span></div>' +
        '<div class="lvl-f">' +
          (q.passed ? '<span class="done-tag">مجتاز</span>'
                    : '<span style="font-size:12.5px;color:var(--fg-2)">النجاح ' + num(q.pass_score) + '%</span>') +
          '<a href="quiz.html?id=' + encodeURIComponent(q.id) + '">' +
          (q.attempts > 0 ? 'إعادة' : 'ابدأ') + '</a></div></div>';
    }).join('');
  }

  /* ---------- التشغيل ---------- */
  L.guard().then(function (s) {
    if (!s) return;

    /* PostgrestBuilder كائن thenable لا Promise، فلا يملك catch.
       معالج الخطأ يمرَّر كوسيط ثانٍ لـ then. */
    db.rpc('touch_activity').then(function () {}, function () {});

    return Promise.all([
      db.rpc('my_dashboard'),
      db.rpc('my_learn_extra'),
      db.rpc('my_map'),
      db.rpc('beginner_guide')
    ]).then(function (r) {
      var err = r.find(function (x) { return x.error; });
      var d = (r[0] && r[0].data) || {};
      var x = (r[1] && r[1].data) || {};
      var m = (r[2] && r[2].data) || {};
      var g = (r[3] && r[3].data) || [];

      if (err || d.error) {
        L.deny('تعذّر تحميل اللوحة',
          (d.error || (err.error && err.error.message) || ''), false);
        return;
      }

      el('hi').textContent = 'أهلاً، ' + (d.name || '');
      el('hi-sub').textContent = d.membership_no
        ? 'رقم العضوية ' + d.membership_no : '';

      var chips = [];
      if (d.plan) chips.push('<span class="chip-i"><span class="ms">workspace_premium</span>' + esc(d.plan) + '</span>');
      chips.push('<span class="chip-i ' + (d.allowed ? 'ok' : 'off') + '">' +
        '<span class="ms">' + (d.allowed ? 'verified' : 'error') + '</span>' +
        (d.allowed ? 'اشتراك نشط' : 'اشتراك غير نشط') + '</span>');
      el('chips').innerHTML = chips.join('');

      state.log = x.activity_log || [];

      streak(d, x);
      summary(d, x);
      resume(d, x);
      tasks(d, x);
      rangeBtns(); chart();
      lastNote(x);
      guide(g);
      mapMini(m);
      quizzes(d);
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل اللوحة', (e && e.message) || '', false);
  });
})();
