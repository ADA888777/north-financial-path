/* الكوتشات وجداول توفّرهم.
   التوفّر أسبوعي متكرّر، ومنه تُولَّد مواعيد الحجز في الخادم. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc;

  var panel = document.querySelector('[data-panel="coaches"]');
  if (!panel) return;

  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var rows = [], avail = [], sessions = 0, busy = false, sheet = null, editing = null;

  function kpis() {
    var c = panel.querySelectorAll('#co-kpis .kpi b');
    if (c.length < 3) return;
    c[0].textContent = rows.filter(function (x) { return x.active; }).length;
    c[1].textContent = avail.filter(function (x) { return x.active; }).length;
    c[2].textContent = sessions;
  }

  function hhmm(t) { return String(t || '').slice(0, 5); }

  function draw() {
    if (!rows.length) {
      el('co-list').innerHTML = '<div class="state"><span class="ms">person_add</span>' +
        'لا يوجد كوتشات. أضف كوتشاً ليظهر للمشتركات في صفحة الكلاسات الخاصة.</div>';
      kpis(); return;
    }
    el('co-list').innerHTML = rows.map(function (c) {
      var av = avail.filter(function (a) { return a.coach_id === c.id; })
        .sort(function (a, b) { return a.weekday - b.weekday || a.start_time.localeCompare(b.start_time); });
      return '<div class="co-card">' +
        '<div class="co-h">' +
          '<div><b>' + esc(c.name) + '</b>' +
            (c.title ? '<span class="muted"> · ' + esc(c.title) + '</span>' : '') +
            '<span class="co-meta">' + esc(c.slot_min) + ' دقيقة للجلسة' +
              (c.telegram ? ' · ' + esc(c.telegram) : '') + '</span></div>' +
          (c.active ? '<span class="tag tag-ok">مفعّل</span>' : '<span class="tag tag-off">معطّل</span>') +
          '<div class="co-btns">' +
            '<button class="bt bt-ghost bt-sm" type="button" data-co="' + esc(c.id) + '">تعديل</button>' +
            '<button class="bt bt-ghost bt-sm" type="button" data-co-del="' + esc(c.id) + '">حذف</button>' +
          '</div>' +
        '</div>' +
        '<div class="av">' +
          (av.length
            ? av.map(function (a) {
                return '<span class="av-i' + (a.active ? '' : ' off') + '">' +
                  esc(DAYS[a.weekday]) + ' ' + esc(hhmm(a.start_time)) + '–' + esc(hhmm(a.end_time)) +
                  '<button type="button" data-av-del="' + esc(a.id) + '" aria-label="حذف">&times;</button>' +
                  '</span>';
              }).join('')
            : '<span class="muted">بلا أوقات توفّر — لن تظهر له مواعيد للحجز.</span>') +
        '</div>' +
        '<form class="av-add" data-coach="' + esc(c.id) + '">' +
          '<select name="d">' + DAYS.map(function (d, i) {
            return '<option value="' + i + '">' + d + '</option>'; }).join('') + '</select>' +
          '<input name="s" type="time" value="16:00" step="900">' +
          '<input name="e" type="time" value="20:00" step="900">' +
          '<button class="bt bt-soft bt-sm" type="submit">أضف وقتاً</button>' +
        '</form>' +
      '</div>';
    }).join('');

    el('co-list').querySelectorAll('.av-add').forEach(function (f) {
      f.addEventListener('submit', function (e) { e.preventDefault(); addAvail(f); });
    });
    kpis();
  }

  function load() {
    el('co-list').innerHTML = '<div class="state"><span class="ms">hourglass_top</span>جارٍ التحميل…</div>';
    return Promise.all([
      db.from('coaches').select('*').order('sort_order'),
      db.from('coach_availability').select('*'),
      db.from('class_slots').select('id', { count: 'exact', head: true })
        .eq('kind', 'private').eq('status', 'scheduled')
    ]).then(function (r) {
      if (r[0].error) {
        el('co-list').innerHTML = '<div class="state"><span class="ms">error</span>' +
          esc(r[0].error.message) + '</div>';
        return;
      }
      rows = r[0].data || [];
      avail = (!r[1].error && r[1].data) || [];
      sessions = (!r[2].error && r[2].count) || 0;
      draw();
    });
  }

  function addAvail(form) {
    var d = form.querySelector('[name=d]').value;
    var s = form.querySelector('[name=s]').value;
    var e = form.querySelector('[name=e]').value;
    if (!s || !e || e <= s) { A.toast('وقت النهاية يجب أن يكون بعد البداية', 'bad'); return; }
    db.from('coach_availability').insert({
      coach_id: form.getAttribute('data-coach'),
      weekday: parseInt(d, 10), start_time: s, end_time: e, active: true
    }).then(function (r) {
      if (r.error) { A.toast(r.error.message, 'bad'); return; }
      A.toast('أُضيف وقت التوفّر', 'ok');
      load();
    });
  }

  /* ---------- نموذج الكوتش ---------- */
  function shell() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'co-sheet';
    sheet.innerHTML = '<div class="sheet-in" role="dialog" aria-modal="true">' +
      '<div class="sheet-h"><h2 id="co-title">كوتش</h2>' +
      '<button class="bt bt-ghost bt-sm" type="button" id="co-x">إغلاق</button></div>' +
      '<div class="grid2">' +
        '<div class="fld"><label for="co-name">الاسم <span class="req">*</span></label>' +
          '<input id="co-name" type="text" maxlength="80"></div>' +
        '<div class="fld"><label for="co-job">الصفة</label>' +
          '<input id="co-job" type="text" maxlength="80" placeholder="محلل فني"></div>' +
        '<div class="fld"><label for="co-min">مدة الجلسة بالدقائق</label>' +
          '<input id="co-min" type="number" min="15" max="180" step="15" value="60"></div>' +
        '<div class="fld"><label for="co-tg">تيليجرام</label>' +
          '<input id="co-tg" type="text" dir="ltr" maxlength="60" placeholder="@username"></div>' +
      '</div>' +
      '<div class="fld"><label for="co-bio">نبذة</label>' +
        '<textarea id="co-bio" maxlength="300"></textarea></div>' +
      '<div class="grid2">' +
        '<div class="fld"><label for="co-sort">الترتيب</label>' +
          '<input id="co-sort" type="number" value="0"></div>' +
        '<div class="fld" style="justify-content:flex-end">' +
          '<label class="chk" for="co-act"><input type="checkbox" id="co-act" checked>' +
          '<span>مفعّل ويظهر للمشتركات</span></label></div>' +
      '</div>' +
      '<p class="bad-msg" id="co-err" style="display:none"></p>' +
      '<div class="sheet-f">' +
        '<button class="bt bt-main" type="button" id="co-save">حفظ</button>' +
        '<button class="bt bt-ghost" type="button" id="co-cancel">إلغاء</button>' +
      '</div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    el('co-x').addEventListener('click', close);
    el('co-cancel').addEventListener('click', close);
    el('co-save').addEventListener('click', save);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('on')) close();
    });
    return sheet;
  }

  function close() { if (sheet) sheet.classList.remove('on'); editing = null; }

  function open(c) {
    shell().classList.add('on');
    editing = c || null;
    el('co-title').textContent = c ? 'تعديل: ' + c.name : 'إضافة كوتش';
    el('co-err').style.display = 'none';
    el('co-name').value = c ? c.name : '';
    el('co-job').value = c ? (c.title || '') : '';
    el('co-min').value = c ? c.slot_min : 60;
    el('co-tg').value = c ? (c.telegram || '') : '';
    el('co-bio').value = c ? (c.bio || '') : '';
    el('co-sort').value = c ? (c.sort_order || 0) : rows.length + 1;
    el('co-act').checked = c ? !!c.active : true;
    el('co-name').focus();
  }

  function save() {
    if (busy) return;
    var name = (el('co-name').value || '').trim();
    if (!name) {
      el('co-err').textContent = 'الاسم مطلوب';
      el('co-err').style.display = 'block';
      return;
    }
    busy = true;
    var b = el('co-save'); b.disabled = true; b.textContent = 'جارٍ الحفظ…';
    var payload = {
      name: name,
      title: el('co-job').value.trim(),
      bio: el('co-bio').value.trim(),
      telegram: el('co-tg').value.trim().replace(/^@/, '') || null,
      slot_min: parseInt(el('co-min').value, 10) || 60,
      sort_order: parseInt(el('co-sort').value, 10) || 0,
      active: el('co-act').checked,
      updated_at: new Date().toISOString()
    };
    var q = editing
      ? db.from('coaches').update(payload).eq('id', editing.id)
      : db.from('coaches').insert(payload);

    q.then(function (r) {
      busy = false; b.disabled = false; b.textContent = 'حفظ';
      if (r.error) {
        el('co-err').textContent = r.error.message;
        el('co-err').style.display = 'block';
        return;
      }
      A.toast(editing ? 'حُفظ الكوتش' : 'أُضيف الكوتش', 'ok');
      close(); load();
    });
  }

  el('co-add').addEventListener('click', function () { open(null); });
  el('co-list').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-co]');
    if (ed) { open(rows.filter(function (x) { return x.id === ed.getAttribute('data-co'); })[0]); return; }

    var dl = e.target.closest('[data-co-del]');
    if (dl) {
      var c = rows.filter(function (x) { return x.id === dl.getAttribute('data-co-del'); })[0];
      if (!c) return;
      if (!window.confirm('حذف «' + c.name + '»؟ ستُحذف أوقات توفّره، ' +
                          'وتبقى الجلسات المحجوزة بلا كوتش.')) return;
      db.from('coaches').delete().eq('id', c.id).then(function (r) {
        if (r.error) { A.toast(r.error.message, 'bad'); return; }
        A.toast('حُذف الكوتش', 'ok'); load();
      });
      return;
    }

    var av = e.target.closest('[data-av-del]');
    if (av) {
      db.from('coach_availability').delete().eq('id', av.getAttribute('data-av-del'))
        .then(function (r) {
          if (r.error) { A.toast(r.error.message, 'bad'); return; }
          load();
        });
    }
  });

  A.guard().then(function (s) { if (s) load(); });
})();
