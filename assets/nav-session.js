/* يبني قائمة الحساب في شريط الموقع من بيانات المستخدم الحالي.
   كل القيم تُقرأ من قاعدة البيانات، ولا شيء منها مكتوب في الواجهة.
   إخفاء رابط الإدارة ليس حماية: سياسات RLS هي ما يمنع غير الأدمن. */
(function () {
  'use strict';
  var db = window.northDB;
  if (!db) return;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  db.auth.getSession().then(function (r) {
    var session = r && r.data && r.data.session;
    if (!session) return;

    return Promise.all([
      db.from('profiles').select('full_name, membership_no').eq('id', session.user.id).maybeSingle(),
      db.rpc('my_role')
    ]).then(function (res) {
      var p = (res[0] && res[0].data) || {};
      var role = (!res[1].error && res[1].data) || 'user';
      build(session, p, role);
    });
  }).catch(function () {});

  function build(session, p, role) {
    var act = document.querySelector('.nav-act');
    if (!act || document.getElementById('acct')) return;

    var name = p.full_name || session.user.email;
    var no = (window.northNo || String)(p.membership_no || '');
    var initial = (name || '؟').trim().charAt(0);

    var wrap = document.createElement('div');
    wrap.className = 'acct';
    wrap.id = 'acct';
    wrap.innerHTML =
      '<button class="acct-btn" id="acct-btn" type="button" aria-expanded="false" aria-controls="acct-menu">' +
        '<span class="acct-ava">' + esc(initial) + '</span>' +
        '<span class="acct-id"><b>' + esc(name) + '</b>' +
          (no ? '<span class="num">' + esc(no) + '</span>' : '') +
        '</span>' +
        '<span class="ms sm acct-chev">expand_more</span>' +
      '</button>' +
      '<div class="acct-menu" id="acct-menu" hidden>' +
        '<div class="acct-head"><b>' + esc(name) + '</b>' +
          '<span class="num">' + esc(no || session.user.email) + '</span></div>' +
        '<div class="acct-foot">' +
          (role === 'admin'
            ? '<a class="btn btn-ghost btn-sm btn-wide" href="admin.html">لوحة الإدارة</a>'
            : '') +
          '<a class="btn btn-ghost btn-sm btn-wide" href="learn.html">لوحتي</a>' +
          '<a class="btn btn-ghost btn-sm btn-wide" href="account.html">حسابي</a>' +
          '<button class="btn btn-ghost btn-sm btn-wide" id="nav-logout" type="button">تسجيل الخروج</button>' +
        '</div>' +
      '</div>';

    // الصفحة الرئيسية فيها زرّا ضيف: «تسجيل الدخول» و«ابدأ رحلتك». الأول
    // يصير بطاقة الحساب، والباقي يُحذف — وإلا دُعي مشترك داخل حسابه إلى
    // تسجيل الدخول، وضاق الشريط عن محتواه على الجوال.
    var guests = act.querySelectorAll('a[href="login.html"]');
    if (guests.length) {
      act.replaceChild(wrap, guests[0]);
      for (var i = 1; i < guests.length; i++) {
        if (guests[i].parentNode) guests[i].parentNode.removeChild(guests[i]);
      }
    } else {
      act.insertBefore(wrap, act.firstChild);
    }

    var btn = wrap.querySelector('#acct-btn');
    var menu = wrap.querySelector('#acct-menu');

    function close() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) {
      if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    wrap.querySelector('#nav-logout').addEventListener('click', function () {
      db.auth.signOut({ scope: 'global' })
        .catch(function () {})
        .then(function () {
          try { localStorage.removeItem('north-auth'); } catch (e) {}
          window.location.replace('index.html');
        });
    });
  }
})();
