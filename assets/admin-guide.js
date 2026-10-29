/* دليل المبتدئين — بطاقات إرشادية ثابتة.
   مستقلّ عن الخارطة ونظام فتح الدروس عمداً: ما يُكتب هنا يراه كل
   متعلم سجّل دخوله، أياً كانت باقته وأياً كان تقدّمه. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A || !A.form) return;
  var db = A.db, el = A.el, esc = A.esc, F = A.form;

  var panel = document.querySelector('[data-panel="guide"]');
  if (!panel) return;

  var rows = [], editing = null, busy = false;
  var form = el('gd-form'), list = el('gd-list');

  function reset() {
    editing = null;
    el('gd-title').value = '';
    el('gd-body').value = '';
    el('gd-icon').value = 'menu_book';
    el('gd-accent').value = 'blue';
    el('gd-order').value = rows.length ? (rows.length * 10) : 0;
    el('gd-goal').checked = false;
    el('gd-pub').checked = true;
    el('gd-cancel').hidden = true;
    F.clearErrs(form);
  }

  function draw() {
    if (!rows.length) {
      F.empty(list, 'lightbulb',
        'لا توجد بطاقات بعد.<br>أضيفي أول بطاقة من النموذج أعلاه، وستظهر فوراً لكل المتعلمات.');
      return;
    }
    list.innerHTML = rows.map(function (g) {
      return '<div class="srow" data-id="' + esc(g.id) + '">' +
        '<div class="sthumb lv-sw ' + esc(g.accent || 'blue') + '">' +
          '<span class="ms">' + esc(g.icon || 'check_circle') + '</span></div>' +
        '<div class="smeta">' +
          '<h3>' + esc(g.title) + (g.is_goal ? ' <span class="tag tag-ok">بطاقة الهدف</span>' : '') + '</h3>' +
          '<div class="line">' +
            '<span class="tag ' + (g.published ? 'tag-ok">منشورة' : 'tag-off">مسودة') + '</span>' +
            '<span>ترتيب ' + esc(g.sort_order) + '</span>' +
            (g.body ? '<span>' + esc(String(g.body).slice(0, 70)) + '…</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="sacts">' +
          '<button class="ib" data-act="toggle" title="' + (g.published ? 'إلغاء النشر' : 'نشر') + '">' +
            '<span class="ms">' + (g.published ? 'visibility_off' : 'visibility') + '</span></button>' +
          '<button class="ib" data-act="edit" title="تعديل"><span class="ms">edit</span></button>' +
          '<button class="ib danger" data-act="del" title="حذف"><span class="ms">delete</span></button>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.srow').forEach(function (row) {
      var g = rows.filter(function (x) { return String(x.id) === row.getAttribute('data-id'); })[0];
      row.querySelector('[data-act=toggle]').addEventListener('click', function () {
        db.from('guide_steps').update({ published: !g.published }).eq('id', g.id)
          .then(function (r) {
            if (r.error) { A.toast('تعذّر التغيير: ' + F.why(r.error), 'bad'); return; }
            A.toast(g.published ? 'أُلغي نشر البطاقة.' : 'نُشرت البطاقة.');
            load();
          });
      });
      row.querySelector('[data-act=edit]').addEventListener('click', function () { edit(g); });
      row.querySelector('[data-act=del]').addEventListener('click', function () {
        if (!window.confirm('حذف بطاقة «' + g.title + '»؟')) return;
        db.from('guide_steps').delete().eq('id', g.id).then(function (r) {
          if (r.error) { A.toast('تعذّر الحذف: ' + F.why(r.error), 'bad'); return; }
          A.toast('حُذفت البطاقة.');
          if (editing && editing.id === g.id) reset();
          load();
        });
      });
    });
  }

  function edit(g) {
    editing = g;
    el('gd-title').value = g.title || '';
    el('gd-body').value = g.body || '';
    el('gd-icon').value = g.icon || 'check_circle';
    el('gd-accent').value = g.accent || 'blue';
    el('gd-order').value = g.sort_order == null ? 0 : g.sort_order;
    el('gd-goal').checked = !!g.is_goal;
    el('gd-pub').checked = !!g.published;
    el('gd-cancel').hidden = false;
    el('gd-title').focus();
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  el('gd-cancel').addEventListener('click', reset);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    F.clearErrs(form);

    var title = el('gd-title').value.trim();
    if (!title) {
      F.fieldErr('gd-title', 'عنوان البطاقة مطلوب.');
      el('gd-title').focus();
      return;
    }

    var payload = {
      title: title,
      body: el('gd-body').value.trim(),
      icon: el('gd-icon').value,
      accent: el('gd-accent').value,
      is_goal: el('gd-goal').checked,
      sort_order: F.int(el('gd-order').value, 0),
      published: el('gd-pub').checked
    };

    busy = true;
    F.busy(form, true);
    var q = editing
      ? db.from('guide_steps').update(payload).eq('id', editing.id)
      : db.from('guide_steps').insert(payload);

    q.then(function (r) {
      busy = false;
      F.busy(form, false, 'حفظ البطاقة');
      if (r.error) { A.toast('تعذّر الحفظ: ' + F.why(r.error), 'bad'); return; }
      A.toast(editing ? 'حُفظت التعديلات.' : 'أُضيفت البطاقة.');
      reset();
      load();
    });
  });

  function load() {
    return db.rpc('admin_guide_steps').then(function (r) {
      var d = (r && r.data);
      if (r.error || (d && d.error)) {
        F.empty(list, 'error', esc((d && d.error) || r.error.message));
        return;
      }
      rows = Array.isArray(d) ? d : [];
      draw();
      if (!editing) el('gd-order').value = rows.length ? (rows.length * 10) : 0;
    });
  }

  A.guard().then(function (s) { if (s) load(); });
})();
