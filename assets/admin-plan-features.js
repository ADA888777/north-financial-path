/* مميزات الباقة وروابطها.
   القنوات والقروبات والتدريب روابط خارجية تتغيّر، فمكانها القاعدة لا
   الكود. والرابط لا يخرج إلى المتصفح إلا لمن اشتراكه نافذ ورتبته تكفي. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc;

  var KIND = {
    feature:  { t: 'ميزة',            ico: 'check_circle', url: false },
    channel:  { t: 'قناة توصيات',     ico: 'campaign',     url: true },
    group:    { t: 'قروب المشتركين',  ico: 'groups',       url: true },
    training: { t: 'تدريب مباشر',     ico: 'videocam',     url: true },
    note:     { t: 'ملاحظة',          ico: 'info',         url: false }
  };

  var sheet = null, plan = null, rows = [], onDone = null, busy = false, editing = null;

  function shell() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'pf-sheet';
    sheet.innerHTML = '<div class="sheet-in" role="dialog" aria-modal="true">' +
      '<div class="sheet-h"><h2 id="pf-title">مميزات الباقة</h2>' +
      '<button class="bt bt-ghost bt-sm" type="button" id="pf-x">إغلاق</button></div>' +
      '<div id="pf-body"></div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    el('pf-x').addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('on')) close();
    });
    return sheet;
  }

  function close() {
    if (sheet) sheet.classList.remove('on');
    if (onDone) onDone();
    plan = null; editing = null;
  }

  function render() {
    /* الاسم والرتبة في الرأس: ميزة تُكتب تحت باقة غير المقصودة
       تظهر للمشتركة في البطاقة الخطأ، ولا شيء في الواجهة يكشفها. */
    el('pf-title').textContent = 'مميزات باقة: ' + (plan.name || '') +
      (plan.tier != null ? ' (رتبة ' + plan.tier + ')' : '');

    var list = rows.length
      ? rows.map(function (f) {
          var k = KIND[f.kind] || KIND.feature;
          return '<div class="pf-row' + (f.active ? '' : ' off') + '">' +
            '<span class="ms pf-i">' + (f.icon || k.ico) + '</span>' +
            '<div class="pf-b"><b>' + esc(f.label) + '</b>' +
              '<span class="pf-k">' + esc(k.t) + (f.detail ? ' · ' + esc(f.detail) : '') + '</span>' +
              (f.url ? '<span class="pf-u num">' + esc(f.url) + '</span>'
                     : (k.url ? '<span class="pf-warn">بلا رابط — لن يصل المشترك إلى شيء</span>' : '')) +
            '</div>' +
            '<div class="co-btns">' +
              '<button class="bt bt-ghost bt-sm" type="button" data-pf="' + esc(f.id) + '">تعديل</button>' +
              '<button class="bt bt-ghost bt-sm" type="button" data-pf-del="' + esc(f.id) + '">حذف</button>' +
            '</div></div>';
        }).join('')
      : '<div class="state"><span class="ms">playlist_add</span>' +
        'لا مميزات بعد. أضف ما تشمله هذه الباقة ليراه المشترك.</div>';

    el('pf-body').innerHTML =
      '<p class="sub-h">ما تضيفه هنا يظهر للمشتركة في صفحة باقتها. ' +
        'الروابط لا تُرسل إلى المتصفح إلا إن كان اشتراكها نافذاً.</p>' +
      '<div class="pf-list">' + list + '</div>' +
      '<div class="sub-act">' +
        '<h3 id="pf-form-title">إضافة ميزة</h3>' +
        '<div class="grid2">' +
          '<div class="fld"><label for="pf-kind">النوع</label>' +
            '<select id="pf-kind">' + Object.keys(KIND).map(function (k) {
              return '<option value="' + k + '">' + KIND[k].t + '</option>'; }).join('') +
            '</select></div>' +
          '<div class="fld"><label for="pf-label">العنوان <span class="req">*</span></label>' +
            '<input id="pf-label" type="text" maxlength="80" placeholder="قناة توصيات VIP"></div>' +
        '</div>' +
        '<div class="fld"><label for="pf-detail">وصف مختصر</label>' +
          '<input id="pf-detail" type="text" maxlength="160"></div>' +
        '<div class="fld" id="pf-url-wrap"><label for="pf-url">الرابط</label>' +
          '<input id="pf-url" type="url" dir="ltr" placeholder="https://t.me/...">' +
          '<span class="hint">رابط القناة أو القروب أو التدريب. يُدار من هنا لا من الكود.</span></div>' +
        '<div class="grid2">' +
          '<div class="fld"><label for="pf-sort">الترتيب</label>' +
            '<input id="pf-sort" type="number" value="0"></div>' +
          '<div class="fld" style="justify-content:flex-end">' +
            '<label class="chk" for="pf-active"><input type="checkbox" id="pf-active" checked>' +
            '<span>مفعّلة وتظهر للمشترك</span></label></div>' +
        '</div>' +
        '<p class="bad-msg" id="pf-err" style="display:none"></p>' +
        '<div class="bk-f">' +
          '<button class="bt bt-main" type="button" id="pf-save">حفظ</button>' +
          '<button class="bt bt-ghost" type="button" id="pf-cancel" hidden>إلغاء التعديل</button>' +
        '</div>' +
      '</div>';

    el('pf-kind').addEventListener('change', toggleUrl);
    el('pf-save').addEventListener('click', save);
    el('pf-cancel').addEventListener('click', resetForm);
    el('pf-body').addEventListener('click', function (e) {
      var ed = e.target.closest('[data-pf]');
      if (ed) { edit(rows.filter(function (x) { return x.id === ed.getAttribute('data-pf'); })[0]); return; }
      var dl = e.target.closest('[data-pf-del]');
      if (dl) remove(dl.getAttribute('data-pf-del'));
    });
    toggleUrl();
  }

  function toggleUrl() {
    var k = KIND[el('pf-kind').value] || KIND.feature;
    el('pf-url-wrap').hidden = !k.url;
  }

  function resetForm() {
    editing = null;
    el('pf-form-title').textContent = 'إضافة ميزة';
    el('pf-label').value = ''; el('pf-detail').value = '';
    el('pf-url').value = ''; el('pf-sort').value = rows.length + 1;
    el('pf-active').checked = true;
    el('pf-cancel').hidden = true;
    el('pf-err').style.display = 'none';
    toggleUrl();
  }

  function edit(f) {
    if (!f) return;
    editing = f;
    el('pf-form-title').textContent = 'تعديل: ' + f.label;
    el('pf-kind').value = f.kind;
    el('pf-label').value = f.label || '';
    el('pf-detail').value = f.detail || '';
    el('pf-url').value = f.url || '';
    el('pf-sort').value = f.sort_order || 0;
    el('pf-active').checked = !!f.active;
    el('pf-cancel').hidden = false;
    toggleUrl();
    el('pf-label').focus();
  }

  function save() {
    if (busy) return;
    var label = (el('pf-label').value || '').trim();
    if (!label) {
      el('pf-err').textContent = 'العنوان مطلوب';
      el('pf-err').style.display = 'block';
      return;
    }
    var kind = el('pf-kind').value;
    var url = (el('pf-url').value || '').trim() || null;
    if (url && !/^https?:\/\//i.test(url)) {
      el('pf-err').textContent = 'الرابط يبدأ بـ https://';
      el('pf-err').style.display = 'block';
      return;
    }

    busy = true;
    var b = el('pf-save'); b.disabled = true; b.textContent = 'جارٍ الحفظ…';
    var payload = {
      plan_id: plan.id, kind: kind, label: label,
      detail: (el('pf-detail').value || '').trim(),
      url: (KIND[kind] || {}).url ? url : null,
      sort_order: parseInt(el('pf-sort').value, 10) || 0,
      active: el('pf-active').checked
    };
    var q = editing
      ? db.from('plan_features').update(payload).eq('id', editing.id)
      : db.from('plan_features').insert(payload);

    q.then(function (r) {
      busy = false; b.disabled = false; b.textContent = 'حفظ';
      if (r.error) {
        el('pf-err').textContent = r.error.message;
        el('pf-err').style.display = 'block';
        return;
      }
      A.toast(editing ? 'حُفظت الميزة' : 'أُضيفت الميزة', 'ok');
      load();
    });
  }

  function remove(id) {
    var f = rows.filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    if (!window.confirm('حذف «' + f.label + '» من هذه الباقة؟')) return;
    db.from('plan_features').delete().eq('id', id).then(function (r) {
      if (r.error) { A.toast(r.error.message, 'bad'); return; }
      A.toast('حُذفت', 'ok');
      load();
    });
  }

  function load() {
    return db.from('plan_features').select('*').eq('plan_id', plan.id)
      .order('sort_order').then(function (r) {
        rows = (!r.error && r.data) || [];
        render();
        resetForm();
      });
  }

  function open(p, after) {
    if (!p) return;
    plan = p; onDone = after || null;
    shell().classList.add('on');
    el('pf-body').innerHTML =
      '<div class="state"><span class="ms">hourglass_top</span>جارٍ التحميل…</div>';
    load();
  }

  window.northPlanFeatures = { open: open, close: close };
})();
