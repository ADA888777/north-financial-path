/* إدارة المفردات والتعريفات.
   هذه المادة التي تعمل عليها صفحة «التحدي»: المصطلح يظهر للمتعلم
   ويكتب تعريفه، ويُقارَن جوابه بالتعريف المكتوب هنا. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc;

  var panel = document.querySelector('[data-panel="vocab"]');
  if (!panel) return;

  var rows = [], lessons = [], disputes = [], busy = false, sheet = null, editing = null;
  var timer = null;

  function kpis() {
    var c = panel.querySelectorAll('#vc-kpis .kpi b');
    if (c.length < 3) return;
    var ls = {};
    rows.forEach(function (v) { ls[v.lesson_id] = 1; });
    c[0].textContent = rows.length;
    c[1].textContent = Object.keys(ls).length;
    c[2].textContent = disputes.length;
  }

  /* ---------- القائمة ---------- */
  function draw() {
    var box = el('vc-list');
    if (!rows.length) {
      box.innerHTML = '<div class="state"><span class="ms">translate</span>' +
        'لا توجد مفردات مطابقة. أضف مفردة لتظهر في التحدي.</div>';
      kpis(); return;
    }
    box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>المصطلح</th><th>التعريف المعتمد</th><th>الدرس</th><th>المستوى</th>' +
      '<th>محاولات</th><th></th></tr></thead><tbody>' +
      rows.map(function (v) {
        return '<tr>' +
          '<td><b>' + esc(v.term) + '</b></td>' +
          '<td>' + esc(v.meaning || '') +
            (v.meaning ? '' : '<span class="tag tag-off">بلا تعريف</span>') + '</td>' +
          '<td>' + esc(v.lesson || '—') +
            (v.lesson_published ? '' : ' <span class="tag tag-off">مسودة</span>') + '</td>' +
          '<td class="muted">' + esc(v.level || '—') + '</td>' +
          '<td class="num">' + esc(v.attempts || 0) + '</td>' +
          '<td><button class="bt bt-ghost bt-sm" type="button" data-vc="' + esc(v.id) + '">تعديل</button>' +
            '<button class="bt bt-ghost bt-sm" type="button" data-vc-del="' + esc(v.id) + '">حذف</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
    kpis();
  }

  function load() {
    el('vc-list').innerHTML = '<div class="state"><span class="ms">hourglass_top</span>جارٍ التحميل…</div>';
    return db.rpc('admin_vocab', {
      p_lesson: el('vc-lesson-f').value || null,
      p_q: el('vc-q').value || null
    }).then(function (r) {
      if (r.error) {
        el('vc-list').innerHTML = '<div class="state"><span class="ms">error</span>' +
          esc(r.error.message) + '</div>';
        return;
      }
      rows = r.data || [];
      draw();
    });
  }

  function loadLessons() {
    return db.from('lessons').select('id, title, sort_order, published')
      .order('sort_order').then(function (r) {
        lessons = (!r.error && r.data) || [];
        var opts = lessons.map(function (l) {
          return '<option value="' + esc(l.id) + '">' + esc(l.title) +
                 (l.published ? '' : ' (مسودة)') + '</option>';
        }).join('');
        el('vc-lesson-f').innerHTML = '<option value="">كل الدروس</option>' + opts;
      });
  }

  /* ---------- المراجعات ---------- */
  function drawDisputes() {
    el('vc-dispute-box').hidden = disputes.length === 0;
    if (!disputes.length) { kpis(); return; }
    el('vc-disputes').innerHTML = disputes.map(function (d) {
      return '<div class="disp">' +
        '<div class="disp-h"><b>' + esc(d.term) + '</b>' +
          '<span class="muted">' + esc(d.member || '') + ' · ' + esc(d.lesson || '') + '</span></div>' +
        '<p><span class="disp-l">التعريف المعتمد</span>' + esc(d.meaning) + '</p>' +
        '<p><span class="disp-l">جواب المتعلم</span>' + esc(d.answer) +
          ' <span class="muted">(تطابق ' + esc(d.overlap) + '%)</span></p>' +
        '<div class="disp-f">' +
          '<button class="bt bt-main bt-sm" type="button" data-ok="' +
            esc(d.user_id) + '|' + esc(d.vocab_id) + '">اقبلها واحتسبها</button>' +
          '<button class="bt bt-ghost bt-sm" type="button" data-no="' +
            esc(d.user_id) + '|' + esc(d.vocab_id) + '">اتركها</button>' +
        '</div></div>';
    }).join('');
    kpis();
  }

  function loadDisputes() {
    return db.rpc('admin_disputes').then(function (r) {
      disputes = (!r.error && r.data) || [];
      drawDisputes();
    }).catch(function () {});
  }

  function resolve(pair, accept) {
    var p = pair.split('|');
    db.rpc('admin_resolve_dispute', { p_user: p[0], p_vocab: p[1], p_accept: accept })
      .then(function (r) {
        var d = (r && r.data) || {};
        if (r.error || d.error) { A.toast(d.error || r.error.message, 'bad'); return; }
        A.toast(d.message || 'تم', 'ok');
        loadDisputes();
      }).catch(function (e) { A.toast((e && e.message) || 'تعذّر', 'bad'); });
  }

  /* ---------- النموذج ---------- */
  function shell() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'vc-sheet';
    sheet.innerHTML = '<div class="sheet-in" role="dialog" aria-modal="true">' +
      '<div class="sheet-h"><h2 id="vc-title">مفردة</h2>' +
      '<button class="bt bt-ghost bt-sm" type="button" id="vc-x">إغلاق</button></div>' +
      '<div class="fld"><label for="vc-lesson">الدرس <span class="req">*</span></label>' +
        '<select id="vc-lesson"></select>' +
        '<span class="hint">المفردة تظهر في التحدي لمن فتح مرحلة هذا الدرس.</span></div>' +
      '<div class="fld"><label for="vc-term">المصطلح <span class="req">*</span></label>' +
        '<input id="vc-term" type="text" maxlength="80" placeholder="المقاومة"></div>' +
      '<div class="fld"><label for="vc-meaning">التعريف المعتمد <span class="req">*</span></label>' +
        '<textarea id="vc-meaning" maxlength="400" placeholder="مستوى سعري يتوقف عنده الصعود عادة"></textarea>' +
        '<span class="hint">يُقارَن جواب المتعلم بكلمات هذا التعريف. اكتبه بالكلمات ' +
          'التي تتوقع أن يستعملها، ومن كتب صياغة أخرى صحيحة يطلب مراجعتك.</span></div>' +
      '<div class="fld"><label for="vc-sort">الترتيب</label>' +
        '<input id="vc-sort" type="number" value="0"></div>' +
      '<p class="bad-msg" id="vc-err" style="display:none"></p>' +
      '<div class="sheet-f">' +
        '<button class="bt bt-main" type="button" id="vc-save">حفظ</button>' +
        '<button class="bt bt-ghost" type="button" id="vc-cancel">إلغاء</button>' +
      '</div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    el('vc-x').addEventListener('click', close);
    el('vc-cancel').addEventListener('click', close);
    el('vc-save').addEventListener('click', save);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('on')) close();
    });
    return sheet;
  }

  function close() { if (sheet) sheet.classList.remove('on'); editing = null; }

  function open(v) {
    shell().classList.add('on');
    editing = v || null;
    el('vc-lesson').innerHTML = lessons.map(function (l) {
      return '<option value="' + esc(l.id) + '"' +
        (v && v.lesson_id === l.id ? ' selected' : '') + '>' + esc(l.title) +
        (l.published ? '' : ' (مسودة)') + '</option>';
    }).join('') || '<option value="">لا توجد دروس — أضف درساً أولاً</option>';
    el('vc-title').textContent = v ? 'تعديل: ' + v.term : 'إضافة مفردة';
    el('vc-err').style.display = 'none';
    el('vc-term').value = v ? v.term : '';
    el('vc-meaning').value = v ? (v.meaning || '') : '';
    el('vc-sort').value = v ? (v.sort_order || 0) : rows.length + 1;
    if (!v && el('vc-lesson-f').value) el('vc-lesson').value = el('vc-lesson-f').value;
    el('vc-term').focus();
  }

  function save() {
    if (busy) return;
    var fail = function (m) {
      el('vc-err').textContent = m; el('vc-err').style.display = 'block';
    };
    if (!el('vc-lesson').value) return fail('اختر الدرس');
    if (!(el('vc-term').value || '').trim()) return fail('المصطلح مطلوب');
    if (!(el('vc-meaning').value || '').trim()) return fail('التعريف مطلوب');

    busy = true;
    var b = el('vc-save'); b.disabled = true; b.textContent = 'جارٍ الحفظ…';
    db.rpc('admin_save_vocab', {
      p_id: editing ? editing.id : null,
      p_lesson: el('vc-lesson').value,
      p_term: el('vc-term').value.trim(),
      p_meaning: el('vc-meaning').value.trim(),
      p_sort: parseInt(el('vc-sort').value, 10) || 0
    }).then(function (r) {
      busy = false; b.disabled = false; b.textContent = 'حفظ';
      var d = (r && r.data) || {};
      if (r.error || d.error) return fail(d.error || r.error.message);
      A.toast(d.message || 'حُفظت', 'ok');
      close(); load();
    }).catch(function (e) {
      busy = false; b.disabled = false; b.textContent = 'حفظ';
      fail((e && e.message) || 'تعذّر الحفظ');
    });
  }

  function remove(id) {
    var v = rows.filter(function (x) { return x.id === id; })[0];
    if (!v) return;
    var note = v.attempts > 0
      ? '\nعليها ' + v.attempts + ' محاولة مسجّلة ستُحذف معها.' : '';
    if (!window.confirm('حذف «' + v.term + '»؟' + note)) return;
    db.rpc('admin_delete_vocab', { p_id: id }).then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) { A.toast(d.error || r.error.message, 'bad'); return; }
      A.toast(d.message || 'حُذفت', 'ok');
      load();
    }).catch(function (e) { A.toast((e && e.message) || 'تعذّر', 'bad'); });
  }

  /* ---------- ربط ---------- */
  el('vc-add').addEventListener('click', function () { open(null); });
  el('vc-lesson-f').addEventListener('change', load);
  el('vc-q').addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(load, 300);
  });
  el('vc-list').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-vc]');
    if (ed) { open(rows.filter(function (x) { return x.id === ed.getAttribute('data-vc'); })[0]); return; }
    var dl = e.target.closest('[data-vc-del]');
    if (dl) remove(dl.getAttribute('data-vc-del'));
  });
  el('vc-disputes').addEventListener('click', function (e) {
    var y = e.target.closest('[data-ok]');
    if (y) { resolve(y.getAttribute('data-ok'), true); return; }
    var n = e.target.closest('[data-no]');
    if (n) resolve(n.getAttribute('data-no'), false);
  });

  A.guard().then(function (s) {
    if (!s) return;
    return loadLessons().then(load).then(loadDisputes);
  });
})();
