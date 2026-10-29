/* خارطة الطريق. كل رقم من my_map(): لا عدد مستويات ولا دروس مكتوب هنا.
   القفل مفروض في القاعدة؛ ما تعرضه الصفحة انعكاسٌ له لا بديلٌ عنه. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

  var LVL = {
    done:    { t: 'مكتملة',          ico: 'check_circle' },
    current: { t: 'المستوى الحالي',  ico: 'play_circle' },
    open:    { t: 'متاح',            ico: 'lock_open' },
    locked:  { t: 'مقفل',            ico: 'lock' }
  };
  var LSN = {
    done:        { ico: 'check_circle' },
    open:        { ico: 'local_fire_department' },
    locked:      { ico: 'lock' },
    tier_locked: { ico: 'workspace_premium' }
  };
  /* اللون من قاعدة البيانات لا من ترتيب العرض: الإدارة تختاره لكل
     مستوى من تبويب المستويات، فيبقى ثابتاً مهما تغيّر ترتيب الظهور. */
  function hue(l) { return 'lvc-' + (l && l.color ? l.color : 'slate'); }

  /* الرمز يُسبق العنوان إلا إن كان العنوان يبدأ به أصلاً — وإلا صار
     «A1 - A1 - المبتدئ» لأن الإدارة كتبت الرمز داخل الاسم. */
  function lvName(l) {
    var t = String(l.title || '');
    var c = String(l.code || '');
    if (!c) return esc(t);
    if (t === c || t.indexOf(c) === 0) return esc(t);
    return esc(c) + ' - ' + esc(t);
  }

  /* شارة الترقية: اسم الباقة من القاعدة لا نصّ مكتوب هنا */
  function upBadge(x) {
    if (!x.required_plan) return '<span class="up-badge">الترقية لفتحه</span>';
    return '<span class="up-badge"><span class="ms">workspace_premium</span>' +
      'الترقية لـ«' + esc(x.required_plan) + '»</span>';
  }

  function lesson(ls, i) {
    var s = LSN[ls.state] || LSN.locked;
    var open = ls.state === 'done' || ls.state === 'open';

    /* النصّ تحت الدرس تكتبه القاعدة: cta للمفتوح، reason للمقفل.
       كتابته هنا يعني نسخة ثانية تفترق عن القاعدة بعد أول تعديل. */
    var sub = open
      ? ((ls.duration_min ? num(ls.duration_min) + ' دقيقة · ' : '') +
         (ls.cta || 'اضغط لفتح الدرس'))
      : (ls.reason || 'غير متاح بعد');

    var body =
      '<i class="ls-n">' + num(i) + '</i>' +
      '<div class="ls-b"><b>' + esc(ls.title) + '</b>' +
        '<span>' + esc(sub) + '</span></div>' +
      (ls.state === 'tier_locked' ? upBadge(ls) : '') +
      '<span class="ms ls-s">' + s.ico + '</span>';

    return '<li class="ls ' + ls.state +
      (ls.kind === 'strategy' ? ' is-strategy' : '') + '">' +
      (open
        ? '<a href="lesson.html?id=' + encodeURIComponent(ls.id) + '">' + body + '</a>'
        : '<div>' + body + '</div>') +
      '</li>';
  }

  function week(w, start) {
    var ls = w.lessons || [];
    var done = ls.filter(function (x) { return x.state === 'done'; }).length;
    var pct = ls.length ? Math.round(done * 100 / ls.length) : 0;
    var n = start;

    return '<section class="ncard wk-card">' +
      '<div class="wk-h">' +
        '<i class="wk-n">' + num(w.week || 1) + '</i>' +
        '<div><b>الأسبوع ' + num(w.week || 1) + '</b>' +
          '<span>' + num(done) + '/' + num(ls.length) + ' مكتمل</span></div>' +
        '<div class="wk-bar"><div class="nbar sm"><i style="width:' + pct + '%"></i></div></div>' +
      '</div>' +
      '<ul class="ls-list">' + ls.map(function (x) { return lesson(x, n++); }).join('') + '</ul>' +
    '</section>';
  }

  function current(l) {
    if (!l) return '';
    return '<section class="lv-cur nsec ' + hue(l) + '">' +
      '<div class="lv-cur-in">' +
        '<div class="lv-cur-t">' +
          '<span class="nchip ok">المستوى الحالي</span>' +
          '<h2 class="n-h1">' + lvName(l) + '</h2>' +
          (l.subtitle ? '<p class="n-sub">' + esc(l.subtitle) + '</p>' : '') +
        '</div>' +
        '<div class="lv-cur-n"><b>' + num(Math.max(0, (l.total || 0) - (l.done || 0))) + '</b>' +
          '<span>درس متبقٍ في مستواك</span></div>' +
      '</div>' +
      '<div class="nbar-row"><span>' + num(l.percent) + '% مكتمل</span>' +
        '<span>تقدمك في ' + esc(l.code || l.title) + '</span></div>' +
      '<div class="nbar"><i style="width:' + num(l.percent) + '%"></i></div>' +
    '</section>';
  }

  function other(levels) {
    if (!levels.length) return '';
    return '<h2 class="n-h2 sec-t">المستويات الأخرى</h2>' +
      levels.map(function (l) {
        var left = Math.max(0, (l.total || 0) - (l.done || 0));
        var tl = l.state === 'tier_locked';

        return '<section class="lv-o ' + hue(l) + (tl ? ' tier-locked' : '') + '">' +
          '<div class="lv-o-in">' +
            '<div class="lv-o-t">' +
              '<h3 class="n-h2">' + lvName(l) + '</h3>' +
              (l.subtitle ? '<p class="n-sub">' + esc(l.subtitle) + '</p>' : '') +
              (tl
                ? '<p class="lv-lock"><span class="ms">lock</span>' +
                    esc(l.lock_reason || 'يتطلب باقة أعلى') + '</p>' + upBadge(l)
                : '<p class="n-mut">' + num(l.done) + ' من ' + num(l.total) + ' مكتمل</p>') +
            '</div>' +
            '<div class="lv-o-n"><b>' + num(tl ? (l.total || 0) : left) + '</b>' +
              '<span>' + (tl ? 'درساً بالباقة الأعلى' : 'قادم') + '</span></div>' +
          '</div>' +
          (tl ? ''
              : '<div class="nbar-row"><span>' + num(l.percent || 0) + '% مكتمل</span>' +
                  '<span>' + (l.state === 'locked' ? 'يُفتح بعد تقدمك' : 'متاح') + '</span></div>' +
                '<div class="nbar sm"><i style="width:' + num(l.percent || 0) + '%"></i></div>') +
        '</section>';
      }).join('');
  }

  function tiles(m) {
    function t(cls, v, lbl) {
      return '<div class="mt ' + cls + '"><b>' + num(v) + '</b><span>' + esc(lbl) + '</span></div>';
    }
    // ترتيب المرجع: ما ينتظرها أولاً ثم ما أنجزته ثم ما هو متاح
    el('m-tiles').innerHTML =
      t('warn', m.lessons_locked || 0, 'درس مغلق لك') +
      t('blue', m.lessons_done || 0, 'مكتمل') +
      t('ok', m.lessons_open || 0, 'متاح الآن');
  }

  L.guard().then(function (s) {
    if (!s) return;
    return db.rpc('my_map').then(function (r) {
      var m = (r && r.data) || {};
      if (r.error || m.error) {
        el('map').innerHTML = '<section class="ncard"><p class="n-sub">' +
          esc(m.error || r.error.message || 'تعذّر تحميل الخارطة.') + '</p></section>';
        return;
      }

      el('m-meta').textContent =
        num(m.levels_total || 0) + ' مستويات · ' + num(m.lessons_total || 0) +
        ' درس · تقدمك الكلي ' + num(m.percent || 0) + '%';
      el('m-left').textContent =
        num(m.lessons_done || 0) + ' من ' + num(m.lessons_total || 0) + ' درس';
      el('m-fill').style.width = (m.percent || 0) + '%';
      tiles(m);

      var levels = [];
      (m.tracks || []).forEach(function (t) {
        (t.levels || []).forEach(function (l) { levels.push(l); });
      });

      var cur = levels.filter(function (l) { return l.id === m.current_level; })[0]
                || levels.filter(function (l) { return l.state !== 'done'; })[0];

      el('m-sub').textContent = cur
        ? 'مسارك التعليمي من المستوى الحالي إلى آخر مستوى متاح في المنصة.'
        : (levels.length ? 'أنهيت كل المستويات المتاحة.' : 'لم تُنشر مستويات بعد.');

      el('m-current').innerHTML = current(cur);

      if (cur) {
        var n = 1;
        el('map').innerHTML = (cur.weeks || []).map(function (w) {
          var html = week(w, n);
          n += (w.lessons || []).length;
          return html;
        }).join('') || '<section class="ncard"><p class="n-sub">لا دروس في هذا المستوى بعد.</p></section>';
      } else {
        el('map').innerHTML = '';
      }

      el('m-other').innerHTML = other(levels.filter(function (l) {
        return !cur || l.id !== cur.id;
      }));

      if (m.next_lesson) {
        el('m-next').hidden = false;
        el('m-go').href = 'lesson.html?id=' + encodeURIComponent(m.next_lesson);
      }
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل الخارطة', (e && e.message) || '', false);
  });
})();
