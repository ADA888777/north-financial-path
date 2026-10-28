/* الحصص المباشرة. المقاعد المتبقية تُحسب في الخادم: المتعلم لا يرى
   حجوزات غيره فلا يستطيع عدّها بنفسه. */
(function () {
  'use strict';
  var L = window.northLearn, db = L.db, el = L.el, esc = L.esc, num = L.num;
  var uid = null, busy = false;

  function when(iso) {
    try {
      return new Intl.DateTimeFormat('ar-SA', {
        weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit'
      }).format(new Date(iso));
    } catch (e) { return String(iso).slice(0, 16); }
  }

  function render(rows) {
    if (!rows.length) {
      el('slots').innerHTML = '<p class="empty">لا توجد حصص مباشرة معلنة حالياً.</p>';
      return;
    }
    el('slots').innerHTML = rows.map(function (s) {
      var full = s.seats_left <= 0 && !s.mine;
      return '<div class="slot' + (s.mine ? ' mine' : '') + '">' +
        '<div class="slot-m"><b>' + esc(s.title) + '</b>' +
          (s.description ? '<p>' + esc(s.description) + '</p>' : '') +
          '<span class="slot-w"><span class="ms">schedule</span>' + esc(when(s.starts_at)) +
          ' · ' + num(s.duration_min) + ' دقيقة</span></div>' +
        '<div class="slot-a">' +
          '<span class="seats' + (full ? ' none' : '') + '">' +
            (full ? 'اكتملت المقاعد' : num(s.seats_left) + ' مقعداً متاحاً') + '</span>' +
          (s.mine
            ? (s.meeting_url
                ? '<a class="btn btn-primary btn-sm" href="' + esc(s.meeting_url) +
                  '" target="_blank" rel="noopener">دخول الحصة</a>'
                : '<span class="done-tag">محجوزة</span>') +
              '<button class="btn btn-ghost btn-sm" data-cancel="' + esc(s.id) + '" type="button">إلغاء</button>'
            : (full ? ''
                : '<button class="btn btn-primary btn-sm" data-book="' + esc(s.id) + '" type="button">احجز</button>')) +
        '</div></div>';
    }).join('');

    el('slots').querySelectorAll('[data-book]').forEach(function (b) {
      b.addEventListener('click', function () { book(b.getAttribute('data-book'), b); });
    });
    el('slots').querySelectorAll('[data-cancel]').forEach(function (b) {
      b.addEventListener('click', function () { cancel(b.getAttribute('data-cancel'), b); });
    });
  }

  function msg(btn, text) {
    var box = btn.closest('.slot');
    var old = box.querySelector('.slot-err');
    if (old) old.remove();
    box.insertAdjacentHTML('beforeend', '<p class="slot-err">' + esc(text) + '</p>');
  }

  function book(id, btn) {
    if (busy) return;
    busy = true; btn.disabled = true;
    // معرّف الحجز يُقرأ من الإدراج نفسه: دالة البريد تحتاجه، وإرسال null
    // يجعل الحجز ينجح بلا تأكيد يصل المتعلم ولا المحلل.
    db.from('bookings').insert({ slot_id: id, user_id: uid })
      .select('id').maybeSingle()
      .then(function (r) {
      busy = false;
      if (r.error) {
        btn.disabled = false;
        var m = r.error.message || '';
        msg(btn,
          /اكتمل/.test(m) ? 'اكتمل عدد المقاعد في هذه الحصة.' :
          /duplicate|unique/i.test(m) ? 'لديك حجز في هذا الموعد بالفعل.' :
          /row-level|policy/i.test(m) ? 'الحجز يتطلب اشتراكاً نافذاً.' : m);
        return;
      }
      if (r.data && r.data.id) {
        db.functions.invoke('notify-booking', { body: { booking_id: r.data.id } })
          .catch(function () {});
      }
      load();
    }).catch(function (e) {
      busy = false; btn.disabled = false; msg(btn, (e && e.message) || 'تعذّر الحجز');
    });
  }

  function cancel(id, btn) {
    if (busy) return;
    busy = true; btn.disabled = true;
    db.from('bookings').delete().eq('slot_id', id).eq('user_id', uid).then(function (r) {
      busy = false;
      if (r.error) { btn.disabled = false; msg(btn, r.error.message); return; }
      load();
    }).catch(function (e) {
      busy = false; btn.disabled = false; msg(btn, (e && e.message) || 'تعذّر الإلغاء');
    });
  }

  function load() {
    return db.rpc('slots_by_kind', { p_kind: 'live' }).then(function (r) {
      if (r.error) {
        el('slots').innerHTML = '<p class="empty">' + esc(r.error.message) + '</p>';
        return;
      }
      var d = r.data;
      if (d && d.error) { el('slots').innerHTML = '<p class="empty">' + esc(d.error) + '</p>'; return; }
      render(d || []);
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
