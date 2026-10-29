/* الملف الشخصي للأدمن.
   الصلاحية ليست حقلاً هنا: أدمن يرقّي نفسه أو يُسقط صلاحيته من صفحته
   الشخصية بابٌ لا داعي له. والبريد وكلمة المرور يمرّان بنظام المصادقة. */
(function () {
  'use strict';
  var A = window.northAdmin;
  if (!A) return;
  var db = A.db, el = A.el, esc = A.esc;

  var panel = document.querySelector('[data-panel="me"]');
  if (!panel) return;

  var me = null, busy = false;

  var ACTION = {
    suspend: 'تعطيل حساب', activate: 'إعادة تفعيل', delete: 'حذف حساب',
    self_profile: 'تعديل ملفه الشخصي'
  };

  function kpis() {
    var c = panel.querySelectorAll('#me-kpis .kpi b');
    if (c.length < 3 || !me) return;
    c[0].textContent = me.admins || 1;
    c[1].textContent = me.protected ? 'محميّ' : 'عادي';
    c[2].textContent = (me.recent || []).length;
  }

  function render(m) {
    me = m;
    el('me-body').innerHTML =
      '<div class="sub-now">' +
        '<div><span>الاسم الظاهر</span><b>' + esc(m.full_name || '—') + '</b></div>' +
        '<div><span>البريد (اسم الدخول)</span><b class="num">' + esc(m.email || '—') + '</b></div>' +
        '<div><span>الصلاحية</span><b><span class="tag tag-admin">إدارة</span>' +
          (m.protected ? ' <span class="tag tag-ok">محميّ</span>' : '') + '</b></div>' +
      '</div>' +

      (m.protected
        ? '<p class="sub-h sub-warn">حسابك هو حساب الإدارة الأساسي: لا يمكن تعطيله ولا ' +
          'حذفه من اللوحة، لا منك ولا من أدمن آخر. هذا يمنع إقفال اللوحة على الجميع.</p>'
        : '') +

      '<div class="sub-act">' +
        '<h3>بياناتك</h3>' +
        '<div class="grid2">' +
          '<div class="fld"><label for="me-name">الاسم الظاهر</label>' +
            '<input id="me-name" type="text" maxlength="80"></div>' +
          '<div class="fld"><label for="me-phone">الجوال</label>' +
            '<input id="me-phone" type="text" dir="ltr" maxlength="20"></div>' +
        '</div>' +
        '<button class="bt bt-main" type="button" id="me-save">احفظ بياناتي</button>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>بريد الدخول</h3>' +
        '<p class="sub-h">تغيير بريدك يغيّر اسم دخولك. يُحدَّث في نظام المصادقة والجدول معاً.</p>' +
        '<div class="fld"><label for="me-email">البريد</label>' +
          '<input id="me-email" type="email" dir="ltr" maxlength="120"></div>' +
        '<button class="bt bt-ghost" type="button" id="me-email-go">غيّر بريدي</button>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>كلمة المرور</h3>' +
        '<p class="sub-h">تُغيَّر وأنت داخل بجلستك الحالية، فلا يستطيع أحد تغييرها دونك. ' +
          'ثماني خانات على الأقل.</p>' +
        '<div class="grid2">' +
          '<div class="fld"><label for="me-p1">كلمة المرور الجديدة</label>' +
            '<input id="me-p1" type="password" autocomplete="new-password" maxlength="72"></div>' +
          '<div class="fld"><label for="me-p2">أعدها للتأكيد</label>' +
            '<input id="me-p2" type="password" autocomplete="new-password" maxlength="72"></div>' +
        '</div>' +
        '<button class="bt bt-ghost" type="button" id="me-pass">غيّر كلمة المرور</button>' +
        '<p class="sub-h" id="me-pass-note" hidden></p>' +
      '</div>' +

      '<div class="sub-act">' +
        '<h3>آخر العمليات الإدارية</h3>' +
        '<p class="sub-h">تسجَّل كل عملية حسّاسة: التعديل والتعطيل والتفعيل والحذف.</p>' +
        audit(m.recent) +
      '</div>';

    el('me-name').value = m.full_name || '';
    el('me-phone').value = m.phone || '';
    el('me-email').value = m.email || '';

    el('me-save').addEventListener('click', saveProfile);
    el('me-email-go').addEventListener('click', saveEmail);
    el('me-pass').addEventListener('click', savePass);
    kpis();
  }

  function audit(rows) {
    if (!rows || !rows.length) return '<p class="sub-h">لا توجد عمليات مسجّلة بعد.</p>';
    return '<ol class="sub-log">' + rows.map(function (a) {
      return '<li><div class="sl-h"><b>' + esc(ACTION[a.action] || a.action) + '</b>' +
        '<span>' + esc(A.fmtDate(a.at)) + '</span></div>' +
        '<p>' + esc(a.user_label || '—') + (a.detail ? ' · ' + esc(a.detail) : '') + '</p>' +
        (a.actor ? '<span class="sl-a">بواسطة ' + esc(a.actor) + '</span>' : '') +
        '</li>';
    }).join('') + '</ol>';
  }

  function run(btn, call, after) {
    if (busy) return;
    busy = true;
    var txt = btn.textContent;
    btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
    call().then(function (r) {
      busy = false; btn.disabled = false; btn.textContent = txt;
      var d = (r && r.data) || {};
      if (r.error) { A.toast(r.error.message || 'تعذّر الحفظ', 'bad'); return; }
      if (d.error) { A.toast(d.error, 'bad'); return; }
      A.toast(d.message || 'تم الحفظ', 'ok');
      if (after) after(d);
      load();
    }).catch(function (e) {
      busy = false; btn.disabled = false; btn.textContent = txt;
      A.toast((e && e.message) || 'تعذّر الحفظ', 'bad');
    });
  }

  function saveProfile() {
    run(el('me-save'), function () {
      return db.rpc('update_my_admin_profile', {
        p_full_name: el('me-name').value,
        p_phone: el('me-phone').value
      });
    }, function () {
      var who = document.getElementById('who');
      if (who && el('me-name').value.trim()) who.textContent = el('me-name').value.trim();
    });
  }

  function saveEmail() {
    var e = (el('me-email').value || '').trim();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(e)) {
      A.toast('صيغة البريد غير صحيحة', 'bad'); return;
    }
    if (e.toLowerCase() === String(me.email || '').toLowerCase()) {
      A.toast('البريد كما هو، لم يُغيَّر شيء.', 'ok'); return;
    }
    if (!window.confirm('تغيير بريد دخولك إلى ' + e + '؟\nستدخل به في المرة القادمة.')) return;

    run(el('me-email-go'), function () {
      return db.functions.invoke('update-member-email', {
        body: { user_id: me.id, email: e, confirm_now: true }
      }).then(function (r) {
        if (r.error && !r.data) {
          return { data: { error: 'تعذّر الوصول إلى دالة الخادم. تأكد من نشر update-member-email.' } };
        }
        return { data: r.data || {} };
      });
    });
  }

  function savePass() {
    var a = el('me-p1').value || '', b = el('me-p2').value || '';
    var note = el('me-pass-note');
    function fail(m) { note.hidden = false; note.textContent = m; A.toast(m, 'bad'); }

    if (a.length < 8) return fail('كلمة المرور ثماني خانات على الأقل.');
    if (a !== b) return fail('الكلمتان غير متطابقتين.');

    var btn = el('me-pass');
    busy = true; btn.disabled = true; btn.textContent = 'جارٍ التغيير…';

    db.auth.updateUser({ password: a }).then(function (r) {
      busy = false; btn.disabled = false; btn.textContent = 'غيّر كلمة المرور';
      if (r.error) { fail(r.error.message); return; }
      el('me-p1').value = ''; el('me-p2').value = '';
      note.hidden = false;
      note.textContent = 'تغيّرت كلمة المرور. استخدمها في الدخول القادم.';
      A.toast('تغيّرت كلمة المرور', 'ok');
    }).catch(function (e) {
      busy = false; btn.disabled = false; btn.textContent = 'غيّر كلمة المرور';
      fail((e && e.message) || 'تعذّر التغيير');
    });
  }

  function load() {
    el('me-body').innerHTML =
      '<div class="state"><span class="ms">hourglass_top</span>جارٍ التحميل…</div>';
    return db.rpc('my_admin_profile').then(function (r) {
      if (r.error) {
        el('me-body').innerHTML = '<div class="state"><span class="ms">error</span>' +
          esc(r.error.message) + '</div>';
        return;
      }
      var d = r.data || {};
      if (d.error) {
        el('me-body').innerHTML = '<div class="state"><span class="ms">lock</span>' +
          esc(d.error) + '</div>';
        return;
      }
      render(d);
    });
  }

  A.guard().then(function (s) { if (s) load(); });
})();
