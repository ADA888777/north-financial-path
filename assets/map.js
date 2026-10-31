/* خارطة الطريق: المستويات وحدها. كل رقم من my_map()/my_map_counts()
   — لا عدد مستويات ولا دروس مكتوب هنا.

   الدروس لا تُعرض في هذه الصفحة: الخارطة تقول أين تقف من الطريق،
   وصفحة «الدروس» تقول ما الذي تفتحه الآن. كان المستوى يطوي دروسه
   تحته فصارت الصفحتان تقولان الشيء نفسه مرّتين.

   القفل مفروض في القاعدة؛ ما تعرضه الصفحة انعكاسٌ له لا بديلٌ عنه. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

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

  /* بابُ المستوى إلى صفحة «الدروس» مفتوحاً عليه. يظهر لما أنهته أو
     تقف فيه الآن: المقفل لا باب له، والدروس لا تُكشف قبل أوانها. */
  function doorway(l) {
    if (l.state !== 'done' && l.state !== 'open' && l.state !== 'current') return '';
    return '<a class="lv-o-more" href="lessons.html?level=' + encodeURIComponent(l.id) + '">' +
      '<span>دروس هذا المستوى</span><span class="ms">chevron_left</span></a>';
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
      doorway(l) +
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
     كاملاً وأين تقف منه. */
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
          doorway(l) +
        '</section>';
      }).join('');
  }

  /* ملخّص المحتوى: أسبوعها، لا مستواها كلّه.
     «اثنا عشر درساً ويكتمل المستوى» رقمٌ بعيد حين تكون في أسبوعٍ
     فيه تسعة. فالمربّع الأول ما بقي في أسبوعها، والثالث ما فُتح
     منه الآن. و«مكتمل» وحده على المستوى كلّه: حصيلةٌ تكبر ولا
     تُصفَّر حين تنتقل إلى الأسبوع التالي. */
  function tiles(m) {
    function t(cls, v, lbl) {
      return '<div class="mt ' + cls + '"><b>' + num(v) + '</b><span>' + esc(lbl) + '</span></div>';
    }

    var left  = m.week_remaining;
    var multi = Number(m.week_count || 0) > 1 && m.week_no != null;
    var where = multi ? ' في الأسبوع ' + num(m.week_no) : ' في مستواك';

    var first = left == null
      ? t('warn', m.lessons_locked || 0, 'ينتظر تقدّمك')
      : (left === 0
          ? '<div class="mt ok done"><span class="ms">task_alt</span>' +
            '<span>أكملت هذا الجزء، أحسنت!</span></div>'
          : t('warn', left, (left === 1 ? 'درس متبقٍ' : 'درس متبقٍ') + where));

    el('m-tiles').innerHTML =
      first +
      t('blue', m.level_done || 0, 'مكتمل في هذا المستوى') +
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
        el('m-other').innerHTML = '<section class="ncard"><p class="n-sub">' +
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

      var rest = levels.filter(function (l) { return !cur || l.id !== cur.id; });
      el('m-other').innerHTML = other(rest) ||
        (cur ? '' : '<section class="ncard"><p class="n-sub">لم تُنشر مستويات بعد.</p></section>');

      el('m-ahead').innerHTML = ahead(m);

      /* البطاقة لا تتعلّق بوجود درسٍ تالٍ: بابُ المنهج يُفتح حتى
         لمن أنهت كل شيء — بل هي أحوج ما تكون إليه حينئذٍ. */
      if (levels.length) el('m-next').hidden = false;
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل الخارطة', (e && e.message) || '', false);
  });
})();
