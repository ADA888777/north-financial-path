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
    try {
      return new Intl.DateTimeFormat('ar-SA', { weekday: 'short' })
        .format(new Date(iso + 'T00:00:00')).slice(0, 3);
    } catch (e) { return ''; }
  }
  function dayNum(iso) {
    try { return num(new Date(iso + 'T00:00:00').getDate()); } catch (e) { return ''; }
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
    el('st-n').textContent = num(n);
    el('st-lbl').textContent = n === 1 ? 'يوم متتالٍ'
      : (n === 2 ? 'يومان متتاليان' : (n >= 3 && n <= 10 ? 'أيام متتالية' : 'يوماً متتالياً'));
    el('st-msg').textContent = n === 0
      ? 'ابدأ رحلتك اليوم!'
      : (d.active_today ? 'أنجزت اليوم. حافظ على السلسلة.'
                        : 'لم تنجز اليوم بعد — درس واحد يكفي.');

    el('week').innerHTML = (x.week || []).map(function (w) {
      var cls = w.active ? 'on' : (w.future ? 'future' : 'off');
      if (w.today) cls += ' today';
      return '<div class="wd ' + cls + '" role="listitem">' +
        '<span class="wd-n">' + esc(dayShort(w.day)) + '</span>' +
        '<i class="wd-o">' + esc(dayNum(w.day)) + '</i></div>';
    }).join('');
  }

  /* ---------- 2) ملخص المستوى ---------- */
  function summary(d, x) {
    var lvl = x.current_level, lq = x.last_quiz, nc = x.next_class;

    function card(ico, label, value, note, href) {
      var inner =
        '<span class="ntile"><span class="ms">' + ico + '</span></span>' +
        '<span class="nstat-b"><span class="nstat-l">' + esc(label) + '</span>' +
        '<b class="nstat-v">' + value + '</b>' +
        (note ? '<span class="nstat-n">' + esc(note) + '</span>' : '') + '</span>';
      return href ? '<a class="nstat" href="' + href + '">' + inner + '</a>'
                  : '<div class="nstat">' + inner + '</div>';
    }

    el('summary').innerHTML =
      card('emoji_events', 'المستوى الحالي',
           esc(lvl ? (lvl.label || lvl.title) : 'لم يبدأ'),
           lvl && lvl.track ? lvl.track : '', lvl ? 'map.html' : null) +
      card('speed', 'آخر نتيجة اختبار',
           lq ? num(lq.percent) + '<i>%</i>' : 'لم يبدأ',
           lq ? (lq.passed ? 'ناجح — ' : 'لم يُجتَز — ') + lq.title : '',
           lq ? 'quiz.html?id=' + encodeURIComponent(lq.quiz_id) : null) +
      card('menu_book', 'التقدم', num(d.percent || 0) + '<i>%</i>',
           num(d.lessons_done || 0) + '/' + num(d.lessons_total || 0) + ' دروس', 'map.html') +
      card('event', 'الحصة القادمة', nc ? esc(nc.title) : 'لا يوجد',
           nc ? when(nc.starts_at) : '',
           nc ? (nc.kind === 'live' ? 'live.html' : 'classes.html') : 'live.html');
  }

  /* ---------- 6) تابع التعلم ---------- */
  function resume(d, x) {
    var r = x.resume;
    var l = r || d.last_lesson || d.next_lesson;
    var head = '<div class="nhead"><span class="ms">play_circle</span><h2>تابع التعلم</h2></div>';

    if (!l) {
      el('resume-box').innerHTML = head +
        '<p class="n-sub">لم تفتح أي درس بعد.</p>' +
        '<a class="nbtn nbtn-p" href="map.html">اختر مرحلتك</a>';
      return;
    }
    var id = r ? r.lesson_id : l.id;
    var pos = r ? r.pos : 0;
    el('resume-box').innerHTML = head +
      '<p class="rsm-t">' + esc(l.title) + '</p>' +
      (pos > 0 ? '<p class="n-mut">توقفت عند ' + num(pos) + '% من الدرس</p>' : '') +
      '<a class="nbtn nbtn-p" href="lesson.html?id=' + encodeURIComponent(id) +
        (pos > 0 ? '&at=' + pos : '') + '">متابعة التعلم</a>';
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

    var html = '<div class="nrows">' + fixed.map(function (f) {
      var body =
        '<span class="ntile"><span class="ms">' + f.ico + '</span></span>' +
        '<span class="nrow-b"><b>' + esc(f.t) + '</b><span>' + f.s + '</span></span>' +
        (f.href ? '<span class="ms n-go">chevron_left</span>' : '');
      return f.href
        ? '<a class="nrow" href="' + f.href + '">' + body + '</a>'
        : '<div class="nrow off">' + body + '</div>';
    }).join('') + '</div>';

    var extra = d.tasks || [];
    if (extra.length) {
      html += '<div class="dt-extra"><h3 class="n-h3">من الإدارة</h3>' + extra.map(function (t) {
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

  /* ---------- 5) نشاط المتعلم ----------
     خريطة مربّعات: كل عمود أسبوع وكل صفّ يوم، ودرجة اللون شدّة النشاط.
     تعرض ثلاثة أشهر في مساحة لا يتسع فيها مخطط أعمدة لها. */
  function chart() {
    var log = state.log.slice(-91);
    var box = el('activity');
    if (!log.length) { box.innerHTML = empty('لا يوجد نشاط مسجّل بعد.'); return; }

    var max = 0;
    log.forEach(function (d) { if (d.total > max) max = d.total; });

    function level(n) {
      if (!n) return 0;
      if (max <= 1) return 4;
      var r = n / max;
      return r > .75 ? 4 : r > .5 ? 3 : r > .25 ? 2 : 1;
    }

    // أول عمود يبدأ بالسبت
    var lead = 0;
    try { lead = (new Date(log[0].day + 'T00:00:00').getDay() + 1) % 7; } catch (e) {}

    var cells = '';
    for (var i = 0; i < lead; i++) cells += '<i class="hm-c hm-pad"></i>';
    log.forEach(function (d) {
      var lbl = shortDate(d.day) + ': ' +
        (d.total === 0 ? 'بلا نشاط'
          : [d.lessons ? d.lessons + ' درس' : '',
             d.quizzes ? d.quizzes + ' اختبار' : '',
             d.challenge ? d.challenge + ' مفردة' : ''].filter(Boolean).join('، '));
      cells += '<i class="hm-c l' + level(d.total) + '" title="' + esc(lbl) + '"></i>';
    });

    var total = log.reduce(function (a, d) { return a + d.total; }, 0);
    var days = log.filter(function (d) { return d.total > 0; }).length;

    box.innerHTML =
      '<div class="hm" role="img" aria-label="نشاطك خلال ثلاثة أشهر">' + cells + '</div>' +
      '<div class="hm-k"><span>أقل</span>' +
        '<i class="hm-c l0"></i><i class="hm-c l1"></i><i class="hm-c l2"></i>' +
        '<i class="hm-c l3"></i><i class="hm-c l4"></i>' +
        '<span>أكثر</span></div>' +
      '<p class="n-mut hm-s">' + num(total) + ' نشاطاً في ' + num(days) + ' يوماً</p>';
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
        : '<p class="n-sub">لا توجد إشعارات بعد</p>') +
      '<a class="n-link" href="notifications.html">عرض الإشعارات' +
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

  /* ---------- 8) خارطة مصغّرة ----------
     شرائح الدروس بدل قائمة: تُرى الرحلة كلها في سطر. */
  function mapMini(m) {
    var all = [];
    (m.tracks || []).forEach(function (t) {
      (t.levels || []).forEach(function (l) {
        (l.weeks || []).forEach(function (w) {
          (w.lessons || []).forEach(function (ls) { all.push(ls); });
        });
        if (!(l.weeks || []).length) all.push({ state: l.state, title: l.title, id: l.id, level: true });
      });
    });

    if (!all.length) {
      el('map-mini').innerHTML = '<p class="n-sub">لم تُنشر مراحل بعد.</p>';
      return;
    }

    var shown = all.slice(0, 12);
    el('map-mini').innerHTML =
      '<div class="pips">' + shown.map(function (ls, i) {
        var to = ls.state === 'locked' ? null
          : (ls.level ? 'level.html?id=' + encodeURIComponent(ls.id)
                      : 'lesson.html?id=' + encodeURIComponent(ls.id));
        var inner = ls.state === 'done' ? '<span class="ms">menu_book</span>'
          : ls.state === 'locked' ? 'قفل' : num(i + 1);
        var title = ls.title + ' — ' +
          (ls.state === 'done' ? 'مكتمل' : ls.state === 'locked' ? 'مقفل' : 'الحالي');
        return to
          ? '<a class="pip ' + ls.state + '" href="' + to + '" title="' + esc(title) + '">' + inner + '</a>'
          : '<span class="pip ' + ls.state + '" title="' + esc(title) + '">' + inner + '</span>';
      }).join('') + '</div>' +
      '<div class="pip-k">' +
        '<span><i class="pip-d done"></i>مكتمل</span>' +
        '<span><i class="pip-d current"></i>الحالي</span>' +
        '<span><i class="pip-d locked"></i>متاح لاحقاً</span>' +
      '</div>';
  }

  /* ---------- الاختبارات ---------- */
  function quizzes(d) {
    var rows = d.quizzes || [];
    if (!rows.length) {
      el('quizzes').innerHTML = '<p class="n-sub">لا توجد اختبارات منشورة بعد.</p>';
      return;
    }
    el('quizzes').innerHTML = '<div class="nrows">' + rows.map(function (q) {
      return '<a class="nrow" href="quiz.html?id=' + encodeURIComponent(q.id) + '">' +
        '<span class="ntile sm' + (q.passed ? ' ok' : '') + '">' +
          '<span class="ms">' + (q.passed ? 'task_alt' : 'quiz') + '</span></span>' +
        '<span class="nrow-b"><b>' + esc(q.title) + '</b>' +
          '<span>' + (q.best == null ? 'النجاح ' + num(q.pass_score) + '%'
                                     : 'أفضل نتيجة ' + num(q.best) + '%') + '</span></span>' +
        (q.passed ? '<span class="nchip ok">مجتاز</span>' : '<span class="ms n-go">chevron_left</span>') +
      '</a>';
    }).join('') + '</div>';
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

      state.log = x.activity_log || [];

      streak(d, x);
      summary(d, x);
      resume(d, x);
      tasks(d, x);
      chart();
      lastNote(x);
      guide(g);
      mapMini(m);
      quizzes(d);
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل اللوحة', (e && e.message) || '', false);
  });
})();
