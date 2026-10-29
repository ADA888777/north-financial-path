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
  /* العدّ التنازلي لا يبدأ إلا داخل ٢٤ ساعة، ويتوقّف عند البداية.
     soon تأتي من الخادم: ساعة المتصفح قد تكون مضبوطة خطأً. */
  function countdown(iso, soon) {
    if (soon === false) return '';
    var ms = new Date(iso) - new Date();
    if (ms <= 0 || ms > 24 * 3600 * 1000) return '';
    var h = Math.floor(ms / 3600000);
    var m = Math.floor((ms % 3600000) / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    return '<span class="cdn" data-at="' + esc(iso) + '">' +
      '<span class="ms">timer</span>' +
      (h > 0 ? num(h) + ' س ' : '') + num(m) + ' د ' + num(s) + ' ث</span>';
  }

  function refreshCounters() {
    document.querySelectorAll('.cdn').forEach(function (c) {
      var html = countdown(c.getAttribute('data-at'), true);
      if (!html) { c.remove(); return; }
      var tmp = document.createElement('div');
      tmp.innerHTML = html;
      c.innerHTML = tmp.firstChild.innerHTML;
    });
  }

  function drawSlots() {
    if (!rows.length) {
      el('slots').innerHTML =
        '<section class="ncard"><div class="nempty">' +
          '<span class="ms">event_busy</span>' +
          '<p>لا توجد حصص قادمة حالياً. تظهر هنا فور إعلانها، ويصلك إشعار بموعدها.</p>' +
          '<a class="nbtn nbtn-g" href="learn.html">عودة إلى لوحتي</a>' +
        '</div></section>';
      return;
    }
    el('slots').innerHTML =
      '<section class="ncard"><div class="nhead">' +
        '<span class="ntile"><span class="ms">event_upcoming</span></span>' +
        '<h2>الحصص القادمة</h2>' +
        '<span class="nchip">' + num(rows.length) + '</span>' +
      '</div><div class="ss-list">' +
      rows.map(function (s) {
        var full = s.seats_left <= 0 && !s.mine;
        return '<div class="ss' + (s.mine ? ' mine' : '') + '" id="sl-' + esc(s.id) + '">' +
          '<span class="ss-d"><b>' + esc(riyadh(s.starts_at, { day: 'numeric' })) + '</b>' +
            '<span>' + esc(riyadh(s.starts_at, { month: 'short' })) + '</span></span>' +
          '<span class="ss-b"><b>' + esc(s.title) + '</b>' +
            '<span>' + esc(when(s.starts_at)) + ' · ' + num(s.duration_min) + ' دقيقة' +
              // لا تُعرض المقاعد لمن حجزت: مقعدها محجوز وعددها صفر مُربك
              (s.capacity && !s.mine
                ? ' · ' + (full ? 'اكتملت المقاعد' : num(s.seats_left) + ' مقعداً متاحاً')
                : '') +
            (s.phase === 'live' ? ' · بدأت' : '') +
            '</span>' +
            countdown(s.starts_at, s.soon) +
            (s.phase === 'live'
              ? '<span class="cdn now"><span class="ms">sensors</span>جارية الآن</span>'
              : '') +
          '</span>' +
          '<span class="ss-a">' +
            (s.mine
              ? (s.meeting_url
                  ? '<a class="nbtn nbtn-p" href="' + esc(s.meeting_url) +
                    '" target="_blank" rel="noopener">رابط الانضمام</a>'
                  : '<span class="nchip ok">محجوزة</span>') +
                '<button class="nbtn nbtn-g" type="button" data-cancel="' +
                  esc(s.id) + '">إلغاء</button>'
              : (full ? '<span class="nchip">مكتملة</span>'
                  : '<button class="nbtn nbtn-p" type="button" data-book="' +
                    esc(s.id) + '">احجز مقعدي</button>')) +
          '</span>' +
          (s.description ? '<p class="ss-p">' + esc(s.description) + '</p>' : '') +
        '</div>';
      }).join('') + '</div></section>';

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
    var lead = (first.getDay() + 1) % 7;   // الأسبوع يبدأ السبت

    // حصص كل يوم من هذا الشهر
    var byDay = {};
    rows.forEach(function (s) {
      var k = dayKey(s.starts_at);
      (byDay[k] = byDay[k] || []).push(s);
    });

    el('cal-m').textContent =
      new Intl.DateTimeFormat('ar-SA', { month: 'long', year: 'numeric' }).format(first);

    var inMonth = rows.filter(function (s) {
      return dayKey(s.starts_at).slice(0, 7) === monthKey(first);
    }).length;
    el('cal-count').textContent = inMonth
      ? num(inMonth) + (inMonth === 1 ? ' حصة' : ' حصص') + ' هذا الشهر'
      : 'لا حصص هذا الشهر';

    var dows = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']
      .map(function (d) { return '<span>' + d + '</span>'; }).join('');

    var today = new Date();
    var tKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') +
      '-' + String(today.getDate()).padStart(2, '0');

    var cells = '';
    for (var i = 0; i < lead; i++) cells += '<div class="cal-d pad"></div>';
    for (var d = 1; d <= days; d++) {
      var key = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var evs = byDay[key] || [];
      var cls = 'cal-d';
      if (evs.length) cls += ' has';
      if (key === tKey) cls += ' today';
      else if (key < tKey) cls += ' past';
      cells += '<div class="' + cls + '"' +
        (evs.length ? ' data-day="' + key + '" role="button" tabindex="0"' +
          ' title="' + esc(evs.map(function (x) { return x.title; }).join(' · ')) + '"' : '') +
        '><span class="cal-dn">' + num(d) + '</span>' +
        evs.slice(0, 2).map(function (x) {
          return '<span class="cal-ev' + (x.mine ? ' live' : '') + '">' + esc(x.title) + '</span>';
        }).join('') +
        (evs.length > 2 ? '<span class="cal-more">+' + num(evs.length - 2) + '</span>' : '') +
      '</div>';
    }

    el('cal').innerHTML = '<div class="cal-dows">' + dows + '</div>' +
      '<div class="cal-grid">' + cells + '</div>';

    el('cal').querySelectorAll('[data-day]').forEach(function (c) {
      function go() {
        var k = c.getAttribute('data-day');
        var s = rows.filter(function (x) { return dayKey(x.starts_at) === k; })[0];
        if (!s) return;
        var node = document.getElementById('sl-' + s.id);
        if (!node) return;
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.classList.add('hit');
        setTimeout(function () { node.classList.remove('hit'); }, 1600);
      }
      c.addEventListener('click', go);
      c.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
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

  // أزرار الشهر ثابتة في الصفحة، فتُربط مرة واحدة
  function bindNav() {
    el('cal-prev').addEventListener('click', function () {
      month = new Date(month.getFullYear(), month.getMonth() - 1, 1); drawCal();
    });
    el('cal-next').addEventListener('click', function () {
      month = new Date(month.getFullYear(), month.getMonth() + 1, 1); drawCal();
    });
  }

  function load() {
    return Promise.all([
      db.rpc('slots_by_kind', { p_kind: 'live' }),
      db.rpc('my_sessions', { p_kind: 'live' })
    ]).then(function (r) {
      if (r[0].error) {
        el('slots').innerHTML = '<section class="ncard"><p class="n-sub">' +
          esc(r[0].error.message) + '</p></section>';
        return;
      }
      var d = r[0].data;
      if (d && d.error) {
        el('slots').innerHTML = '<section class="ncard"><p class="n-sub">' +
          esc(d.error) + '</p></section>';
        return;
      }
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
    month = new Date();
    bindNav();
    return load();
  }).catch(function (e) {
    L.deny('تعذّر تحميل الحصص', (e && e.message) || '', false);
  });
})();
