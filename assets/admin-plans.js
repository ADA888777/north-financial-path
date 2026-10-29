/* إدارة الباقات. هذه القائمة هي ما يظهر عند ترقية عضو، فغيابُ باقة
   منها يعني تعذّر الترقية إليها مهما كانت موجودة في صفحة الموقع. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc;

  var panel = document.querySelector('[data-panel="plans"]');
  if (!panel) return;

  var rows = [], busy = false, sheet = null, editing = null;

  function money(v) {
    if (v == null || v === '') return '—';
    try { return new Intl.NumberFormat('ar-SA').format(v) + ' ر.س'; }
    catch (e) { return v + ' ر.س'; }
  }

  function kpis() {
    var c = panel.querySelectorAll('#pl-kpis .kpi b');
    if (c.length < 3) return;
    c[0].textContent = rows.filter(function (p) { return p.active; }).length;
    c[1].textContent = rows.filter(function (p) { return !p.active; }).length;
    c[2].textContent = rows.reduce(function (a, p) { return a + (p.members || 0); }, 0);
  }

  function draw() {
    var box = el('pl-list');
    if (!rows.length) {
      box.innerHTML = '<div class="state"><span class="ms">sell</span>' +
        'لا توجد باقات. أضف باقة ليمكن ترقية الأعضاء إليها.</div>';
      kpis(); return;
    }
    box.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      '<th>الباقة</th><th>الرتبة</th><th>السعر</th><th>المدة</th><th>الجلسات</th>' +
      '<th>الأعضاء</th><th>الحالة</th><th></th></tr></thead><tbody>' +
      rows.map(function (p) {
        return '<tr>' +
          '<td><b>' + esc(p.name) + '</b>' +
            (p.description ? '<br><span class="muted">' + esc(p.description) + '</span>' : '') + '</td>' +
          '<td class="num">' + esc(p.tier || 1) + '</td>' +
          '<td class="num">' + esc(money(p.price_sar)) + '</td>' +
          '<td>' + (p.duration_days ? esc(p.duration_days) + ' يوماً' : '<span class="muted">غير محددة</span>') + '</td>' +
          '<td class="num">' + (p.private_quota ? esc(p.private_quota) : '<span class="muted">0</span>') + '</td>' +
          '<td class="num">' + esc(p.members || 0) + '</td>' +
          '<td>' + (p.active ? '<span class="tag tag-ok">مفعّلة</span>'
                             : '<span class="tag tag-off">معطّلة</span>') + '</td>' +
          '<td class="row-acts">' +
            '<button class="bt bt-ghost bt-sm" type="button" data-pl-f="' + esc(p.id) + '">المميزات والروابط</button>' +
            '<button class="bt bt-ghost bt-sm" type="button" data-pl="' + esc(p.id) + '">تعديل</button>' +
            '<button class="bt bt-ghost bt-sm" type="button" data-pl-del="' + esc(p.id) + '">حذف</button></td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
    kpis();
  }

  function load() {
    el('pl-list').innerHTML = '<div class="state"><span class="ms">hourglass_top</span>جارٍ التحميل…</div>';
    return db.rpc('admin_plans').then(function (r) {
      if (r.error) {
        el('pl-list').innerHTML = '<div class="state"><span class="ms">error</span>' +
          esc(r.error.message) + '</div>';
        return;
      }
      rows = r.data || [];
      if (rows.length && typeof rows[0] === 'string') {
        rows = rows.map(function (n) { return { id: null, name: n, active: true, members: 0 }; });
      }
      draw();
    });
  }

  /* ---------- نموذج ---------- */
  function shell() {
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.id = 'pl-sheet';
    sheet.innerHTML = '<div class="sheet-in" role="dialog" aria-modal="true">' +
      '<div class="sheet-h"><h2 id="pl-title">باقة</h2>' +
      '<button class="bt bt-ghost bt-sm" type="button" id="pl-x">إغلاق</button></div>' +
      '<div class="grid2">' +
        '<div class="fld"><label for="pl-name">الاسم <span class="req">*</span></label>' +
          '<input id="pl-name" type="text" maxlength="60" placeholder="ماسية"></div>' +
        '<div class="fld"><label for="pl-price">السعر بالريال</label>' +
          '<input id="pl-price" type="number" min="0" step="0.01" placeholder="اتركه فارغاً إن لم يُحدَّد"></div>' +
        '<div class="fld"><label for="pl-days">مدة الاشتراك بالأيام</label>' +
          '<input id="pl-days" type="number" min="1" max="1830" placeholder="60">' +
          '<span class="hint">هي المدة الافتراضية عند التجديد.</span></div>' +
        '<div class="fld"><label for="pl-tier">الرتبة</label>' +
          '<input id="pl-tier" type="number" min="1" max="9" value="1">' +
          '<span class="hint">١ للأساسية و٢ للأعلى. المحتوى يُفتح لمن رتبته ' +
            'تساوي أدنى رتبة الدرس أو تزيد — فلا تُربط الصلاحيات باسم الباقة.</span></div>' +
        '<div class="fld"><label for="pl-quota">رصيد الجلسات الخاصة شهرياً</label>' +
          '<input id="pl-quota" type="number" min="0" max="99" value="0">' +
          '<span class="hint">هذا ما يظهر للمشتركة كـ «٤/٤» في صفحة الكلاسات الخاصة.</span></div>' +
      '</div>' +
      '<div class="fld"><label for="pl-desc">وصف مختصر</label>' +
        '<input id="pl-desc" type="text" maxlength="160"></div>' +
      '<div class="grid2">' +
        '<div class="fld"><label for="pl-url">رابط الشراء في سلة</label>' +
          '<input id="pl-url" type="url" placeholder="https://salla.sa/northacademy/..."></div>' +
        '<div class="fld"><label for="pl-sort">الترتيب</label>' +
          '<input id="pl-sort" type="number" value="0"></div>' +
      '</div>' +
      '<label class="chk"><input type="checkbox" id="pl-active" checked>' +
        '<span>مفعّلة ويمكن ترقية الأعضاء إليها</span></label>' +
      '<p class="bad-msg" id="pl-err" style="display:none"></p>' +
      '<div class="sheet-f">' +
        '<button class="bt bt-main" type="button" id="pl-save">حفظ</button>' +
        '<button class="bt bt-ghost" type="button" id="pl-cancel">إلغاء</button>' +
      '</div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) close(); });
    el('pl-x').addEventListener('click', close);
    el('pl-cancel').addEventListener('click', close);
    el('pl-save').addEventListener('click', save);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sheet.classList.contains('on')) close();
    });
    return sheet;
  }

  function close() { if (sheet) sheet.classList.remove('on'); editing = null; }

  function open(p) {
    shell().classList.add('on');
    editing = p || null;
    el('pl-title').textContent = p ? 'تعديل: ' + p.name : 'إضافة باقة';
    el('pl-err').style.display = 'none';
    el('pl-name').value = p ? (p.name || '') : '';
    el('pl-price').value = p && p.price_sar != null ? p.price_sar : '';
    el('pl-days').value = p && p.duration_days != null ? p.duration_days : 60;
    el('pl-tier').value = p && p.tier != null ? p.tier : 1;
    el('pl-quota').value = p ? (p.private_quota || 0) : 0;
    el('pl-desc').value = p ? (p.description || '') : '';
    el('pl-url').value = p ? (p.checkout_url || '') : '';
    el('pl-sort').value = p ? (p.sort_order || 0) : rows.length + 1;
    el('pl-active').checked = p ? !!p.active : true;
    el('pl-name').focus();
  }

  function save() {
    if (busy) return;
    var name = (el('pl-name').value || '').trim();
    if (!name) {
      el('pl-err').textContent = 'اسم الباقة مطلوب';
      el('pl-err').style.display = 'block';
      return;
    }
    busy = true;
    var b = el('pl-save'); b.disabled = true; b.textContent = 'جارٍ الحفظ…';

    db.rpc('admin_save_plan', {
      p_id: editing ? editing.id : null,
      p_name: name,
      p_description: el('pl-desc').value || '',
      p_price: el('pl-price').value === '' ? null : Number(el('pl-price').value),
      p_duration: null,
      p_quota: parseInt(el('pl-quota').value, 10) || 0,
      p_checkout: el('pl-url').value || null,
      p_sort: parseInt(el('pl-sort').value, 10) || 0,
      p_active: el('pl-active').checked
    }).then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) {
        busy = false; b.disabled = false; b.textContent = 'حفظ';
        el('pl-err').textContent = d.error || r.error.message;
        el('pl-err').style.display = 'block';
        return;
      }
      /* الرتبة والمدة بالأيام عمودان مباشران؛ سياسة الجدول تقصرهما
         على الأدمن، والدالة لا تأخذهما. */
      var extra = {
        tier: parseInt(el('pl-tier').value, 10) || 1,
        duration_days: el('pl-days').value === '' ? null : parseInt(el('pl-days').value, 10),
        updated_at: new Date().toISOString()
      };
      return db.from('plans').update(extra).eq('id', d.id || (editing && editing.id))
        .then(function () {
          busy = false; b.disabled = false; b.textContent = 'حفظ';
          A.toast(d.message || 'حُفظت الباقة', 'ok');
          close(); load();
        });
    }).catch(function (e) {
      busy = false; b.disabled = false; b.textContent = 'حفظ';
      el('pl-err').textContent = (e && e.message) || 'تعذّر الحفظ';
      el('pl-err').style.display = 'block';
    });
  }

  function remove(id) {
    var p = rows.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    if (!window.confirm('حذف باقة «' + p.name + '»؟ إن كان عليها أعضاء ستُعطَّل بدل حذفها.')) return;
    db.rpc('admin_delete_plan', { p_id: id }).then(function (r) {
      var d = (r && r.data) || {};
      if (r.error || d.error) { A.toast(d.error || r.error.message, 'bad'); return; }
      A.toast(d.message || 'تم', 'ok');
      load();
    }).catch(function (e) { A.toast((e && e.message) || 'تعذّر الحذف', 'bad'); });
  }

  el('pl-add').addEventListener('click', function () { open(null); });
  el('pl-list').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-pl]');
    if (ed) {
      var id = ed.getAttribute('data-pl');
      open(rows.filter(function (x) { return x.id === id; })[0]);
      return;
    }
    var fx = e.target.closest('[data-pl-f]');
    if (fx && window.northPlanFeatures) {
      var pf = rows.filter(function (x) { return x.id === fx.getAttribute('data-pl-f'); })[0];
      window.northPlanFeatures.open(pf, load);
      return;
    }
    var dl = e.target.closest('[data-pl-del]');
    if (dl) remove(dl.getAttribute('data-pl-del'));
  });

  A.guard().then(function (s) { if (s) load(); });
})();
