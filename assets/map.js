/* خارطة الطريق. كل رقم من my_map(): لا عدد مستويات ولا دروس مكتوب هنا.

   المستوى الحالي وحده يُفتح بدروسه تحته: هو ما بلغَتْه، فمحتواه
   حقٌّ لها تراه. وبقيّة المستويات بطاقاتٌ بأرقامها بلا دروس —
   لا لأنّ القاعدة تخفيها، بل لأنّ الطريق يُقطع مرحلةً مرحلة،
   وكشفُ ما لم يُبلَغ بعدُ يُفقده معنى البلوغ.

   ومن أرادت العودة إلى درسٍ بعيد فمن «متابعة التعلم» أسفل
   الصفحة: هناك المنهج كلّه بمستوياته، وأيّ درسٍ أنهته يُعاد.

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

  /* شارة الترقية: اسم الباقة ورابط شرائها من القاعدة لا من الكود.
     الرابط يُضبط من لوحة الإدارة (الباقات ← رابط الشراء)، فتغييره
     لا يحتاج نشراً. وبلا رابط تبقى الشارة نصّاً لا وعداً معطّلاً. */
  var PLAN_URL = {};
  function upBadge(x) {
    var name = x.required_plan;
    if (!name) return '<span class="up-badge">الترقية لفتحه</span>';
    var body = '<span class="ms">workspace_premium</span>الترقية لـ«' + esc(name) + '»';
    var url = PLAN_URL[name];
    if (!url) return '<span class="up-badge">' + body + '</span>';
    return '<a class="up-badge up-link" href="' + esc(url) +
      '" target="_blank" rel="noopener">' + body +
      '<span class="ms">open_in_new</span></a>';
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
        '<div class="lv-cur-n"><b>' +
          num(Math.max(0, (l.total || 0) - (l.done || 0))) + '</b>' +
          '<span>درس متبق في مستواك</span></div>' +
      '</div>' +
      '<div class="nbar-row"><span>' + num(l.percent) + '% مكتمل</span>' +
        '<span>تقدمك في ' + esc(l.code || l.title) + '</span></div>' +
      '<div class="nbar"><i style="width:' + num(l.percent) + '%"></i></div>' +
    '</section>';
  }

  /* ما ينتظرها بعد هذا كله.
     رقمان منفصلان: ما تفتحه باقتها ويأتي بتقدّمها، وما يتطلّب باقة
     أعلى. جمعهما في رقم واحد يَعِدها بمحتوى لا تملكه. */
  function ahead(m) {
    var higher = Number(m.upcoming_higher_plan || 0);
    if (!higher) return '';

    /* عدد دروس المستويات القادمة لا يُذكر: المنهج يُكشف درساً درساً،
       وذكرُ الرقم كشفٌ لما لم يُفتح. يبقى سطر الباقة الأعلى وحده
       لأنه عرضُ ترقية لا استباقٌ للتدرّج. */
    return '<section class="ncard ahead">' +
      '<span class="ntile"><span class="ms">workspace_premium</span></span>' +
      '<div class="ah-b"><b>محتوى إضافي في الباقة الأعلى</b>' +
        '<p class="ah-l mut">' + num(higher) + ' درساً لا تفتحها باقتك الحالية.</p>' +
      '</div>' +
    '</section>';
  }

  /* كل المستويات تُعرض بطاقاتُها: المتعلّمة تريد أن ترى الطريق
     كاملاً وأين تقف منه. أمّا دروسُها فلا تُطوى تحتها: زرٌّ يكشف
     دروس مستوىً لم تبلغه يُسقط معنى الوصول، والعودةُ إلى درسٍ
     سابق لها بابُها في «متابعة التعلم». */
  function other(levels) {
    if (!levels.length) return '';
    return '<h2 class="n-h2 sec-t">مستوياتك الأخرى</h2>' +
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
                : '<p class="n-mut">' + num(l.done) + ' من ' + num(l.total) + ' مكتمل' +
                  (left ? ' · ' + num(left) + ' متبقٍ' : '') + '</p>') +
            '</div>' +
            /* الرقم إجمالي دروس المستوى، والكلمة تحته حاله:
               متاح الآن، أو قادم بتقدّمها، أو حصري لباقة أعلى. */
            '<div class="lv-o-n"><b>' + num(l.total || 0) + '</b>' +
              '<span>' + (tl ? 'حصري'
                             : l.state === 'locked' ? 'قادم' : 'متاح') + '</span></div>' +
          '</div>' +
          (tl ? ''
              : '<div class="nbar-row"><span>' + num(l.percent || 0) + '% مكتمل</span>' +
                  '<span>' + (l.state === 'locked' ? 'يفتح بعد تقدمك' : 'متاح لك') + '</span></div>' +
                '<div class="nbar sm"><i style="width:' + num(l.percent || 0) + '%"></i></div>') +
        '</section>';
      }).join('');
  }

  /* ملخّص المحتوى: الأرقام تقيس أسبوعها، والكلمات لا تذكر الأسبوع.
     «اثنا عشر درساً ويكتمل المستوى» رقمٌ بعيد حين تكون في أسبوعٍ
     فيه تسعة — فالمربّع الأول ما بقي في أسبوعها، والثالث ما فُتح
     منه الآن. لكنّ الأسبوع تقسيمٌ داخليّ للمنهج لا تحتاج المتعلّمة
     أن تتتبّعه بالاسم، فبقي أثرُه في الرقم وزال من النصّ.
     و«مكتمل» على المستوى كلّه: حصيلةٌ تكبر ولا تُصفَّر بانتقالها. */
  function tiles(m) {
    function t(cls, v, lbl) {
      return '<div class="mt ' + cls + '"><b>' + num(v) + '</b><span>' + esc(lbl) + '</span></div>';
    }

    var left = m.week_remaining;

    var first = left == null
      ? t('warn', m.lessons_locked || 0, 'ينتظر تقدّمك')
      : (left === 0
          ? '<div class="mt ok done"><span class="ms">task_alt</span>' +
            '<span>أكملت هذا الجزء، أحسنت!</span></div>'
          : t('warn', left, 'درس متبق لك'));

    el('m-tiles').innerHTML =
      first +
      t('blue', m.level_done || 0, 'مكتمل') +
      t('ok', m.week_open || 0, 'متاح الآن');
  }

  L.guard().then(function (s) {
    if (!s) return;
    // الأعداد بنداء موازٍ: دالة لكل غرض، والنداءان يمضيان معاً
    return Promise.all([db.rpc('my_map'), db.rpc('my_map_counts'), db.rpc('public_plans')])
      .then(function (rr) {
      var r = rr[0];
      var m = (r && r.data) || {};
      var cnt = (rr[1] && !rr[1].error && rr[1].data) || {};

      /* الباقات مرتّبة بالرتبة، فأول اسم مطابق هو الأدنى الذي يفتح */
      ((rr[2] && !rr[2].error && rr[2].data) || []).forEach(function (pl) {
        if (pl && pl.name && pl.checkout_url && !PLAN_URL[pl.name]) {
          PLAN_URL[pl.name] = pl.checkout_url;
        }
      });
      if (cnt && !cnt.error) {
        m.level_remaining      = cnt.level_remaining;
        m.level_done           = cnt.level_done;
        m.week_no              = cnt.week_no;
        m.week_count           = cnt.week_count;
        m.week_remaining       = cnt.week_remaining;
        m.week_open            = cnt.week_open;
        m.upcoming_in_plan     = cnt.upcoming_in_plan;
        m.upcoming_higher_plan = cnt.upcoming_higher_plan;
      }
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

      var rest = levels.filter(function (l) { return !cur || l.id !== cur.id; });
      el('m-other').innerHTML = other(rest);

      el('m-ahead').innerHTML = ahead(m);

      /* البطاقة لا تتعلّق بوجود درسٍ تالٍ: بابُ المنهج يُفتح حتى
         لمن أنهت كل شيء — بل هي أحوج ما تكون إليه حينئذٍ. */
      if (levels.length) el('m-next').hidden = false;
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل الخارطة', (e && e.message) || '', false);
  });
})();
