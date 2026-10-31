/* صفحة «الدروس»: المنهج كلّه بطاقةً بطاقة، يُرشَّح برقائق المستويات.
   كل ما فيها من my_lessons() — الحالة والسبب من الدوال التي تحرس
   الوصول نفسها، فما تقوله البطاقة هو ما تفعله القاعدة. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

  var levels = [], lessons = [], pick = 'all';

  var ST = {
    done:        { t: 'مكتمل',  c: 'done' },
    open:        { t: '',        c: 'open' },
    locked:      { t: 'مقفول',  c: 'locked' },
    tier_locked: { t: 'يتطلب ترقية', c: 'tier' }
  };

  /* اسم المستوى قصيراً: «A1 - المبتدئ» تُقرأ «المبتدئ» في الرقاقة،
     فالرمز مكتوب بجانبها أصلاً ولا داعي لتكراره في مساحة ضيّقة. */
  function shortName(l) {
    var t = String(l.title || '').trim();
    var c = String(l.code || '').trim();
    if (!c) return t;
    var cut = t.replace(new RegExp('^' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\s*[-–—:]?\\s*'), '');
    return cut || t;
  }

  function tabs() {
    var total = lessons.length;
    var all = '<button type="button" class="lx-tab' + (pick === 'all' ? ' on' : '') +
      '" data-lv="all" aria-pressed="' + (pick === 'all') + '">الكل' +
      '<i>' + num(total) + '</i></button>';

    el('lx-tabs').innerHTML = all + levels.map(function (l) {
      return '<button type="button" class="lx-tab ' + (ST[l.state] || ST.locked).c +
        (pick === l.id ? ' on' : '') + '" data-lv="' + esc(l.id) +
        '" aria-pressed="' + (pick === l.id) + '">' +
        esc(shortName(l)) + '<i>' + num(l.total || 0) + '</i></button>';
    }).join('');

    el('lx-tabs').querySelectorAll('[data-lv]').forEach(function (b) {
      b.addEventListener('click', function () {
        pick = b.getAttribute('data-lv');
        tabs(); grid();
      });
    });
  }

  function card(x) {
    var s = ST[x.state] || ST.locked;
    var open = x.state === 'done' || x.state === 'open';
    var lvl = levels.filter(function (l) { return l.id === x.level_id; })[0];

    var body =
      '<span class="lx-top">' +
        '<span class="lx-lv">' + esc(lvl ? shortName(lvl) : '—') + '</span>' +
        (s.t ? '<span class="lx-st ' + s.c + '">' + esc(s.t) + '</span>' : '') +
      '</span>' +
      '<b class="lx-t">' + esc(x.title) + '</b>' +
      (x.summary ? '<p class="lx-d">' + esc(x.summary) + '</p>' : '') +
      (!open && x.reason
        ? '<p class="lx-why"><span class="ms">lock</span>' + esc(x.reason) + '</p>'
        : '') +
      '<span class="lx-foot">' +
        (x.duration_min
          ? '<span class="lx-min"><span class="ms">schedule</span>' +
            num(x.duration_min) + ' دقيقة</span>'
          : '<span></span>') +
        (open ? '<span class="ms lx-go">chevron_left</span>' : '') +
      '</span>';

    return open
      ? '<a class="lx-c ' + s.c + '" href="lesson.html?id=' +
          encodeURIComponent(x.id) + '">' + body + '</a>'
      : '<div class="lx-c ' + s.c + '">' + body + '</div>';
  }

  function grid() {
    var view = pick === 'all'
      ? lessons
      : lessons.filter(function (x) { return x.level_id === pick; });

    if (!view.length) {
      el('lx-grid').innerHTML =
        '<div class="nempty"><span class="ms">menu_book</span><p>' +
        (pick === 'all'
          ? 'لم تُنشر دروس بعد. تظهر هنا فور إضافتها.'
          : 'لا دروس في هذا المستوى بعد.') +
        '</p></div>';
      return;
    }
    el('lx-grid').innerHTML = view.map(card).join('');
  }

  L.guard().then(function (s) {
    if (!s) return;
    return db.rpc('my_lessons').then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        el('lx-grid').innerHTML = '<section class="ncard"><p class="n-sub">' +
          esc(d.error || r.error.message || 'تعذّر تحميل الدروس.') + '</p></section>';
        return;
      }
      levels = d.levels || [];
      lessons = d.lessons || [];

      /* الوصول بـ ?level=<id> يفتح على مستوىً بعينه: الخارطة تربط
         بالمستوى الذي ضُغط منه، فلا تبدأ القائمة من أولها كل مرّة. */
      var q = new URLSearchParams(window.location.search).get('level');
      if (q && levels.some(function (l) { return l.id === q; })) pick = q;

      tabs(); grid();
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل الدروس', (e && e.message) || '', false);
  });
})();
