/* الكلاسات الخاصة. الرصيد من باقة العضو، والمواعيد من جدول توفّر
   الكوتش — لا رقم ولا موعد مكتوب هنا. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var coaches = [], quota = {}, mine = [], picked = null, slots = [], busy = false;

  function riyadh(iso, opts) {
    try {
      return new Intl.DateTimeFormat('ar-SA', Object.assign(
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
          '<b dir="ltr">' + num(quota.left || 0) + '<i>/' + num(quota.quota || 0) + '</i></b>' +
          '<p>' + (quota.quota
            ? 'باقة ' + esc(quota.plan || '') + ' · استخدمت ' + num(quota.used || 0)
            : 'باقتك لا تتضمّن جلسات خاصة') + '</p>' +
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
              '<p>اختاري كوتشاً وموعداً من الأسفل.</p>') +
        '</span>' +
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
      var days = (c.days || []).map(function (d) { return DAYS[d]; }).join('، ');
      return '<button type="button" class="co" aria-pressed="' +
        (picked === c.id ? 'true' : 'false') + '" data-coach="' + esc(c.id) + '">' +
        '<span class="co-av">' +
          (c.photo_url
            ? '<img src="' + esc(c.photo_url) + '" alt="">'
            : esc((c.name || '؟').trim().charAt(0))) +
        '</span>' +
        '<span class="co-b"><b>' + esc(c.name) + '</b>' +
          '<span>' +
            (c.title ? esc(c.title) : '<span class="ms">star</span>كوتش') +
            (days ? ' · ' + esc(days) : '') +
          '</span>' +
        '</span>' +
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
    if (!picked) {
      bookPanel(hint('touch_app', 'اختاري كوتشاً من القائمة لتظهر مواعيده المتاحة.'));
      return;
    }
    if ((quota.left || 0) <= 0) {
      bookPanel(hint('block', 'استنفدت رصيد جلساتك لهذا الشهر' +
        (quota.quota ? ' (' + num(quota.quota) + ')' : '') +
        '. يتجدّد الرصيد مع بداية الشهر القادم.'));
      return;
    }
    if (!slots.length) {
      bookPanel(hint('event_busy',
        'لا توجد مواعيد متاحة لهذا الكوتش خلال الأسابيع الثلاثة القادمة.'));
      return;
    }

    var m = byDay(), days = Object.keys(m).sort();
    var c = coaches.filter(function (x) { return x.id === picked; })[0] || {};

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

        '<div class="nfld"><label for="bk-tg">معرّف تيليجرام</label>' +
          '<input id="bk-tg" type="text" dir="ltr" placeholder="@username" maxlength="60"' +
            ' value="' + esc(quota.telegram || '') + '">' +
          '<span class="hint">يُستخدم لتنسيق الجلسة معك. اتركيه فارغاً إن لم يكن لديك.</span></div>' +

        '<div class="nfld"><label for="bk-note">ما الذي تريدين تغطيته؟ (اختياري)</label>' +
          '<input id="bk-note" type="text" maxlength="200"></div>' +

        '<p class="bk-note"><span class="ms">schedule</span>' +
          'الإلغاء قبل ١٢ ساعة فأكثر لا يُحتسب من رصيدك. الإلغاء المتأخر أو عدم الحضور يُحتسب.</p>' +

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
    busy = true;
    var b = el('bk-go'), label = b.textContent;
    b.disabled = true; b.textContent = 'جارٍ الحجز…';
    el('bk-err').hidden = true;

    db.rpc('book_private', {
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
        return;
      }
      reload(d.message);
    }).catch(function (err) {
      busy = false; b.disabled = false; b.textContent = label;
      var e = el('bk-err'); e.hidden = false;
      e.textContent = (err && err.message) || 'تعذّر الحجز';
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
          ? 'بقي أقل من ١٢ ساعة على الجلسة، وإلغاؤها الآن يُحتسب من رصيدك. متأكدة؟'
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
      db.rpc('my_sessions', { p_kind: 'private' })
    ]).then(function (r) {
      quota = (r[0] && r[0].data) || {};
      mine = (r[1] && r[1].data) || [];
      top(); drawMine();
      if (picked) pick(picked);
      flash(msg);
    });
  }

  L.guard().then(function (s) {
    if (!s) return;
    return Promise.all([
      db.rpc('active_coaches'),
      db.rpc('my_private_quota'),
      db.rpc('my_sessions', { p_kind: 'private' })
    ]).then(function (r) {
      coaches = (r[0] && r[0].data) || [];
      quota = (r[1] && r[1].data) || {};
      mine = (r[2] && r[2].data) || [];
      if (coaches.length && coaches[0].slot_min) {
        el('pc-min').textContent = num(coaches[0].slot_min);
      }
      top(); drawCoaches(); drawMine();
      // أول كوتش مختار تلقائياً حتى تظهر المواعيد فوراً بلا نقرة إضافية
      if (coaches.length) pick(coaches[0].id); else drawBook();
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل الكلاسات', (e && e.message) || '', false);
  });
})();
