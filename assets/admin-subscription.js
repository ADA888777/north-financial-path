/* إدارة اشتراك عضو قائم: الباقة والتجديد والحالة.
   لا يكتب هذا الملف في جدول profiles مباشرة. أعمدة الاشتراك محجوبة عن
   دور authenticated — وهو دور الأدمن أيضاً — فالكتابة تمرّ بدوال
   security definer تتحقق من الصلاحية وتسجّل العملية. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc, no = A.no, who = A.who;

  var STATUS = {
    active: 'نافذ', expired: 'منتهٍ',
    cancelled: 'ملغى', inactive: 'غير مفعّل'
  };

  var host = null, current = null, onDone = null, busy = false, plans = [];

  /* العربية تميّز المفرد والمثنّى وجمع القلّة. «4 جلسة» ركيك. */
  function plural(n, one, two, many) {
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return n + ' ' + many;
    return n + ' ' + one;
  }

  function shell() {
    if (host) return host;
    host = document.createElement('div');
    host.className = 'sheet';
    host.id = 'sub-sheet';
    host.innerHTML = '<div class="sheet-in" role="dialog" aria-modal="true" ' +
      'aria-labelledby="sub-title"><div class="sheet-h">' +
      '<h2 id="sub-title">إدارة الاشتراك</h2>' +
      '<button class="bt bt-ghost bt-sm" type="button" id="sub-x">إغلاق</button>' +
      '</div><div id="sub-body"></div></div>';
    document.body.appendChild(host);

    host.addEventListener('click', function (e) { if (e.target === host) close(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && host.classList.contains('on')) close();
    });
    el('sub-x').addEventListener('click', close);
    return host;
  }

  function close() {
    if (host) host.classList.remove('on');
    current = null;
  }

  function date(iso) { return iso ? A.fmtDate(iso) : '—'; }

  /* الباقات تأتي كائنات من جدول الباقات. الباقة الحالية تُضاف ولو
     عُطِّلت، وإلا اختفت من القائمة وبدا أن العضو بلا باقة. */
  function planOptions(selected) {
    var seen = {}, out = '';
    plans.forEach(function (p) {
      if (!p || !p.name || seen[p.name]) return;
      if (!p.active && p.name !== selected) return;
      seen[p.name] = 1;
      var extra = [];
      if (p.private_quota) extra.push(plural(p.private_quota, 'جلسة خاصة', 'جلستان خاصتان', 'جلسات خاصة'));
      if (p.duration_months) extra.push(plural(p.duration_months, 'شهر', 'شهران', 'أشهر'));
      out += '<option value="' + esc(p.name) + '"' +
             (p.name === selected ? ' selected' : '') + '>' + esc(p.name) +
             (extra.length ? ' — ' + esc(extra.join(' · ')) : '') +
             (p.active ? '' : ' (معطّلة)') + '</option>';
    });
    if (selected && !seen[selected]) {
      out = '<option value="' + esc(selected) + '" selected>' + esc(selected) +
            ' (غير معتمدة)</option>' + out;
    }
    if (!out) {
      out = '<option value="">لا توجد باقات — أضفها من تبويب الباقات</option>';
    }
    return out;
  }

  function render(m) {
    current = m;
    var eff = m.effective_status;

    el('sub-title').textContent = 'اشتراك: ' + who(m.full_name, m.membership_no);

    el('sub-body').innerHTML =
      '<div class="sub-now">' +
        '<div><span>رقم العضوية</span><b class="num">' +
          esc(window.northNo(m.membership_no) || '—') + '</b></div>' +
        '<div><span>الباقة الحالية</span><b>' + esc(m.plan || '—') + '</b></div>' +
        '<div><span>الحالة</span><b><span class="tag ' +
          (eff === 'active' ? 'tag-ok' : 'tag-off') + '">' +
          esc(STATUS[eff] || eff) + '</span></b></div>' +
        '<div><span>الفترة الحالية</span><b>' + esc(date(m.subscription_started_at)) +
          ' ← ' + esc(date(m.subscription_expires_at)) +
          (m.days_left != null && eff === 'active'
            ? ' <i class="sub-left">بقي ' + m.days_left + ' يوماً</i>' : '') +
        '</b></div>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>تجديد الاشتراك</h3>' +
        '<p class="sub-h">العضو نفسه ورقم عضويته نفسه. إن كان الاشتراك ما زال ' +
          'نافذاً تُضاف المدة إلى تاريخ انتهائه ولا تضيع الأيام المتبقية.</p>' +
        '<div class="grid2">' +
          '<div class="fld"><label for="r-months">المدة</label>' +
            '<select id="r-months">' +
              '<option value="1">شهر واحد</option>' +
              '<option value="3" selected>3 أشهر</option>' +
              '<option value="6">6 أشهر</option>' +
              '<option value="12">سنة</option>' +
            '</select></div>' +
          '<div class="fld"><label for="r-plan">الباقة بعد التجديد</label>' +
            '<select id="r-plan">' + planOptions(m.plan) + '</select></div>' +
        '</div>' +
        '<div class="fld"><label for="r-note">ملاحظة (اختيارية)</label>' +
          '<input id="r-note" type="text" maxlength="200" placeholder="سبب التجديد"></div>' +
        '<label class="chk"><input type="checkbox" id="r-paid">' +
          '<span>وصلني الدفع عن هذه المدة</span></label>' +
        '<div class="fld" id="r-ref-wrap" hidden><label for="r-ref">مرجع الدفع</label>' +
          '<input id="r-ref" type="text" maxlength="100" placeholder="رقم الطلب في سلة"></div>' +
        '<p class="sub-h sub-warn">التجديد يفتح المحتوى في الحالتين. علامة الدفع ' +
          'تميّز «وصلني المبلغ» عن «فتحتُ له إدارياً»، ويبقى الفرق في السجل.</p>' +
        '<button class="bt bt-primary" type="button" id="do-renew">جدّد الاشتراك</button>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>تغيير الباقة</h3>' +
        '<p class="sub-h">الباقة وحدها، دون مساس بتاريخ الانتهاء. تعمل والاشتراك منتهٍ.</p>' +
        '<div class="grid2">' +
          '<div class="fld"><label for="p-plan">الباقة</label>' +
            '<select id="p-plan">' + planOptions(m.plan) + '</select></div>' +
          '<div class="fld"><label for="p-note">ملاحظة</label>' +
            '<input id="p-note" type="text" maxlength="200"></div>' +
        '</div>' +
        '<p class="sub-h sub-warn">تغيير الباقة قرار إداري ولا يُسجَّل دفعاً. ' +
          'لتسجيل دفعة استخدم التجديد مع علامة الدفع.</p>' +
        '<button class="bt bt-ghost" type="button" id="do-plan">احفظ الباقة</button>' +
      '</div>' +

      '<details class="sub-act sub-adv"><summary>ضبط الحالة يدوياً</summary>' +
        '<p class="sub-h">للحالات الاستثنائية: إلغاء أو إيقاف أو تصحيح تاريخ. ' +
          'للتجديد العادي استخدم التجديد أعلاه.</p>' +
        '<div class="grid2">' +
          '<div class="fld"><label for="s-status">الحالة</label>' +
            '<select id="s-status">' +
              '<option value="active">نافذ</option>' +
              '<option value="expired">منتهٍ</option>' +
              '<option value="cancelled">ملغى</option>' +
              '<option value="inactive">غير مفعّل</option>' +
            '</select></div>' +
          '<div class="fld"><label for="s-exp">تاريخ الانتهاء</label>' +
            '<input id="s-exp" type="date"></div>' +
        '</div>' +
        '<div class="fld"><label for="s-note">سبب التعديل</label>' +
          '<input id="s-note" type="text" maxlength="200"></div>' +
        '<button class="bt bt-ghost" type="button" id="do-status">احفظ الحالة</button>' +
      '</details>' +

      '<div class="sub-act">' +
        '<h3>سجل العمليات</h3>' + history(m.events) +
      '</div>';

    var sel = el('s-status');
    if (sel) sel.value = m.subscription_status || 'inactive';
    var exp = el('s-exp');
    if (exp && m.subscription_expires_at) {
      exp.value = String(m.subscription_expires_at).slice(0, 10);
    }

    var paid = el('r-paid');
    paid.addEventListener('change', function () {
      el('r-ref-wrap').hidden = !paid.checked;
    });
    el('do-renew').addEventListener('click', renew);
    el('do-plan').addEventListener('click', setPlan);
    el('do-status').addEventListener('click', setStatus);
  }

  function history(ev) {
    if (!ev || !ev.length) {
      return '<p class="sub-h">لا توجد عمليات مسجّلة بعد.</p>';
    }
    var KIND = { renew: 'تجديد', plan_change: 'تغيير باقة',
                 status_change: 'تغيير حالة', created: 'إنشاء' };
    return '<ol class="sub-log">' + ev.map(function (e) {
      var detail = [];
      if (e.months) detail.push(e.months + ' شهراً');
      if (e.plan_before !== e.plan_after) {
        detail.push('الباقة: ' + (e.plan_before || '—') + ' ← ' + (e.plan_after || '—'));
      }
      if (e.status_before !== e.status_after) {
        detail.push('الحالة: ' + (STATUS[e.status_before] || e.status_before || '—') +
                    ' ← ' + (STATUS[e.status_after] || e.status_after || '—'));
      }
      if (e.expires_at) detail.push('ينتهي ' + date(e.expires_at));
      if (e.payment_ref) detail.push('مرجع ' + e.payment_ref);
      return '<li><div class="sl-h"><b>' + esc(KIND[e.kind] || e.kind) +
        (e.kind === 'renew'
          ? ' <span class="pay ' + (e.paid ? 'yes' : 'no') + '">' +
            (e.paid ? 'مدفوع' : 'بلا دفع') + '</span>'
          : '') + '</b>' +
        '<span>' + esc(date(e.created_at)) + '</span></div>' +
        (detail.length ? '<p>' + esc(detail.join(' · ')) + '</p>' : '') +
        (e.note ? '<p class="sl-n">' + esc(e.note) + '</p>' : '') +
        (e.actor ? '<span class="sl-a">بواسطة ' + esc(e.actor) + '</span>' : '') +
        '</li>';
    }).join('') + '</ol>';
  }

  /* ---------- العمليات ---------- */
  function run(btn, call) {
    if (busy || !current) return;
    busy = true;
    var txt = btn.textContent;
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';

    call().then(function (r) {
      busy = false; btn.disabled = false; btn.textContent = txt;

      var d = (r && r.data) || {};
      if (r.error) { A.toast(r.error.message || 'تعذّر الحفظ', 'bad'); return; }
      if (d.error) { A.toast(d.error, 'bad'); return; }

      A.toast(d.message || 'تم الحفظ', 'ok');
      // الجدول يُحدَّث من القاعدة لا من قيم الواجهة
      if (onDone) onDone();
      reload(current.id);
    }).catch(function (e) {
      busy = false; btn.disabled = false; btn.textContent = txt;
      A.toast((e && e.message) || 'تعذّر الحفظ', 'bad');
    });
  }

  function renew() {
    run(el('do-renew'), function () {
      return db.rpc('admin_renew_subscription', {
        p_user: current.id,
        p_months: parseInt(el('r-months').value, 10),
        p_plan: el('r-plan').value || null,
        p_note: el('r-note').value || null,
        p_paid: el('r-paid').checked,
        p_payment_ref: el('r-paid').checked ? (el('r-ref').value || null) : null
      });
    });
  }

  function setPlan() {
    run(el('do-plan'), function () {
      return db.rpc('admin_set_plan', {
        p_user: current.id,
        p_plan: el('p-plan').value,
        p_note: el('p-note').value || null
      });
    });
  }

  function setStatus() {
    run(el('do-status'), function () {
      return db.rpc('admin_set_subscription_status', {
        p_user: current.id,
        p_status: el('s-status').value,
        p_expires: el('s-exp').value ? el('s-exp').value + 'T23:59:59' : null,
        p_note: el('s-note').value || null
      });
    });
  }

  /* ---------- الفتح ---------- */
  function reload(id) {
    return db.rpc('admin_member', { p_user: id }).then(function (r) {
      if (r.error) { A.toast(r.error.message || 'تعذّر تحميل بيانات العضو', 'bad'); return; }
      var d = r.data || {};
      if (d.error) { A.toast(d.error, 'bad'); return; }
      render(d);
    });
  }

  function open(id, after) {
    onDone = after || null;
    shell().classList.add('on');
    el('sub-body').innerHTML = '<div class="state"><span class="ms">hourglass_top</span>جارٍ التحميل…</div>';

    db.rpc('admin_plans').then(function (r) {
      plans = (!r.error && r.data) || [];
      if (plans.length && typeof plans[0] === 'string') {
        plans = plans.map(function (n) { return { name: n, active: true }; });
      }
    }).catch(function () { plans = []; })
      .then(function () { return reload(id); })
      .catch(function (e) {
        el('sub-body').innerHTML = '<div class="state"><span class="ms">error</span>' +
          esc((e && e.message) || 'تعذّر التحميل') + '</div>';
      });
  }

  window.northSub = { open: open, close: close };
})();
