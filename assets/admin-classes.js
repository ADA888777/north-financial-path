/* تبويب الحصص والحجوزات: جدولة الحصص، ومتابعة من حجز.
   السعة مفروضة بمشغّل في القاعدة، فلا يمكن تجاوزها من الواجهة. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A || !A.form) return;

  var db = A.db, el = A.el, esc = A.esc, F = A.form;
  var form = el('cl-form');
  if (!form) return;

  var list = el('cl-list');
  var resetBtn = el('cl-reset');
  var titleBox = el('cl-form-title');
  var bkBox = el('bk-box');
  var bkList = el('bk-list');
  var bkSlot = el('bk-slot');

  var rows = [];
  var seats = {};
  var editing = null;
  var openSlot = null;
  var busy = false;
  var loaded = false;

  var STATUS = { scheduled: 'مجدولة', done: 'انتهت', cancelled: 'ملغاة' };
  var KIND = { live: 'مباشرة جماعية', private: 'كلاس خاص' };

  A.guard().then(function (session) { if (session) load(); });

  window.addEventListener('north:tab', function (e) {
    if (e.detail === 'classes' && loaded) load();
  });

  function kpis() {
    var c = document.querySelectorAll('#cl-kpis .kpi b');
    if (!c.length) return;
    var now = Date.now();
    var upcoming = rows.filter(function (s) {
      return s.status === 'scheduled' && new Date(s.starts_at).getTime() > now;
    });
    var booked = 0, free = 0;
    rows.forEach(function (s) { booked += seats[s.id] || 0; });
    upcoming.forEach(function (s) { free += Math.max(0, s.capacity - (seats[s.id] || 0)); });

    c[0].textContent = F.num(upcoming.length);
    c[1].textContent = F.num(rows.filter(function (s) { return s.published; }).length);
    c[2].textContent = F.num(booked);
    c[3].textContent = F.num(free);
  }

  /* ---------- القائمة ---------- */
  function load() {
    F.loading(list);
    db.from('class_slots').select('*')
      .order('starts_at', { ascending: false })
      .then(function (r) {
        loaded = true;
        if (r.error) { F.failed(list, F.why(r.error)); return; }
        rows = r.data || [];
        /* الإدارة تقرأ كل الحجوزات، فنعدّ المقاعد من الجدول مباشرة */
        return db.from('bookings').select('slot_id').then(function (b) {
          seats = {};
          (b.data || []).forEach(function (x) {
            seats[x.slot_id] = (seats[x.slot_id] || 0) + 1;
          });
          kpis();
          render();
        });
      });
  }

  function render() {
    if (!rows.length) {
      F.empty(list, 'calendar_month', 'لا توجد حصص بعد.<br>أضيفي أول حصة من النموذج أعلاه.');
      return;
    }
    var now = Date.now();
    list.innerHTML = rows.map(function (s) {
      var taken = seats[s.id] || 0;
      var full = taken >= s.capacity;
      var past = new Date(s.starts_at).getTime() <= now;
      return '<div class="srow" data-id="' + esc(s.id) + '">' +
        '<div class="sthumb"><span class="ms">' +
          (s.status === 'cancelled' ? 'event_busy' : 'event') + '</span></div>' +
        '<div class="smeta">' +
          '<h3>' + esc(s.title) + '</h3>' +
          '<div class="line">' +
            '<span class="tag ' + (s.published ? 'tag-ok">منشورة' : 'tag-off">مسودة') + '</span>' +
            '<span class="tag ' + (s.status === 'scheduled' ? 'tag-admin' : 'tag-off') + '">' +
              esc(STATUS[s.status] || s.status) + '</span>' +
            '<span class="tag tag-off">' + esc(KIND[s.kind] || s.kind || 'كلاس خاص') + '</span>' +
            '<span>' + esc(F.fmtDateTime(s.starts_at)) + '</span>' +
            '<span>' + F.num(s.duration_min) + ' دقيقة</span>' +
            '<span style="' + (full ? 'color:var(--a-warn)' : '') + '">' +
              F.num(taken) + ' / ' + F.num(s.capacity) + ' مقعد' + (full ? ' — مكتملة' : '') + '</span>' +
            (past && s.status === 'scheduled' ? '<span style="color:var(--a-fg-3)">مضى موعدها</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="sacts">' +
          '<button class="ib" data-act="bookings" title="الحجوزات"><span class="ms">group</span></button>' +
          '<button class="ib" data-act="toggle" title="' + (s.published ? 'إلغاء النشر' : 'نشر') + '">' +
            '<span class="ms">' + (s.published ? 'visibility_off' : 'visibility') + '</span></button>' +
          '<button class="ib" data-act="edit" title="تعديل"><span class="ms">edit</span></button>' +
          '<button class="ib danger" data-act="del" title="حذف"><span class="ms">delete</span></button>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.srow').forEach(function (row) {
      var s = rows.filter(function (x) { return String(x.id) === row.getAttribute('data-id'); })[0];
      row.querySelector('[data-act=bookings]').addEventListener('click', function () { openBookings(s); });
      row.querySelector('[data-act=toggle]').addEventListener('click', function () { toggle(s); });
      row.querySelector('[data-act=edit]').addEventListener('click', function () { edit(s); });
      row.querySelector('[data-act=del]').addEventListener('click', function () { remove(s); });
    });
  }

  function toggle(s) {
    db.from('class_slots').update({ published: !s.published }).eq('id', s.id).then(function (r) {
      if (r.error) { A.toast('تعذّر التغيير: ' + F.why(r.error), 'bad'); return; }
      A.toast(s.published ? 'أُلغي نشر الحصة.' : 'نُشرت الحصة.');
      load();
    });
  }

  function remove(s) {
    var taken = seats[s.id] || 0;
    var warn = taken
      ? '\nيوجد ' + taken + ' حجز على هذه الحصة وسيُحذف معها.'
      : '';
    if (!window.confirm('حذف «' + s.title + '» نهائياً؟' + warn)) return;
    db.from('class_slots').delete().eq('id', s.id).then(function (r) {
      if (r.error) { A.toast('تعذّر الحذف: ' + F.why(r.error), 'bad'); return; }
      A.toast('حُذفت الحصة.');
      if (editing && editing.id === s.id) reset();
      if (openSlot && openSlot.id === s.id) closeBookings();
      load();
    });
  }

  /* ---------- النموذج ---------- */
  function edit(s) {
    editing = s;
    titleBox.textContent = 'تعديل الحصة';
    el('cl-title').value = s.title || '';
    el('cl-start').value = F.isoToLocal(s.starts_at);
    el('cl-desc').value = s.description || '';
    el('cl-dur').value = s.duration_min;
    el('cl-cap').value = s.capacity;
    el('cl-url').value = s.meeting_url || '';
    el('cl-kind').value = s.kind || 'private';
    el('cl-status').value = s.status;
    el('cl-pub').checked = !!s.published;
    resetBtn.hidden = false;
    F.clearErrs(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function reset() {
    editing = null;
    titleBox.textContent = 'إضافة حصة';
    form.reset();
    el('cl-dur').value = '60';
    el('cl-cap').value = '10';
    el('cl-kind').value = 'live';
    el('cl-status').value = 'scheduled';
    resetBtn.hidden = true;
    F.clearErrs(form);
  }

  resetBtn.addEventListener('click', reset);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    F.clearErrs(form);

    var title = el('cl-title').value.trim();
    if (!title) {
      F.fieldErr('cl-title', 'عنوان الحصة مطلوب.');
      el('cl-title').focus();
      return;
    }

    var startsAt = F.localToIso(el('cl-start').value);
    if (!startsAt) {
      F.fieldErr('cl-start', 'حدّدي موعد البداية.');
      el('cl-start').focus();
      return;
    }

    var dur = F.int(el('cl-dur').value, 0);
    if (dur <= 0) {
      F.fieldErr('cl-dur', 'المدة رقم أكبر من صفر.');
      el('cl-dur').focus();
      return;
    }

    var cap = F.int(el('cl-cap').value, 0);
    if (cap <= 0) {
      F.fieldErr('cl-cap', 'عدد المقاعد رقم أكبر من صفر.');
      el('cl-cap').focus();
      return;
    }
    if (editing && cap < (seats[editing.id] || 0)) {
      F.fieldErr('cl-cap', 'يوجد ' + (seats[editing.id] || 0) + ' حجز بالفعل. لا تقلّي المقاعد عنها.');
      el('cl-cap').focus();
      return;
    }

    var payload = {
      title: title,
      starts_at: startsAt,
      description: el('cl-desc').value.trim(),
      duration_min: dur,
      capacity: cap,
      meeting_url: el('cl-url').value.trim() || null,
      kind: el('cl-kind').value,
      status: el('cl-status').value,
      published: el('cl-pub').checked
    };

    busy = true;
    F.busy(form, true);

    var q = editing
      ? db.from('class_slots').update(payload).eq('id', editing.id)
      : db.from('class_slots').insert(payload);

    q.then(function (r) {
      busy = false;
      F.busy(form, false, 'حفظ الحصة');
      if (r.error) { A.toast('تعذّر الحفظ: ' + F.why(r.error), 'bad'); return; }
      A.toast(editing ? 'حُفظت التعديلات.' : 'أُضيفت الحصة.');
      reset();
      load();
    });
  });

  /* ---------- الحجوزات ---------- */
  function openBookings(s) {
    openSlot = s;
    bkSlot.textContent = s.title;
    bkBox.hidden = false;
    loadBookings();
    bkBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function closeBookings() {
    openSlot = null;
    bkBox.hidden = true;
  }

  el('bk-close').addEventListener('click', closeBookings);

  function loadBookings() {
    if (!openSlot) return;
    F.loading(bkList);
    db.from('bookings').select('*').eq('slot_id', openSlot.id)
      .order('created_at', { ascending: true })
      .then(function (r) {
        if (r.error) { F.failed(bkList, F.why(r.error)); return; }
        var bookings = r.data || [];
        if (!bookings.length) {
          F.empty(bkList, 'group_off', 'لا حجوزات على هذه الحصة بعد.');
          return;
        }
        var ids = bookings.map(function (b) { return b.user_id; });
        db.from('profiles').select('id, full_name, email, membership_no').in('id', ids)
          .then(function (p) {
            var byId = {};
            (p.data || []).forEach(function (x) { byId[x.id] = x; });
            renderBookings(bookings, byId);
          });
      });
  }

  function renderBookings(bookings, byId) {
    var BK = { booked: 'محجوز', attended: 'حضر', no_show: 'لم يحضر' };
    bkList.innerHTML =
      '<div class="tbl-wrap"><table class="tbl">' +
        '<thead><tr>' +
          '<th>العضو</th><th>البريد</th><th>رقم العضوية</th>' +
          '<th>تيليجرام</th><th>الحالة</th><th>تاريخ الحجز</th><th></th>' +
        '</tr></thead><tbody>' +
        bookings.map(function (b) {
          var m = byId[b.user_id] || {};
          return '<tr data-id="' + esc(b.id) + '">' +
            '<td>' + esc(m.full_name || '—') + '</td>' +
            '<td><span class="num">' + esc(m.email || '—') + '</span></td>' +
            '<td><span class="num">' + esc(m.membership_no || '—') + '</span></td>' +
            '<td><span class="num">' +
              (b.telegram ? '@' + esc(String(b.telegram).replace(/^@+/, '')) : '—') +
            '</span></td>' +
            '<td>' +
              '<select class="bk-status" style="padding:7px 10px;font-size:13px">' +
                Object.keys(BK).map(function (k) {
                  return '<option value="' + k + '"' + (b.status === k ? ' selected' : '') + '>' +
                    BK[k] + '</option>';
                }).join('') +
              '</select>' +
            '</td>' +
            '<td class="muted">' + esc(F.fmtDateTime(b.created_at)) + '</td>' +
            '<td><button class="ib danger" data-act="del" title="إلغاء الحجز">' +
              '<span class="ms">delete</span></button></td>' +
          '</tr>';
        }).join('') +
      '</tbody></table></div>';

    bkList.querySelectorAll('tr[data-id]').forEach(function (tr) {
      var id = tr.getAttribute('data-id');

      /* الحضور يمرّ بـadmin_set_attendance لا بكتابة مباشرة:
         الدالة ترفض تسجيل حضور قبل انتهاء الجلسة، وتكتب لحظة
         التسجيل ومن سجّله، وتقيّده في السجلّ الإداري. */
      tr.querySelector('.bk-status').addEventListener('change', function (e) {
        var sel = e.target, value = sel.value;
        sel.disabled = true;
        db.rpc('admin_set_attendance', { p_booking: id, p_status: value })
          .then(function (r) {
            sel.disabled = false;
            var d = (r && r.data) || {};
            if (r.error || d.error) {
              A.toast(d.error || F.why(r.error), 'bad');
              loadBookings();
              return;
            }
            A.toast(d.message || 'حُدّثت حالة الحضور.');
            loadBookings();
          })
          .catch(function () { sel.disabled = false; loadBookings(); });
      });

      tr.querySelector('[data-act=del]').addEventListener('click', function () {
        if (!window.confirm('إلغاء هذا الحجز وتحرير المقعد؟')) return;
        db.from('bookings').delete().eq('id', id).then(function (r) {
          if (r.error) { A.toast('تعذّر الإلغاء: ' + F.why(r.error), 'bad'); return; }
          A.toast('أُلغي الحجز.');
          loadBookings();
          load();
        });
      });
    });
  }
})();
