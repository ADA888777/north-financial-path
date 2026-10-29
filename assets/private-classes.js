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

    function card(ico, label, value, note) {
      return '<div class="s-card"><span class="ms">' + ico + '</span>' +
        '<span class="s-l">' + esc(label) + '</span>' +
        '<b class="s-v">' + value + '</b>' +
        (note ? '<span class="s-n">' + esc(note) + '</span>' : '') + '</div>';
    }

    el('pc-top').innerHTML =
      card('confirmation_number', 'رصيد الشهر',
           '<span dir="ltr">' + num(quota.left || 0) + '/' + num(quota.quota || 0) + '</span>',
           quota.quota ? 'باقة ' + (quota.plan || '') :
             'باقتك بلا جلسات خاصة') +
      card('event', 'الجلسة القادمة',
           next ? esc(timeLabel(next.starts_at)) : 'ما عندك جلسة قادمة',
           next ? dayLabel(next.starts_at) + (next.coach ? ' · ' + next.coach : '') : '') +
      card('history', 'جلسات هذا الشهر', num(quota.used || 0),
           'من ' + num(quota.quota || 0));
  }

  /* ---------- الكوتشات ---------- */
  function drawCoaches() {
    if (!coaches.length) {
      el('pc-coaches').innerHTML = '<p class="empty">لم تُضَف كوتشات بعد.</p>';
      return;
    }
    el('pc-coaches').innerHTML = '<div class="co-grid">' + coaches.map(function (c) {
      var days = (c.days || []).map(function (d) { return DAYS[d]; }).join('، ');
      return '<button type="button" class="co' + (picked === c.id ? ' on' : '') +
        '" data-coach="' + esc(c.id) + '">' +
        '<span class="co-av">' + esc((c.name || '؟').trim().charAt(0)) + '</span>' +
        '<span class="co-b"><b>' + esc(c.name) + '</b>' +
          (c.title ? '<span class="co-t">' + esc(c.title) + '</span>' : '') +
          (days ? '<span class="co-d">' + esc(days) + '</span>' : '') +
        '</span></button>';
    }).join('') + '</div>';

    el('pc-coaches').querySelectorAll('[data-coach]').forEach(function (b) {
      b.addEventListener('click', function () { pick(b.getAttribute('data-coach')); });
    });
  }

  /* ---------- المواعيد ---------- */
  function pick(id) {
    picked = id;
    drawCoaches();
    el('pc-slots-box').hidden = false;
    el('pc-slots').innerHTML = '<p class="empty">جارٍ تحميل المواعيد…</p>';

    db.rpc('coach_slots', { p_coach: id, p_days: 21 }).then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        el('pc-slots').innerHTML = '<p class="empty">' +
          esc(d.error || r.error.message) + '</p>';
        return;
      }
      slots = d.slots || [];
      drawSlots();
    }).catch(function (e) {
      el('pc-slots').innerHTML = '<p class="empty">' +
        esc((e && e.message) || 'تعذّر التحميل') + '</p>';
    });
  }

  function drawSlots() {
    if (!slots.length) {
      el('pc-slots').innerHTML = '<p class="empty">لا توجد مواعيد متاحة لهذا الكوتش خلال الأسابيع القادمة.</p>';
      return;
    }
    if ((quota.left || 0) <= 0) {
      el('pc-slots').innerHTML = '<p class="empty">استنفدت رصيد جلساتك لهذا الشهر' +
        (quota.quota ? ' (' + num(quota.quota) + ')' : '') +
        '. يتجدّد الرصيد مع بداية الشهر القادم.</p>';
      return;
    }

    var byDay = {};
    slots.forEach(function (s) {
      var k = String(s.starts_at).slice(0, 10);
      (byDay[k] = byDay[k] || []).push(s);
    });

    el('pc-slots').innerHTML = Object.keys(byDay).sort().map(function (k) {
      return '<div class="sl-day"><h4>' + esc(dayLabel(byDay[k][0].starts_at)) + '</h4>' +
        '<div class="sl-times">' + byDay[k].map(function (s) {
          return '<button type="button" class="sl-t" data-at="' + esc(s.starts_at) + '">' +
            esc(timeLabel(s.starts_at)) + '</button>';
        }).join('') + '</div></div>';
    }).join('');

    el('pc-slots').querySelectorAll('[data-at]').forEach(function (b) {
      b.addEventListener('click', function () { confirm(b.getAttribute('data-at')); });
    });
  }

  /* ---------- تأكيد الحجز ---------- */
  function confirm(at) {
    var c = coaches.filter(function (x) { return x.id === picked; })[0] || {};
    var box = el('pc-slots');
    var old = document.getElementById('bk-form');
    if (old) old.remove();

    box.insertAdjacentHTML('afterbegin',
      '<div class="bk" id="bk-form">' +
        '<h4>تأكيد الحجز</h4>' +
        '<p class="bk-when"><span class="ms">event</span>' +
          esc(dayLabel(at)) + ' · ' + esc(timeLabel(at)) +
          ' بتوقيت الرياض · مع ' + esc(c.name || '') + '</p>' +
        '<div class="fld"><label for="bk-tg">معرّف تيليجرام</label>' +
          '<input id="bk-tg" type="text" dir="ltr" placeholder="@username" maxlength="60">' +
          '<span class="hint">يُستخدم لتنسيق الجلسة معك. اتركه فارغاً إن لم يكن لديك.</span></div>' +
        '<div class="fld"><label for="bk-note">ما الذي تريد تغطيته؟ (اختياري)</label>' +
          '<input id="bk-note" type="text" maxlength="200"></div>' +
        '<p class="bk-pol">الإلغاء قبل ١٢ ساعة فأكثر لا يُحتسب من رصيدك. الإلغاء المتأخر يُحتسب.</p>' +
        '<div class="bk-f">' +
          '<button class="btn btn-primary" type="button" id="bk-go">أكّد الحجز</button>' +
          '<button class="btn btn-ghost" type="button" id="bk-x">إلغاء</button>' +
        '</div>' +
        '<p class="bk-err" id="bk-err" hidden></p>' +
      '</div>');

    el('bk-x').addEventListener('click', function () { el('bk-form').remove(); });
    el('bk-go').addEventListener('click', function () { book(at); });
    el('bk-tg').focus();
    el('bk-form').scrollIntoView({ block: 'nearest' });
  }

  function book(at) {
    if (busy) return;
    busy = true;
    var b = el('bk-go');
    b.disabled = true; b.textContent = 'جارٍ الحجز…';

    db.rpc('book_private', {
      p_coach: picked,
      p_start: at,
      p_telegram: el('bk-tg').value || null,
      p_note: el('bk-note').value || null
    }).then(function (r) {
      busy = false; b.disabled = false; b.textContent = 'أكّد الحجز';
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        var e = el('bk-err');
        e.hidden = false;
        e.textContent = d.error || r.error.message;
        return;
      }
      el('bk-form').remove();
      reload(d.message);
    }).catch(function (err) {
      busy = false; b.disabled = false; b.textContent = 'أكّد الحجز';
      var e = el('bk-err'); e.hidden = false;
      e.textContent = (err && err.message) || 'تعذّر الحجز';
    });
  }

  /* ---------- مواعيدي ---------- */
  function drawMine() {
    var rows = mine.filter(function (m) { return m.kind === 'private'; });
    if (!rows.length) {
      el('pc-mine').innerHTML = '<p class="empty">لا توجد جلسات خاصة بعد.</p>';
      return;
    }
    var ST = { booked: 'محجوزة', attended: 'حضرتها', no_show: 'لم تحضر',
               cancelled: 'ملغاة', late_cancel: 'ملغاة متأخراً' };
    el('pc-mine').innerHTML = rows.map(function (m) {
      var past = !m.upcoming;
      return '<div class="ms-row' + (past ? ' past' : '') + '">' +
        '<div class="ms-b"><b>' + esc(dayLabel(m.starts_at)) + ' · ' +
          esc(timeLabel(m.starts_at)) + '</b>' +
          '<span class="ms-m">' + esc(m.coach || 'بلا كوتش') +
            ' · ' + num(m.duration_min || 60) + ' دقيقة</span></div>' +
        '<span class="tag ' + (m.status === 'booked' && !past ? 'tag-ok' : 'tag-off') + '">' +
          esc(ST[m.status] || m.status) + '</span>' +
        (m.meeting_url
          ? '<a class="btn btn-primary btn-sm" href="' + esc(m.meeting_url) +
            '" target="_blank" rel="noopener">دخول</a>' : '') +
        (m.can_cancel
          ? '<button class="btn btn-ghost btn-sm" type="button" data-cancel="' +
            esc(m.booking_id) + '" data-late="' + (m.late_if_cancel ? '1' : '0') +
            '">إلغاء</button>' : '') +
      '</div>';
    }).join('');

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
    });
  }).catch(function (e) {
    L.deny('تعذّر تحميل الكلاسات', (e && e.message) || '', false);
  });
})();
