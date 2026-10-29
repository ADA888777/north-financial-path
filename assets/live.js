/* الحصص المباشرة: قائمة وتقويم وعدّاد.
   المقاعد تُحسب في الخادم — المتعلم لا يرى حجوزات غيره فلا يعدّها. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;

  var rows = [], mine = [], uid = null, busy = false, tick = null;
  var month = null;

  function riyadh(iso, opts) {
    try {
      return new Intl.DateTimeFormat('ar-SA', Object.assign(
        { timeZone: 'Asia/Riyadh' }, opts)).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 16); }
  }
  function when(iso) {
    return riyadh(iso, { weekday: 'long', day: 'numeric', month: 'long',
                         hour: 'numeric', minute: '2-digit' });
  }
  function dayKey(iso) {
    try {
      var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh',
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
      return p;
    } catch (e) { return String(iso).slice(0, 10); }
  }

  /* عدّاد يظهر وحده حين يبقى أقل من ٢٤ ساعة */
  function countdown(iso) {
    var ms = new Date(iso) - new Date();
    if (ms <= 0 || ms > 24 * 3600 * 1000) return '';
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    return '<span class="cd" data-at="' + esc(iso) + '">' +
      '<span class="ms">timer</span>' +
      (h > 0 ? num(h) + ' س ' : '') + num(m) + ' د ' + num(s) + ' ث</span>';
  }

  function refreshCounters() {
    document.querySelectorAll('.cd').forEach(function (c) {
      var html = countdown(c.getAttribute('data-at'));
      if (!html) { c.remove(); return; }
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      c.innerHTML = tmp.firstChild.innerHTML;
    });
  }

  function drawSlots() {
    if (!rows.length) {
      el('slots').innerHTML = '<p class="empty">لا توجد حصص مباشرة معلنة حالياً. ' +
        'تظهر هنا فور إعلانها.</p>';
      return;
    }
    el('slots').innerHTML = rows.map(function (s) {
      var full = s.seats_left <= 0 && !s.mine;
      return '<div class="slot' + (s.mine ? ' mine' : '') + '" id="sl-' + esc(s.id) + '">' +
        '<div class="slot-m"><b>' + esc(s.title) + '</b>' +
          (s.description ? '<p>' + esc(s.description) + '</p>' : '') +
          '<span class="slot-w"><span class="ms">schedule</span>' + esc(when(s.starts_at)) +
            ' · ' + num(s.duration_min) + ' دقيقة</span>' +
          countdown(s.starts_at) +
        '</div>' +
        '<div class="slot-a">' +
          (s.capacity
            ? '<span class="seats' + (full ? ' none' : '') + '">' +
              (full ? 'اكتملت المقاعد' : num(s.seats_left) + ' مقعداً متاحاً') + '</span>'
            : '') +
          (s.mine
            ? (s.meeting_url
                ? '<a class="btn btn-primary btn-sm" href="' + esc(s.meeting_url) +
                  '" target="_blank" rel="noopener">رابط الانضمام</a>'
                : '<span class="done-tag">محجوزة — الرابط قبل الموعد</span>') +
              '<button class="btn btn-ghost btn-sm" type="button" data-cancel="' +
                esc(s.id) + '">إلغاء</button>'
            : (full ? ''
                : '<button class="btn btn-primary btn-sm" type="button" data-book="' +
                  esc(s.id) + '">احجز</button>')) +
        '</div></div>';
    }).join('');

    el('slots').querySelectorAll('[data-book]').forEach(function (b) {
      b.addEventListener('click', function () { book(b.getAttribute('data-book'), b); });
    });
    el('slots').querySelectorAll('[data-cancel]').forEach(function (b) {
      b.addEventListener('click', function () { cancel(b.getAttribute('data-cancel'), b); });
    });
  }

  /* ---------- التقويم ---------- */
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

  function drawCal() {
    if (!month) month = new Date();
    var y = month.getFullYear(), m = month.getMonth();
    var first = new Date(y, m, 1);
    var days = new Date(y, m + 1, 0).getDate();
    // الأسبوع يبدأ السبت
    var lead = (first.getDay() + 1) % 7;

    var has = {};
    rows.forEach(function (s) { has[dayKey(s.starts_at)] = (has[dayKey(s.starts_at)] || 0) + 1; });

    var head = ['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج']
      .map(function (d) { return '<span class="cal-hd">' + d + '</span>'; }).join('');

    var cells = '';
    for (var i = 0; i < lead; i++) cells += '<span class="cal-c out"></span>';
    var today = new Date();
    for (var d = 1; d <= days; d++) {
      var key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var n = has[key] || 0;
      var isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
      cells += '<span class="cal-c' + (n ? ' has' : '') + (isToday ? ' today' : '') + '"' +
        (n ? ' title="' + n + ' حصة" data-day="' + key + '"' : '') + '>' +
        num(d) + (n ? '<i></i>' : '') + '</span>';
    }

    el('cal-nav').innerHTML =
      '<button type="button" id="cal-prev" aria-label="الشهر السابق"><span class="ms">chevron_right</span></button>' +
      '<b>' + new Intl.DateTimeFormat('ar-SA', { month: 'long', year: 'numeric' }).format(first) + '</b>' +
      '<button type="button" id="cal-next" aria-label="الشهر التالي"><span class="ms">chevron_left</span></button>';

    el('cal').innerHTML = '<div class="cal">' + head + cells + '</div>' +
      '<p class="cal-k"><i></i> يوم فيه حصة</p>';

    el('cal-prev').addEventListener('click', function () {
      month = new Date(y, m - 1, 1); drawCal();
    });
    el('cal-next').addEventListener('click', function () {
      month = new Date(y, m + 1, 1); drawCal();
    });
    el('cal').querySelectorAll('[data-day]').forEach(function (c) {
      c.addEventListener('click', function () {
        var k = c.getAttribute('data-day');
        var s = rows.filter(function (x) { return dayKey(x.starts_at) === k; })[0];
        if (s) {
          var node = document.getElementById('sl-' + s.id);
          if (node) {
            node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            node.classList.add('hit');
            setTimeout(function () { node.classList.remove('hit'); }, 1600);
          }
        }
      });
    });
  }

  /* ---------- الحجز ---------- */
  function msg(id, text) {
    var box = document.getElementById('sl-' + id);
    if (!box) return;
    var old = box.querySelector('.slot-err');
    if (old) old.remove();
    box.insertAdjacentHTML('beforeend', '<p class="slot-err">' + esc(text) + '</p>');
  }

  function book(id, btn) {
    if (busy) return;
    busy = true; btn.disabled = true;
    db.from('bookings').insert({ slot_id: id, user_id: uid })
      .select('id').maybeSingle()
      .then(function (r) {
        busy = false;
        if (r.error) {
          btn.disabled = false;
          var m = r.error.message || '';
          msg(id, /اكتمل/.test(m) ? 'اكتمل عدد المقاعد في هذه الحصة.'
            : /duplicate|unique/i.test(m) ? 'لديك حجز في هذه الحصة بالفعل.'
            : /row-level|policy/i.test(m) ? 'الحجز يتطلب اشتراكاً نافذاً.' : m);
          return;
        }
        if (r.data && r.data.id) {
          db.functions.invoke('notify-booking', { body: { booking_id: r.data.id } })
            .catch(function () {});
        }
        load();
      }).catch(function (e) {
        busy = false; btn.disabled = false;
        msg(id, (e && e.message) || 'تعذّر الحجز');
      });
  }

  function cancel(id, btn) {
    var b = mine.filter(function (x) { return x.slot_id === id; })[0];
    if (!b) return;
    if (!window.confirm('إلغاء حجزك في هذه الحصة؟')) return;
    btn.disabled = true;
    db.rpc('cancel_booking', { p_booking: b.booking_id }).then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) { btn.disabled = false; msg(id, d.error || r.error.message); return; }
      load();
    }).catch(function (e) { btn.disabled = false; msg(id, (e && e.message) || ''); });
  }

  function load() {
    return Promise.all([
      db.rpc('slots_by_kind', { p_kind: 'live' }),
      db.rpc('my_sessions', { p_kind: 'live' })
    ]).then(function (r) {
      if (r[0].error) {
        el('slots').innerHTML = '<p class="empty">' + esc(r[0].error.message) + '</p>';
        return;
      }
      var d = r[0].data;
      if (d && d.error) { el('slots').innerHTML = '<p class="empty">' + esc(d.error) + '</p>'; return; }
      rows = d || [];
      mine = (r[1] && r[1].data) || [];
      drawSlots(); drawCal();
      if (tick) clearInterval(tick);
      tick = setInterval(refreshCounters, 1000);
    });
  }

  L.guard().then(function (s) {
    if (!s) return;
    uid = s.user.id;
    return load();
  }).catch(function (e) {
    L.deny('تعذّر تحميل الحصص', (e && e.message) || '', false);
  });
})();
