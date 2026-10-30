/* الكلاسات الخاصة. الرصيد من باقة العضو، والمواعيد من جدول توفّر
   الكوتش — لا رقم ولا موعد مكتوب هنا. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var coaches = [], quota = {}, mine = [], picked = null, slots = [], busy = false;
  var upgradePlan = null;   // أدنى باقة نشطة تمنح جلسات خاصة

  /* '18:00:00' → '٦ مساءً' */
  function hour12(t) {
    var h = parseInt(String(t).slice(0, 2), 10);
    if (isNaN(h)) return String(t);
    var am = h < 12;
    var h12 = h % 12 || 12;
    return num(h12) + (am ? ' صباحاً' : ' مساءً');
  }

  function riyadh(iso, opts) {
    try {
      return new Intl.DateTimeFormat('ar-SA-u-nu-latn', Object.assign(
        { timeZone: 'Asia/Riyadh' }, opts)).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 16); }
  }
  function dayLabel(iso) {
    return riyadh(iso, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function timeLabel(iso) {
    return riyadh(iso, { hour: 'numeric', minute: '2-digit' });
  }

  /* ---------- الرصيد والجلسة القادمة ---------- */
  /* حالة واحدة صريحة من القاعدة.
     كان الصفر يُقرأ مرّتين فيُستنتج منه حكمان متناقضان: «باقتك لا
     تتضمّن جلسات» في بطاقة الرصيد، و«استنفدتِ رصيدك» في لوحة الحجز.
     الآن state واحدة تحكم الرسالتين، فلا يجتمع نقيضان. */
  /* الاستحقاق يُقرأ من القاعدة، وغيابه ليس إذناً.
     كانت الصفحة تفحص الحالات السيّئة واحدة واحدة ثم تسقط إلى لوحة
     الحجز فيما عداها — فحسابٌ تردّ عنه القاعدة حالةً لا تعرفها
     الواجهة (قاعدة لم تُحدَّث، أو خطأ) كان يرى نموذج الحجز كاملاً.
     الآن: لا تُفتح اللوحة إلا بحالة 'ok' صريحة. */
  function entitled() { return quota.entitled === true; }
  function canBook()  { return quota.state === 'ok'; }

  function quotaLine() {
    if (quota.state === undefined) {
      return 'تعذّرت قراءة رصيد جلساتك. حدّثي الصفحة، وإن تكرّر أبلغي الإدارة.';
    }
    switch (quota.state) {
      case 'no_plan':
        return 'باقتك «' + (quota.plan || '—') + '» غير مُعدّة في المنصة. ' +
               'أبلغي الإدارة لتصحيح الإعداد.';
      case 'inactive':
        return 'اشتراكك غير نافذ الآن. جدّديه لتستأنفي الحجز.';
      case 'not_included':
        return 'باقة ' + (quota.plan || '') + ' لا تتضمّن جلسات خاصة.';
      case 'exhausted':
        return 'باقة ' + (quota.plan || '') + ' · استخدمتِ ' + num(quota.used || 0) +
               ' من ' + num(quota.quota || 0) + ' هذا الشهر';
      default:
        return 'باقة ' + (quota.plan || '') + ' · استخدمتِ ' + num(quota.used || 0) +
               ' من ' + num(quota.quota || 0);
    }
  }

  function top() {
    var next = mine.filter(function (m) {
      return m.upcoming && m.status === 'booked';
    }).sort(function (a, b) {
      return new Date(a.starts_at) - new Date(b.starts_at);
    })[0];

    el('pc-top').innerHTML =
      '<section class="ncard quo-card">' +
        '<span class="ntile"><span class="ms">confirmation_number</span></span>' +
        '<span class="q-b"><span>رصيد الشهر</span>' +
          (quota.entitled
            ? '<b dir="ltr">' + num(quota.left || 0) + '<i>/' + num(quota.quota || 0) + '</i></b>'
            : '<b style="font-size:clamp(16px,2vw,19px);color:var(--fg-2)">—</b>') +
          '<p>' + esc(quotaLine()) + '</p>' +
        '</span>' +
      '</section>' +
      '<section class="ncard quo-card">' +
        '<span class="ntile' + (next ? ' ok' : '') + '"><span class="ms">event</span></span>' +
        '<span class="q-b"><span>الجلسة القادمة</span>' +
          (next
            ? '<b style="font-size:clamp(17px,2.2vw,21px)">' + esc(timeLabel(next.starts_at)) + '</b>' +
              '<p>' + esc(dayLabel(next.starts_at)) +
                (next.coach ? ' · مع ' + esc(next.coach) : '') + '</p>'
            : '<b style="font-size:clamp(16px,2vw,19px);color:var(--fg-2)">ما عندك جلسة قادمة</b>' +
              '<p>' + (canBook() ? 'اختاري كوتشاً وموعداً من الأسفل.'
                                 : 'لا يتضمّن اشتراكك الحالي حجز جلسات خاصة.') + '</p>') +
        '</span>' +
      '</section>';
  }

  /* ---------- باقة لا تتضمّن الجلسات ----------
     تُعرض المزايا كما هي في القاعدة — عدد الجلسات واسم الباقة
     ورابط شرائها — ولا يُعرض أيٌّ من أدوات الحجز. المنع نفسه في
     القاعدة: book_private ترفض الطلب ولو نُودي الـAPI مباشرة. */
  function lockedCard() {
    var grid = document.querySelector('.ngrid-r');
    if (!grid) return;

    var p = upgradePlan;
    var q = (p && Number(p.private_quota)) || 0;
    var word = q === 1 ? 'جلسة فردية شهرياً'
             : q === 2 ? 'جلستان فرديتان شهرياً'
             : q <= 10 ? 'جلسات فردية شهرياً' : 'جلسة فردية شهرياً';

    var items = q
      ? '<li><span class="ms">event_available</span>' + num(q) + ' ' + word + ' مع الكوتش</li>' +
        '<li><span class="ms">schedule</span>تختارين الكوتش والموعد المناسب لكِ</li>' +
        '<li><span class="ms">forum</span>تنسيق الجلسة مع الكوتش على تيليجرام</li>'
      : '';

    /* كلّه مقفل: لا رصيد يُعرض ولا جلسة قادمة تُنتظر ولا سياسة
       إلغاء تخصّ حجزاً لا يقع. تبقى «جلساتي» لأن حجزاً قديماً من
       باقة أعلى يظلّ حقّها. */
    var hide = ['pc-top', 'pc-policy'];
    hide.forEach(function (id) { var n = el(id); if (n) n.hidden = true; });

    var intro = document.querySelector('.pg-head .n-sub');
    if (intro) intro.hidden = true;
    var brief = el('pc-sub-lock');
    if (brief) brief.hidden = false;

    grid.style.display = 'block';
    grid.innerHTML =
      '<section class="pc-lock">' +
        '<span class="pc-lock-i"><span class="ms">lock</span></span>' +
        '<h2>' + (p ? 'الكلاسات الخاصة حصرية لباقة «' + esc(p.name) + '»'
                    : 'الكلاسات الخاصة غير متاحة في باقتك') + '</h2>' +
        (items ? '<ul class="pc-lock-l">' + items + '</ul>' : '') +
        '<p class="pc-lock-p">' +
          (p ? 'رقّي اشتراكك لفتح الميزة.'
             : 'لم تُحدَّد بعد باقةٌ تتضمّن الجلسات الخاصة. أبلغي الإدارة.') +
        '</p>' +
        (p && p.checkout_url
          ? '<a class="pc-lock-b" href="' + esc(p.checkout_url) +
            '" target="_blank" rel="noopener">الترقية إلى ' + esc(p.name) +
            '<span class="ms">open_in_new</span></a>'
          : (p ? '<p class="pc-lock-n">للترقية تواصلي مع إدارة المنصة.</p>' : '')) +
      '</section>';
  }

  /* ---------- الكوتشات ---------- */
  function drawCoaches() {
    if (!coaches.length) {
      el('pc-coaches').innerHTML =
        '<div class="nempty"><span class="ms">person_off</span>' +
        '<p>لم تُضَف كوتشات بعد. تظهر هنا فور إضافتهم من لوحة الإدارة.</p></div>';
      return;
    }
    el('pc-coaches').innerHTML = '<div class="co-list">' + coaches.map(function (c) {
      /* التقييم بدل الوصف. المتوسط محسوب في القاعدة من تقييمات
         حقيقية مرتبطة بجلسات حضرتها صاحباتها — ولا نجوم بلا تقييم. */
      var n = Number(c.rating_count || 0);
      var rate = n > 0
        ? '<span class="co-rate"><span class="ms">star</span>' +
            esc(c.rating_avg) + '<i>(' + num(n) + ')</i></span>'
        : '<span class="co-rate none">لا توجد تقييمات بعد</span>';

      return '<button type="button" class="co" aria-pressed="' +
        (picked === c.id ? 'true' : 'false') + '" data-coach="' + esc(c.id) + '">' +
        '<span class="co-av">' +
          (c.photo_url
            ? '<img src="' + esc(c.photo_url) + '" alt="">'
            : esc((c.name || '؟').trim().charAt(0))) +
        '</span>' +
        '<span class="co-b"><b>' + esc(c.name) + '</b>' + rate + '</span>' +
        '<span class="ms ck">check_circle</span>' +
      '</button>';
    }).join('') + '</div>';

    el('pc-coaches').querySelectorAll('[data-coach]').forEach(function (b) {
      b.addEventListener('click', function () { pick(b.getAttribute('data-coach')); });
    });
  }

  /* ---------- لوحة الحجز ----------
     لوحة واحدة ثابتة: اختيار اليوم ثم الوقت ثم التأكيد.
     لا يُرسل شيء إلا بموعد اختارته المتعلمة فعلاً. */
  function bookPanel(html) { el('pc-book').innerHTML = html; }

  function hint(ico, text) {
    return '<div class="nempty"><span class="ms">' + ico + '</span><p>' + text + '</p></div>';
  }

  function pick(id) {
    picked = id;
    slots = [];
    drawCoaches();
    bookPanel(hint('hourglass_top', 'جارٍ تحميل المواعيد المتاحة…'));

    db.rpc('coach_slots', { p_coach: id, p_days: 21 }).then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        bookPanel('<p class="nerr">' + esc(d.error || r.error.message) + '</p>');
        return;
      }
      slots = d.slots || [];
      drawBook();
    }).catch(function (e) {
      bookPanel('<p class="nerr">' + esc((e && e.message) || 'تعذّر التحميل') + '</p>');
    });
  }

  function byDay() {
    var m = {};
    slots.forEach(function (x) {
      var k = String(x.starts_at).slice(0, 10);
      (m[k] = m[k] || []).push(x);
    });
    return m;
  }

  function drawBook() {
    /* ترتيب الفحوص مقصود: الاستحقاق قبل الرصيد.
       من لا تمنحها باقتها الميزة لا يُقال لها «استنفدتِ رصيدك». */
    if (quota.state === 'no_plan') {
      bookPanel(hint('report',
        'باقتك «' + esc(quota.plan || '—') + '» غير مُعدّة في المنصة، ' +
        'فلا يمكن احتساب رصيد جلساتك. أبلغي إدارة المنصة.'));
      return;
    }
    if (quota.state === 'inactive') {
      bookPanel(hint('lock_clock',
        'اشتراكك غير نافذ الآن. جدّديه لتستأنفي حجز جلساتك الخاصة.'));
      return;
    }
    if (quota.state === 'not_included') {
      bookPanel(hint('workspace_premium',
        'باقة ' + esc(quota.plan || '') + ' لا تتضمّن جلسات خاصة. ' +
        'للاطّلاع على الباقات التي تتضمّنها راجعي صفحة حسابك.'));
      return;
    }
    if (quota.state === 'exhausted') {
      bookPanel(hint('block',
        'استخدمتِ ' + num(quota.quota || 0) + ' من ' + num(quota.quota || 0) +
        ' جلسات هذا الشهر. يتجدّد الرصيد مع بداية الشهر القادم بتوقيت الرياض.'));
      return;
    }
    if (!picked) {
      bookPanel(hint('touch_app', 'اختاري كوتشاً من القائمة لتظهر مواعيده المتاحة.'));
      return;
    }
    if (!slots.length) {
      bookPanel(hint('event_busy',
        'لا توجد مواعيد متاحة لهذا الكوتش خلال الأسابيع الثلاثة القادمة.'));
      return;
    }

    var m = byDay(), days = Object.keys(m).sort();
    var c = coaches.filter(function (x) { return x.id === picked; })[0] || {};
    var needTg = !!quota.require_telegram && !quota.telegram;

    bookPanel(
      '<div class="bk-form">' +
        '<div class="nfld"><label for="bk-coach">الكوتش</label>' +
          '<select id="bk-coach">' + coaches.map(function (x) {
            return '<option value="' + esc(x.id) + '"' +
              (x.id === picked ? ' selected' : '') + '>' + esc(x.name) + '</option>';
          }).join('') + '</select></div>' +

        '<div class="nfld"><label for="bk-date">اليوم</label>' +
          '<select id="bk-date">' + days.map(function (k) {
            return '<option value="' + esc(k) + '">' + esc(dayLabel(m[k][0].starts_at)) +
              ' — ' + num(m[k].length) + ' موعد</option>';
          }).join('') + '</select></div>' +

        '<div class="nfld"><label for="bk-time">الوقت بتوقيت الرياض</label>' +
          '<select id="bk-time"></select></div>' +

        '<div class="nfld' + (needTg ? ' need' : '') + '">' +
          '<label for="bk-tg">اسم المستخدم في تيليجرام' +
            (quota.require_telegram ? ' <span class="req">*</span>' : '') + '</label>' +
          '<input id="bk-tg" type="text" dir="ltr" placeholder="@username" maxlength="60"' +
            ' value="' + esc(quota.telegram ? '@' + String(quota.telegram).replace(/^@+/, '') : '') + '">' +
          '<span class="hint">المطلوب <b>اسم المستخدم</b> مثل ‎@username — لا الاسم الظاهر ' +
            'في حسابك ولا رقم الجوال. به يتواصل معك الكوتش لتنسيق الجلسة، ولا يراه غيره.</span>' +
          (needTg
            ? '<span class="nerr">أضيفي اسم المستخدم قبل تأكيد الحجز.</span>'
            : '') +
        '</div>' +

        '<div class="nfld"><label for="bk-note">ما الذي تريدين تغطيته؟ (اختياري)</label>' +
          '<input id="bk-note" type="text" maxlength="200"></div>' +

        '<p class="bk-note"><span class="ms">schedule</span>' +
          'الإلغاء قبل 12 ساعة فأكثر لا يُحتسب من رصيدك. الإلغاء المتأخر أو عدم الحضور يُحتسب.</p>' +

        '<button class="nbtn nbtn-p nbtn-wide" type="button" id="bk-go">' +
          'أكّدي الحجز مع ' + esc(c.name || 'الكوتش') + '</button>' +
        '<p class="nerr" id="bk-err" hidden></p>' +
      '</div>');

    function fillTimes() {
      var k = el('bk-date').value;
      el('bk-time').innerHTML = (m[k] || []).map(function (x) {
        return '<option value="' + esc(x.starts_at) + '">' +
          esc(timeLabel(x.starts_at)) + '</option>';
      }).join('');
    }
    fillTimes();

    el('bk-date').addEventListener('change', fillTimes);
    el('bk-coach').addEventListener('change', function () {
      pick(el('bk-coach').value);
    });
    el('bk-go').addEventListener('click', function () { book(el('bk-time').value); });
  }

  function book(at) {
    if (busy || !at) return;

    var tg = (el('bk-tg').value || '').trim();
    if (quota.require_telegram && !tg) {
      var e0 = el('bk-err');
      e0.hidden = false;
      e0.textContent = 'أضيفي اسم المستخدم في تيليجرام قبل تأكيد الحجز.';
      el('bk-tg').focus();
      return;
    }

    busy = true;
    var b = el('bk-go'), label = b.textContent;
    b.disabled = true; b.textContent = 'جارٍ الحجز…';
    el('bk-err').hidden = true;

    /* المعرّف يُحفظ بدالته أولاً: تتحقّق من صيغته وتوحّدها، ويبقى
       محفوظاً في حسابها ولو تعذّر الحجز بعدها لسبب آخر. */
    (tg ? db.rpc('set_my_telegram', { p_handle: tg }) : Promise.resolve({ data: {} }))
      .then(function (tr) {
        var td = (tr && tr.data) || {};
        if (td.error) { throw new Error(td.error); }
        if (td.telegram) quota.telegram = String(td.telegram).replace(/^@+/, '');
        return doBook(at, b, label);
      })
      .catch(function (err) {
        busy = false; b.disabled = false; b.textContent = label;
        var e = el('bk-err'); e.hidden = false;
        e.textContent = (err && err.message) || 'تعذّر الحجز';
      });
  }

  function doBook(at, b, label) {
    return db.rpc('book_private', {
      p_coach: picked,
      p_start: at,
      p_telegram: el('bk-tg').value || null,
      p_note: el('bk-note').value || null
    }).then(function (r) {
      busy = false; b.disabled = false; b.textContent = label;
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        var e = el('bk-err');
        e.hidden = false;
        e.textContent = d.error || r.error.message;
        if (d.need_telegram) el('bk-tg').focus();
        return;
      }
      reload(d.message);
    });
  }

  /* ---------- مواعيدي ---------- */
  function drawMine() {
    var rows = mine.filter(function (m) { return m.kind === 'private'; });
    if (!rows.length) {
      el('pc-mine').innerHTML =
        '<div class="nempty dash"><span class="ms">event_note</span>' +
        '<p>لا توجد جلسات خاصة بعد. تظهر هنا بعد أول حجز.</p></div>';
      return;
    }
    var ST = { booked: 'محجوزة', attended: 'حضرتها', no_show: 'لم تحضر',
               cancelled: 'ملغاة', late_cancel: 'ملغاة متأخراً' };
    el('pc-mine').innerHTML = '<div class="ss-list">' + rows.map(function (m) {
      var past = !m.upcoming, live = m.status === 'booked' && !past;
      return '<div class="ss' + (past ? ' past' : '') + '">' +
        '<span class="ss-d"><b>' +
          esc(riyadh(m.starts_at, { day: 'numeric' })) + '</b><span>' +
          esc(riyadh(m.starts_at, { month: 'short' })) + '</span></span>' +
        '<span class="ss-b"><b>' + esc(timeLabel(m.starts_at)) + ' · ' +
          esc(m.coach || 'بلا كوتش') + '</b>' +
          '<span>' + esc(dayLabel(m.starts_at)) + ' · ' +
            num(m.duration_min || 60) + ' دقيقة</span></span>' +
        '<span class="ss-a">' +
          '<span class="nchip' + (live ? ' ok' : '') + '">' +
            esc(ST[m.status] || m.status) + '</span>' +
          (m.meeting_url
            ? '<a class="nbtn nbtn-p nbtn-sm" href="' + esc(m.meeting_url) +
              '" target="_blank" rel="noopener">دخول</a>' : '') +
          (m.can_cancel
            ? '<button class="nbtn nbtn-g nbtn-sm" type="button" data-cancel="' +
              esc(m.booking_id) + '" data-late="' + (m.late_if_cancel ? '1' : '0') +
              '">إلغاء</button>' : '') +
        '</span>' +
      '</div>';
    }).join('') + '</div>';

    el('pc-mine').querySelectorAll('[data-cancel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var late = b.getAttribute('data-late') === '1';
        if (!window.confirm(late
          ? 'بقي أقل من 12 ساعة على الجلسة، وإلغاؤها الآن يُحتسب من رصيدك. متأكدة؟'
          : 'إلغاء هذه الجلسة؟ لن يُحتسب من رصيدك.')) return;
        b.disabled = true;
        db.rpc('cancel_booking', { p_booking: b.getAttribute('data-cancel') })
          .then(function (r) {
            var d = (r && r.data) || {};
            if (r.error || d.error) { b.disabled = false; alert(d.error || r.error.message); return; }
            reload(d.message);
          }).catch(function () { b.disabled = false; });
      });
    });
  }

  /* ---------- تقييم الكوتش ----------
     القائمة من my_ratable_sessions(): جلسات حضرتها فعلاً وانتهت.
     لا تُبنى هنا من التواريخ: انقضاء الوقت ليس حضوراً، والحضور
     حالةٌ يسجّلها الكوتش أو الإدارة ولا تملك المتعلمة تغييرها. */
  function drawRate(rows) {
    var boxw = el('pc-rate-box');
    if (!rows || !rows.length) { boxw.hidden = true; return; }
    boxw.hidden = false;

    el('pc-rate').innerHTML = '<div class="ss-list">' + rows.map(function (x) {
      return '<div class="ss rt" data-bk="' + esc(x.booking_id) + '">' +
        '<span class="co-av">' + esc((x.coach || '؟').trim().charAt(0)) + '</span>' +
        '<span class="ss-b"><b>' + esc(x.coach) + '</b>' +
          '<span>' + esc(dayLabel(x.starts_at)) + ' · ' +
            esc(timeLabel(x.starts_at)) + '</span></span>' +
        '<span class="stars" role="group" aria-label="التقييم من 1 إلى 5">' +
          [1, 2, 3, 4, 5].map(function (n) {
            var on = x.my_stars && n <= x.my_stars;
            return '<button type="button" class="star' + (on ? ' on' : '') +
              '" data-stars="' + n + '" aria-label="' + n + ' من 5">' +
              '<span class="ms">star</span></button>';
          }).join('') +
        '</span>' +
      '</div>';
    }).join('') + '</div>';

    el('pc-rate').querySelectorAll('.star').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = b.closest('[data-bk]');
        var n = parseInt(b.getAttribute('data-stars'), 10);
        row.querySelectorAll('.star').forEach(function (s2, k) {
          s2.classList.toggle('on', k < n);
        });
        row.querySelectorAll('.star').forEach(function (s2) { s2.disabled = true; });

        db.rpc('rate_coach', { p_booking: row.getAttribute('data-bk'), p_stars: n })
          .then(function (r) {
            var d = (r && r.data) || {};
            if (r.error || d.error) {
              A_toast(d.error || r.error.message, true);
              row.querySelectorAll('.star').forEach(function (s2) { s2.disabled = false; });
              return;
            }
            row.insertAdjacentHTML('beforeend',
              '<span class="nchip ok rt-done">' + esc(d.message || 'سُجّل') + '</span>');
            reload();
          }).catch(function () {
            row.querySelectorAll('.star').forEach(function (s2) { s2.disabled = false; });
          });
      });
    });
  }

  function A_toast(msg, bad) {
    var n = document.createElement('p');
    n.className = bad ? 'nerr' : 'pc-flash';
    n.textContent = msg;
    el('pc-rate').insertAdjacentElement('beforebegin', n);
    setTimeout(function () { n.remove(); }, 6000);
  }

  function flash(msg) {
    if (!msg) return;
    var n = document.createElement('p');
    n.className = 'pc-flash';
    n.textContent = msg;
    el('pc-top').insertAdjacentElement('beforebegin', n);
    setTimeout(function () { n.remove(); }, 6000);
  }

  function reload(msg) {
    return Promise.all([
      db.rpc('my_private_quota'),
      db.rpc('my_sessions', { p_kind: 'private' }),
      db.rpc('my_ratable_sessions')
    ]).then(function (r) {
      quota = (r[0] && r[0].data) || {};
      mine = (r[1] && r[1].data) || [];
      top(); drawMine(); drawRate((r[2] && r[2].data) || []);
      if (picked) pick(picked);
      flash(msg);
    });
  }

  L.guard().then(function (s) {
    if (!s) return;
    return Promise.all([
      db.rpc('active_coaches'),
      db.rpc('my_private_quota'),
      db.rpc('my_sessions', { p_kind: 'private' }),
      db.rpc('my_ratable_sessions'),
      db.rpc('public_plans')
    ]).then(function (r) {
      coaches = (r[0] && r[0].data) || [];
      quota = (r[1] && r[1].data) || {};
      mine = (r[2] && r[2].data) || [];
      drawRate((r[3] && r[3].data) || []);

      /* الباقات تعود مرتّبة بالرتبة، فأوّل ما يمنح جلسات هو الأدنى
         — لا اسم باقة ولا عدد جلسات مكتوب في هذا الملف. */
      ((r[4] && !r[4].error && r[4].data) || []).forEach(function (pl) {
        if (!upgradePlan && Number(pl && pl.private_quota) > 0) upgradePlan = pl;
      });
      // المدّة والنافذة من القاعدة: الصفحة لا تعلن ساعاتٍ لا تطبّقها
      var mins = quota.slot_min || (coaches[0] && coaches[0].slot_min);
      if (mins) el('pc-min').textContent = num(mins);
      var w = el('pc-window');
      if (w && quota.open_from && quota.open_to) {
        var days = (quota.open_weekdays || []).map(function (d) { return DAYS[d]; });
        w.textContent = (days.length
            ? 'من ' + days[0] + ' إلى ' + days[days.length - 1]
            : '') +
          ' ' + hour12(quota.open_from) + ' إلى ' + hour12(quota.open_to);
      }
      top(); drawMine();

      /* باقتها لا تتضمّن الجلسات: لا قائمة كوتشات ولا نموذج حجز */
      if (!entitled()) { lockedCard(); return; }

      drawCoaches();
      // أول كوتش مختار تلقائياً حتى تظهر المواعيد فوراً بلا نقرة إضافية
      if (coaches.length) pick(coaches[0].id); else drawBook();
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل الكلاسات', (e && e.message) || '', false);
  });
})();
