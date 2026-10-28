/* تبويب المسارات: المسار يجمع المستويات، و«للمبتدئين» هو ما يغذّي
   دالة beginner_guide() في صفحة المتعلم. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A || !A.form) return;

  var db = A.db, el = A.el, esc = A.esc, F = A.form;
  var form = el('tr-form');
  if (!form) return;

  var list = el('tr-list');
  var resetBtn = el('tr-reset');
  var titleBox = el('tr-form-title');

  var rows = [];
  var levelCount = {};
  var editing = null;
  var busy = false;
  var loaded = false;

  A.guard().then(function (session) { if (session) load(); });

  window.addEventListener('north:tab', function (e) {
    if (e.detail === 'tracks' && loaded) load();
  });

  function kpis() {
    var c = document.querySelectorAll('#tr-kpis .kpi b');
    if (!c.length) return;
    var pub = rows.filter(function (t) { return t.published; }).length;
    c[0].textContent = F.num(pub);
    c[1].textContent = F.num(rows.length - pub);
    c[2].textContent = F.num(rows.filter(function (t) { return t.for_beginners; }).length);
  }

  function load() {
    F.loading(list);
    db.from('tracks').select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(function (r) {
        loaded = true;
        if (r.error) { F.failed(list, F.why(r.error)); return; }
        rows = r.data || [];
        /* عدد المستويات في كل مسار: مؤشر على أن المسار ليس فارغاً */
        return db.from('levels').select('track_id').then(function (lv) {
          levelCount = {};
          (lv.data || []).forEach(function (x) {
            if (x.track_id) levelCount[x.track_id] = (levelCount[x.track_id] || 0) + 1;
          });
          kpis();
          render();
          window.dispatchEvent(new CustomEvent('north:tracks', { detail: rows }));
        });
      });
  }

  function render() {
    if (!rows.length) {
      F.empty(list, 'route', 'لا توجد مسارات بعد.<br>أضيفي أول مسار من النموذج أعلاه.');
      return;
    }
    list.innerHTML = rows.map(function (t) {
      var n = levelCount[t.id] || 0;
      return '<div class="srow" data-id="' + esc(t.id) + '">' +
        '<div class="sthumb"><span class="ms">route</span></div>' +
        '<div class="smeta">' +
          '<h3>' + esc(t.title) + '</h3>' +
          '<div class="line">' +
            '<span class="tag ' + (t.published ? 'tag-ok">منشور' : 'tag-off">مسودة') + '</span>' +
            (t.for_beginners ? '<span class="tag tag-admin">للمبتدئين</span>' : '') +
            (t.level_label ? '<span>' + esc(t.level_label) + '</span>' : '') +
            '<span>' + F.num(n) + ' مستوى</span>' +
            '<span>ترتيب ' + esc(t.sort_order) + '</span>' +
          '</div>' +
          (t.published && n === 0
            ? '<div class="line" style="color:var(--a-warn);margin-top:6px">منشور بلا مستويات — اربطي مستوياته من تبويب المستويات.</div>'
            : '') +
        '</div>' +
        '<div class="sacts">' +
          '<button class="ib" data-act="beg" title="' + (t.for_beginners ? 'إخراج من دليل المبتدئين' : 'إضافة إلى دليل المبتدئين') + '">' +
            '<span class="ms">' + (t.for_beginners ? 'school' : 'school' ) + '</span></button>' +
          '<button class="ib" data-act="toggle" title="' + (t.published ? 'إلغاء النشر' : 'نشر') + '">' +
            '<span class="ms">' + (t.published ? 'visibility_off' : 'visibility') + '</span></button>' +
          '<button class="ib" data-act="edit" title="تعديل"><span class="ms">edit</span></button>' +
          '<button class="ib danger" data-act="del" title="حذف"><span class="ms">delete</span></button>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.srow').forEach(function (row) {
      var t = rows.filter(function (x) { return String(x.id) === row.getAttribute('data-id'); })[0];
      row.querySelector('[data-act=beg]').addEventListener('click', function () { flag(t); });
      row.querySelector('[data-act=toggle]').addEventListener('click', function () { toggle(t); });
      row.querySelector('[data-act=edit]').addEventListener('click', function () { edit(t); });
      row.querySelector('[data-act=del]').addEventListener('click', function () { remove(t); });
    });
  }

  function flag(t) {
    db.from('tracks').update({ for_beginners: !t.for_beginners }).eq('id', t.id).then(function (r) {
      if (r.error) { A.toast('تعذّر التغيير: ' + F.why(r.error), 'bad'); return; }
      A.toast(t.for_beginners ? 'أُخرج المسار من دليل المبتدئين.' : 'أُضيف المسار إلى دليل المبتدئين.');
      load();
    });
  }

  function toggle(t) {
    db.from('tracks').update({ published: !t.published }).eq('id', t.id).then(function (r) {
      if (r.error) { A.toast('تعذّر التغيير: ' + F.why(r.error), 'bad'); return; }
      A.toast(t.published ? 'أُلغي نشر المسار.' : 'نُشر المسار.');
      load();
    });
  }

  function remove(t) {
    var n = levelCount[t.id] || 0;
    var warn = n ? '\nالمستويات المرتبطة به (' + n + ') لا تُحذف، لكنها تصبح بلا مسار.' : '';
    if (!window.confirm('حذف المسار «' + t.title + '»؟' + warn)) return;
    db.from('tracks').delete().eq('id', t.id).then(function (r) {
      if (r.error) { A.toast('تعذّر الحذف: ' + F.why(r.error), 'bad'); return; }
      A.toast('حُذف المسار.');
      if (editing && editing.id === t.id) reset();
      load();
    });
  }

  function edit(t) {
    editing = t;
    titleBox.textContent = 'تعديل المسار';
    el('tr-title').value = t.title || '';
    el('tr-label').value = t.level_label || '';
    el('tr-desc').value = t.description || '';
    el('tr-order').value = t.sort_order;
    el('tr-pub').checked = !!t.published;
    el('tr-beg').checked = !!t.for_beginners;
    resetBtn.hidden = false;
    F.clearErrs(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function reset() {
    editing = null;
    titleBox.textContent = 'إضافة مسار';
    form.reset();
    el('tr-order').value = '0';
    resetBtn.hidden = true;
    F.clearErrs(form);
  }

  resetBtn.addEventListener('click', reset);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    F.clearErrs(form);

    var title = el('tr-title').value.trim();
    if (!title) {
      F.fieldErr('tr-title', 'عنوان المسار مطلوب.');
      el('tr-title').focus();
      return;
    }

    var payload = {
      title: title,
      level_label: el('tr-label').value.trim() || null,
      description: el('tr-desc').value.trim(),
      sort_order: F.int(el('tr-order').value, 0),
      published: el('tr-pub').checked,
      for_beginners: el('tr-beg').checked
    };

    busy = true;
    F.busy(form, true);

    var q = editing
      ? db.from('tracks').update(payload).eq('id', editing.id)
      : db.from('tracks').insert(payload);

    q.then(function (r) {
      busy = false;
      F.busy(form, false, 'حفظ المسار');
      if (r.error) { A.toast('تعذّر الحفظ: ' + F.why(r.error), 'bad'); return; }
      A.toast(editing ? 'حُفظت التعديلات.' : 'أُضيف المسار.');
      reset();
      load();
    });
  });
})();
