/* تبويب المستويات: إضافة وتعديل ونشر وحذف.
   المستوى وعاء للدروس والاختبارات، وحذفه لا يحذفها بل يفكّ ارتباطها. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A || !A.form) return;

  var db = A.db, el = A.el, esc = A.esc, F = A.form;
  var form = el('lv-form');
  if (!form) return;

  var list = el('lv-list');
  var resetBtn = el('lv-reset');
  var titleBox = el('lv-form-title');
  var trackSel = el('lv-track');
  var rows = [];
  var tracks = [];
  var editing = null;
  var busy = false;
  var loaded = false;

  A.guard().then(function (session) { if (session) { fillTracks(); load(); } });

  /* يعيد التحميل عند فتح التبويب حتى تظهر تغييرات تبويب آخر */
  window.addEventListener('north:tab', function (e) {
    if (e.detail === 'levels' && loaded) { fillTracks(); load(); }
  });
  window.addEventListener('north:tracks', function (e) { paintTracks(e.detail || []); });

  /* ---------- قائمة المسارات ---------- */
  function fillTracks() {
    if (!trackSel) return;
    db.from('tracks').select('id, title').order('sort_order').then(function (r) {
      if (!r.error) paintTracks(r.data || []);
    });
  }

  function paintTracks(data) {
    if (!trackSel) return;
    tracks = data;
    var keep = trackSel.value;
    trackSel.innerHTML = '<option value="">بلا مسار</option>' + tracks.map(function (t) {
      return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>';
    }).join('');
    if (keep) trackSel.value = keep;
  }

  function trackName(id) {
    if (!id) return '';
    var hit = tracks.filter(function (t) { return t.id === id; })[0];
    return hit ? hit.title : '';
  }

  function kpis() {
    var cells = document.querySelectorAll('#lv-kpis .kpi b');
    if (!cells.length) return;
    var pub = rows.filter(function (r) { return r.published; }).length;
    cells[0].textContent = F.num(pub);
    cells[1].textContent = F.num(rows.length - pub);
  }

  function load() {
    F.loading(list);
    db.from('levels').select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(function (r) {
        loaded = true;
        if (r.error) { F.failed(list, F.why(r.error)); return; }
        rows = r.data || [];
        kpis();
        render();
        window.dispatchEvent(new CustomEvent('north:levels', { detail: rows }));
      });
  }

  function render() {
    if (!rows.length) {
      F.empty(list, 'stairs', 'لا توجد مستويات بعد.<br>أضيفي أول مستوى من النموذج أعلاه.');
      return;
    }
    list.innerHTML = rows.map(function (lv) {
      return '<div class="srow" data-id="' + esc(lv.id) + '">' +
        '<div class="sthumb"><span class="ms">stairs</span></div>' +
        '<div class="smeta">' +
          '<h3>' + esc(lv.title) + '</h3>' +
          '<div class="line">' +
            '<span class="tag ' + (lv.published ? 'tag-ok">منشور' : 'tag-off">مسودة') + '</span>' +
            '<span>ترتيب ' + esc(lv.sort_order) + '</span>' +
            (lv.track_id
              ? '<span>' + esc(trackName(lv.track_id) || 'مسار') + '</span>'
              : '<span style="color:var(--a-warn)">بلا مسار</span>') +
            (lv.subtitle ? '<span>' + esc(lv.subtitle) + '</span>' : '') +
            '<span>آخر تعديل ' + esc(A.fmtDate(lv.updated_at)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="sacts">' +
          '<button class="ib" data-act="toggle" title="' + (lv.published ? 'إلغاء النشر' : 'نشر') + '">' +
            '<span class="ms">' + (lv.published ? 'visibility_off' : 'visibility') + '</span></button>' +
          '<button class="ib" data-act="edit" title="تعديل"><span class="ms">edit</span></button>' +
          '<button class="ib danger" data-act="del" title="حذف"><span class="ms">delete</span></button>' +
        '</div>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.srow').forEach(function (row) {
      var lv = rows.filter(function (x) { return String(x.id) === row.getAttribute('data-id'); })[0];
      row.querySelector('[data-act=toggle]').addEventListener('click', function () { toggle(lv); });
      row.querySelector('[data-act=edit]').addEventListener('click', function () { edit(lv); });
      row.querySelector('[data-act=del]').addEventListener('click', function () { remove(lv); });
    });
  }

  function toggle(lv) {
    db.from('levels').update({ published: !lv.published }).eq('id', lv.id).then(function (r) {
      if (r.error) { A.toast('تعذّر التغيير: ' + F.why(r.error), 'bad'); return; }
      A.toast(lv.published ? 'أُلغي نشر المستوى.' : 'نُشر المستوى.');
      load();
    });
  }

  function remove(lv) {
    if (!window.confirm('حذف المستوى «' + lv.title + '»؟\nالدروس والاختبارات المرتبطة به لا تُحذف، لكنها تصبح بلا مستوى.')) return;
    db.from('levels').delete().eq('id', lv.id).then(function (r) {
      if (r.error) { A.toast('تعذّر الحذف: ' + F.why(r.error), 'bad'); return; }
      A.toast('حُذف المستوى.');
      if (editing && editing.id === lv.id) reset();
      load();
    });
  }

  function edit(lv) {
    editing = lv;
    titleBox.textContent = 'تعديل المستوى';
    el('lv-title').value = lv.title || '';
    el('lv-subtitle').value = lv.subtitle || '';
    if (trackSel) trackSel.value = lv.track_id || '';
    el('lv-desc').value = lv.description || '';
    el('lv-order').value = lv.sort_order;
    if (el('lv-code')) el('lv-code').value = lv.code || '';
    el('lv-pub').checked = !!lv.published;
    resetBtn.hidden = false;
    F.clearErrs(form);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function reset() {
    editing = null;
    titleBox.textContent = 'إضافة مستوى';
    form.reset();
    el('lv-order').value = '0';
    if (el('lv-code')) el('lv-code').value = '';
    if (trackSel) trackSel.value = '';
    resetBtn.hidden = true;
    F.clearErrs(form);
  }

  resetBtn.addEventListener('click', reset);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    F.clearErrs(form);

    var title = el('lv-title').value.trim();
    if (!title) {
      F.fieldErr('lv-title', 'عنوان المستوى مطلوب.');
      el('lv-title').focus();
      return;
    }

    var payload = {
      title: title,
      subtitle: el('lv-subtitle').value.trim() || null,
      track_id: trackSel && trackSel.value ? trackSel.value : null,
      description: el('lv-desc').value.trim(),
      code: el('lv-code') ? (el('lv-code').value.trim() || null) : null,
      sort_order: F.int(el('lv-order').value, 0),
      published: el('lv-pub').checked
    };

    busy = true;
    F.busy(form, true);

    var q = editing
      ? db.from('levels').update(payload).eq('id', editing.id)
      : db.from('levels').insert(payload);

    q.then(function (r) {
      busy = false;
      F.busy(form, false, 'حفظ المستوى');
      if (r.error) { A.toast('تعذّر الحفظ: ' + F.why(r.error), 'bad'); return; }
      A.toast(editing ? 'حُفظت التعديلات.' : 'أُضيف المستوى.');
      reset();
      load();
    });
  });
})();
