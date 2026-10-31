/* صفحة حساب المشترك.
   يقرأ المشترك صفّه فقط: سياسة RLS على profiles تمنعه من رؤية غيره
   حتى لو نادى الـ API مباشرة. */
(function () {
  'use strict';
  var db = window.northDB;
  var el = function (id) { return document.getElementById(id); };

  /* رقم العضوية يُعرض ‎#165 — القاعدة تحتفظ بصيغته الكاملة */
  var no = window.northNo || function (v) { return v == null ? '' : String(v); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmt(iso) {
    if (!iso) return '—';
    try { return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { dateStyle: 'long' }).format(new Date(iso)); }
    catch (e) { return String(iso).slice(0, 10); }
  }
  function put(id, v) { var n = el(id); if (n) n.textContent = (v == null || v === '') ? '—' : v; }

  function deny(title, note, login) {
    el('shell').hidden = true;
    var g = el('gate');
    g.hidden = false;
    g.innerHTML = '<div class="gate-card"><span class="ms gate-ico">lock</span>' +
      '<h1>' + esc(title) + '</h1><p>' + esc(note) + '</p>' +
      (login ? '<a class="btn btn-primary" href="login.html?next=account.html">تسجيل الدخول</a>'
             : '<a class="btn btn-ghost" href="index.html">العودة إلى الموقع</a>') + '</div>';
  }

  if (!db) { deny('تعذّر الاتصال', 'حدّث الصفحة وحاول مرة أخرى.', false); return; }

  db.auth.getSession().then(function (r) {
    var session = r && r.data && r.data.session;
    if (!session) { deny('تحتاج تسجيل الدخول', 'هذه الصفحة لحسابك الخاص.', true); return; }
    return db.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(function (res) {
        if (res.error) { deny('تعذّر تحميل الحساب', res.error.message, false); return; }
        render(res.data || { id: session.user.id, email: session.user.email }, session);
      });
  }).catch(function (e) {
    deny('تعذّر التحقق', (e && e.message) || '', false);
  });

  function render(p, session) {
    el('shell').hidden = false;
    el('gate').hidden = true;
    put('hero-name', 'أهلاً، ' + (p.full_name || ''));
    put('hero-sub', p.plan ? ('أنت مشترك في ' + p.plan + '.') : 'مرحباً بك في منصة نورث.');
    put('hero-no', no(p.membership_no));

    /* «Albtol #46»: الاسم ورقمه كما يُنادى في الإدارة، فتعرف
       العميلة أيّ رقم تذكره حين تتواصل. */
    put('d-name', (window.northWho || function (n) { return n; })(
      p.full_name, p.membership_no));
    put('d-email', p.email || session.user.email);
    put('d-plan', p.plan);
    put('d-expires', p.subscription_expires_at ? fmt(p.subscription_expires_at) : 'بلا تاريخ انتهاء');

    /* ---------- حالة الاشتراك ---------- */
    var expired = p.subscription_expires_at && new Date(p.subscription_expires_at) <= new Date();
    var live = p.status === 'active' && p.subscription_status === 'active' && !expired;

    var box = el('sub-state');
    if (live) {
      box.className = 'sub-state ok';
      el('sub-ico').textContent = 'verified';
      put('sub-title', 'اشتراكك نافذ');
      put('sub-note', p.subscription_expires_at
        ? ('ينتهي في ' + fmt(p.subscription_expires_at) + '.')
        : 'بلا تاريخ انتهاء محدد.');
    } else {
      box.className = 'sub-state off';
      el('sub-ico').textContent = 'lock';
      var why = p.status !== 'active' ? 'الحساب موقوف. تواصل مع الإدارة.'
              : expired ? 'انتهت مدة اشتراكك.'
              : p.subscription_status === 'cancelled' ? 'الاشتراك ملغى.'
              : 'لا يوجد اشتراك نافذ على حسابك.';
      put('sub-title', 'الاشتراك غير نافذ');
      put('sub-note', why);
      if (p.status === 'active') el('renew').hidden = false;
    }

    /* بطاقة «محتواك» حُذفت: كانت تقول «الدروس تُضاف هنا في المرحلة
       القادمة» وقد أُضيفت — فصارت تعِد بما هو قائم. الخارطة مكانها. */
    wireEdit();
  }

  /* ---------- الحساب للعرض فقط ----------
     لا تعديل من واجهة المشتركة: الحقول تُعدَّل من لوحة الإدارة.
     المنع الحقيقي في القاعدة — صلاحية UPDATE على profiles مسحوبة من
     دور authenticated، وحارس على الجدول يرفض تغيير حقول الهوية ولو
     جاء الطلب مباشرة إلى الـAPI. ما هنا عرضٌ صادق لذلك المنع. */
  function wireEdit() { /* لا أزرار تعديل لبيانات الحساب في الصفحة */ }

})();
