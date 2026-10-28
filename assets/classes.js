/* الكلاسات الخاصة: المواعيد المتاحة والحجز وحجوزاتي.
   المقاعد المتبقية تأتي من available_slots لأن سياسة RLS تمنع
   المشترك من رؤية حجوزات غيره، فلا يستطيع عدّها بنفسه. */
(function () {
  'use strict';
  var L = window.northLearn;
  if (!L) return;
  var db = L.db, el = L.el, esc = L.esc, num = L.num;

  var busy = false;
  var uid = null;   /* من الجلسة قبل عرض أي زر حجز */

  L.guard().then(function (s) {
    if (!s) return;
    uid = s.user.id;
    load();
  });

  function when(iso, mins) {
    try {
      var d = new Date(iso);
      var date = new Intl.DateTimeFormat('ar-SA', {
        dateStyle: 'full', timeZone: 'Asia/Riyadh' }).format(d);
      var time = new Intl.DateTimeFormat('ar-SA', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(d);
      return date + ' — ' + time + (mins ? ' · ' + num(mins) + ' دقيقة' : '');
    } catch (e) { return String(iso); }
  }

  function load() {
    // الكلاسات الخاصة وحدها. الحصص المباشرة الجماعية لها صفحتها.
    Promise.all([db.rpc('slots_by_kind', { p_kind: 'private' }), db.rpc('my_bookings')]).then(function (r) {
      if (r[0].error) {
        el('slots').innerHTML = state('error', 'تعذّر تحميل المواعيد. ' + esc(r[0].error.message));
      } else {
        drawSlots(r[0].data || []);
      }
      if (!r[1].error) drawMine(r[1].data || []);
      else el('mine').innerHTML = state('error', 'تعذّر تحميل حجوزاتك.');
    });
  }

  function state(icon, text) {
    return '<div class="empty"><span class="ms">' + icon + '</span>' + text + '</div>';
  }

  function drawSlots(slots) {
    if (!slots.length) {
      el('slots').innerHTML = state('event_busy',
        'لا توجد مواعيد متاحة حالياً.<br>تُعلن المواعيد الجديدة هنا أول ما تُضاف.');
      return;
    }

    el('slots').innerHTML = slots.map(function (s) {
      var full = s.seats_left <= 0;
      var tag = s.mine
        ? '<span class="done-tag">محجوز لك</span>'
        : full
          ? '<span class="done-tag" style="color:var(--dn);background:color-mix(in srgb,var(--dn) 12%,transparent)">مكتمل</span>'
          : '<span style="font-size:12px;color:var(--fg-2)">' +
            num(s.seats_left) + (s.seats_left === 1 ? ' مقعد متبقٍ' : ' مقاعد متبقية') + '</span>';

      var action = s.mine
        ? (s.meeting_url
            ? '<a class="btn btn-primary btn-sm" href="' + esc(s.meeting_url) + '" target="_blank" rel="noopener noreferrer">رابط الحضور</a>'
            : '<button class="btn btn-ghost btn-sm" type="button" data-cancel="' + esc(s.id) + '">إلغاء الحجز</button>')
        : full
          ? '<button class="btn btn-ghost btn-sm" type="button" disabled>مكتمل</button>'
          : '<button class="btn btn-primary btn-sm" type="button" data-book="' + esc(s.id) + '">احجز</button>';

      return '<div class="qz" style="align-items:flex-start">' +
        '<div style="min-width:0">' +
          '<b>' + esc(s.title) + '</b>' +
          '<div class="meta" style="font-family:var(--body)">' + esc(when(s.starts_at, s.duration_min)) + '</div>' +
          (s.host ? '<div class="meta" style="font-family:var(--body)">مع ' + esc(s.host) + '</div>' : '') +
          (s.description ? '<div class="meta" style="font-family:var(--body);color:var(--fg-2)">' + esc(s.description) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' + tag + action + '</div>' +
      '</div>';
    }).join('');

    el('slots').querySelectorAll('[data-book]').forEach(function (b) {
      b.addEventListener('click', function () { book(b.getAttribute('data-book'), b); });
    });
    el('slots').querySelectorAll('[data-cancel]').forEach(function (b) {
      b.addEventListener('click', function () { cancel(b.getAttribute('data-cancel'), b); });
    });
  }

  function drawMine(rows) {
    if (!rows.length) {
      el('mine').innerHTML = state('history', 'لم تحجز أي حصة بعد.');
      return;
    }
    el('mine').innerHTML = rows.map(function (b) {
      var tag = b.slot_status === 'cancelled'
        ? '<span class="done-tag" style="color:var(--dn);background:color-mix(in srgb,var(--dn) 12%,transparent)">أُلغيت الحصة</span>'
        : b.upcoming
          ? '<span class="done-tag" style="color:var(--accent);background:var(--accent-wash)">قادمة</span>'
          : '<span style="font-size:11.5px;color:var(--fg-3)">انتهت</span>';
      return '<div class="qz">' +
        '<div style="min-width:0"><b>' + esc(b.title) + '</b>' +
          '<div class="meta" style="font-family:var(--body)">' + esc(when(b.starts_at, b.duration_min)) + '</div>' +
          (b.host ? '<div class="meta" style="font-family:var(--body)">مع ' + esc(b.host) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:12px">' + tag +
          (b.upcoming && b.meeting_url
            ? '<a class="btn btn-ghost btn-sm" href="' + esc(b.meeting_url) + '" target="_blank" rel="noopener noreferrer">الحضور</a>'
            : '') +
        '</div></div>';
    }).join('');
  }

  function notice(kind, text) {
    el('notice').innerHTML =
      '<div class="note-strip" style="' +
        (kind === 'bad'
          ? 'background:color-mix(in srgb,var(--dn) 11%,transparent);border-color:color-mix(in srgb,var(--dn) 28%,transparent);color:var(--dn)'
          : '') + '">' +
      '<span class="ms">' + (kind === 'bad' ? 'error' : 'check_circle') + '</span>' +
      '<span>' + esc(text) + '</span></div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function book(slotId, btn) {
    if (busy || !uid) return;
    busy = true;
    btn.disabled = true;
    var original = btn.textContent;
    btn.textContent = 'جارٍ الحجز…';

    db.from('bookings').insert({ slot_id: slotId, user_id: uid })
      .select('id').maybeSingle()
      .then(function (res) {
        busy = false;
        btn.disabled = false;
        btn.textContent = original;

        if (res.error) {
          var m = res.error.message || '';
          notice('bad',
            /اكتمل/.test(m) ? 'اكتمل عدد المقاعد في هذه الحصة.' :
            /duplicate|unique/i.test(m) ? 'لديك حجز في هذا الموعد بالفعل.' :
            /row-level|policy/i.test(m) ? 'الحجز يتطلب اشتراكاً نافذاً.' :
            'تعذّر الحجز: ' + m);
          load();
          return;
        }

        notice('ok', 'تم حجز موعدك. يصلك تأكيد على بريدك.');
        load();

        /* الإشعار من الخادم. فشله لا يلغي الحجز، والصف يبقى في السجل للإدارة. */
        if (res.data && res.data.id) {
          db.functions.invoke('notify-booking', { body: { booking_id: res.data.id } })
            .catch(function () {});
        }
      });
  }

  function cancel(slotId, btn) {
    if (busy) return;
    if (!window.confirm('إلغاء حجزك في هذا الموعد؟')) return;
    busy = true;
    btn.disabled = true;

    db.from('bookings').delete().eq('slot_id', slotId).then(function (res) {
      busy = false;
      btn.disabled = false;
      if (res.error) { notice('bad', 'تعذّر الإلغاء: ' + res.error.message); return; }
      notice('ok', 'أُلغي حجزك.');
      load();
    });
  }
})();
